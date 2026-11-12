import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// The sync engine against the database, with Google and Microsoft played by an in-memory stand-in
// (a fake fetch). Makes and removes its own business, so it only runs against the test database:
//   TEST_DATABASE_URL=postgresql://…/gigsaw_test npx vitest run tests/calendar-sync-db.test.ts

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: () => {
    throw new Error("outside a request");
  },
}));

const KEY = Buffer.alloc(32, 3);
const ENV = {
  CALENDAR_TOKEN_KEY: KEY.toString("base64"),
  GOOGLE_CLIENT_ID: "gid",
  GOOGLE_CLIENT_SECRET: "gsecret",
  MICROSOFT_CLIENT_ID: "mid",
  MICROSOFT_CLIENT_SECRET: "msecret",
  OAUTH_TEST_BASE: "http://stand.in",
};
const saved: Record<string, string | undefined> = {};
const DAY = 86_400_000;

// ---- The stand-in provider ----
type Call = { method: string; path: string; body: string };
const fake = {
  calls: [] as Call[],
  events: new Map<string, { body: Record<string, unknown> }>(),
  /** Refresh tokens the token endpoint turns down (invalid_grant). */
  revoked: new Set<string>(),
  /** Refresh tokens whose access tokens the calendar API turns down (401), though refreshing still works. */
  apiRefuses: new Set<string>(),
  down: false,
  n: 0,
  reset() {
    this.calls = [];
    this.down = false;
  },
  /** Calls to the calendar APIs (not token refreshes), as "METHOD provider". */
  apiCalls() {
    return this.calls.filter((c) => !c.path.endsWith("/token")).map((c) => `${c.method} ${c.path.startsWith("/google") ? "google" : "microsoft"}`);
  },
};

async function standIn(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (fake.down) throw new Error("connect ECONNREFUSED");
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? init.body : "";
  fake.calls.push({ method, path: url.pathname, body });
  const json = (status: number, data?: unknown) => new Response(data === undefined ? null : JSON.stringify(data), { status });
  if (url.pathname.endsWith("/token")) {
    const refresh = new URLSearchParams(body).get("refresh_token") ?? "";
    if (fake.revoked.has(refresh)) return json(400, { error: "invalid_grant" });
    return json(200, { access_token: `at-${refresh}`, expires_in: 3600 });
  }
  const token = (init?.headers as Record<string, string>)?.Authorization?.replace("Bearer at-", "") ?? "";
  if (fake.revoked.has(token) || fake.apiRefuses.has(token)) return json(401, { error: { code: 401 } });
  const google = url.pathname.match(/^\/google\/calendar\/v3\/calendars\/[^/]+\/events(?:\/([^/]+))?$/);
  const ms = url.pathname.match(/^\/graph\/v1\.0\/me\/(?:calendar\/events|events\/([^/]+))$/);
  if (!google && !ms) return json(404);
  const id = decodeURIComponent((google ?? ms)![1] ?? "");
  if (method === "POST") {
    const newId = `evt${++fake.n}`;
    fake.events.set(newId, { body: JSON.parse(body) });
    return json(200, { id: newId });
  }
  if (!fake.events.has(id)) return json(google ? 410 : 404);
  if (method === "PATCH") {
    fake.events.set(id, { body: JSON.parse(body) });
    return json(200, { id });
  }
  if (method === "DELETE") {
    fake.events.delete(id);
    return json(204);
  }
  return json(405);
}

describeDb("calendar sync (database)", () => {
  type Sync = typeof import("@/lib/calendar-sync");
  let prisma: (typeof import("@/lib/db"))["prisma"];
  let sync: Sync;
  let sealToken: (typeof import("@/server/token-box"))["sealToken"];
  let agencyId = "";
  let actA = "";
  let actB = "";
  let band = "";
  let venueId = "";
  let connA = "";
  let connB = "";
  let ref = 0;

  const gig = async (artistId: string, over: Record<string, unknown> = {}) => {
    const setStart = new Date(Date.now() + 10 * DAY);
    return prisma.booking.create({
      data: {
        agencyId,
        reference: `CS-${++ref}`,
        artistId,
        venueId,
        status: "CONFIRMED",
        arriveBy: new Date(setStart.getTime() - 3_600_000),
        setStart,
        setEnd: new Date(setStart.getTime() + 2 * 3_600_000),
        timezone: "Europe/London",
        feeMinor: 987654,
        artistFeeMinor: 55555,
        bookingFeeMinor: 31337,
        depositMinor: 42424,
        dealNotes: "SECRET-DEAL",
        notes: "PRIVATE-NOTE",
        ...over,
      },
    });
  };
  const link = (connectionId: string, bookingId: string) =>
    prisma.calendarEventLink.findUnique({ where: { connectionId_bookingId: { connectionId, bookingId } } });
  const connection = (id: string) => prisma.calendarConnection.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    ({ prisma } = await import("@/lib/db"));
    sync = await import("@/lib/calendar-sync");
    ({ sealToken } = await import("@/server/token-box"));
    sync.setCalendarClientDepsForTests({ fetcher: standIn as typeof fetch });

    const t = await createTestAgency(prisma, "calsync");
    agencyId = t.agency.id;
    actA = (await prisma.artist.create({ data: { agencyId, name: "Act A" } })).id;
    actB = (await prisma.artist.create({ data: { agencyId, name: "Act B" } })).id;
    band = (await prisma.artist.create({ data: { agencyId, name: "The Band" } })).id;
    await prisma.actLink.create({ data: { parentId: band, childId: actA } });
    venueId = (await prisma.venue.create({ data: { agencyId, name: "The Crown", city: "Leeds", timezone: "Europe/London" } })).id;
    const loginA = await prisma.user.create({
      data: { email: `a-${t.stamp}@gigsaw.invalid`, name: "A", passwordHash: "x", role: "ARTIST", agencyId, artistId: actA },
    });
    const loginB = await prisma.user.create({
      data: { email: `b-${t.stamp}@gigsaw.invalid`, name: "B", passwordHash: "x", role: "ARTIST", agencyId, artistId: actB },
    });
    connA = (
      await prisma.calendarConnection.create({ data: { agencyId, userId: loginA.id, provider: "GOOGLE", refreshTokenEnc: sealToken(`rA-${t.stamp}`, KEY) } })
    ).id;
    connB = (
      await prisma.calendarConnection.create({ data: { agencyId, userId: loginB.id, provider: "MICROSOFT", refreshTokenEnc: sealToken(`rB-${t.stamp}`, KEY) } })
    ).id;
  });

  beforeEach(() => fake.reset());

  afterAll(async () => {
    sync?.setCalendarClientDepsForTests({});
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (!prisma) return;
    if (agencyId) await prisma.calendarEventLink.deleteMany({ where: { connection: { agencyId } } });
    await prisma.booking.deleteMany({ where: { agencyId, archivedAt: undefined } });
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  it("adds a gig to the act's calendar with no money in it, and sends nothing when nothing the act sees changed", async () => {
    const b = await gig(actA);
    await sync.syncBookingToCalendars(b.id);
    expect(fake.apiCalls()).toEqual(["POST google"]);
    const l = await link(connA, b.id);
    expect(l?.externalId).toBeTruthy();
    const sent = JSON.stringify(fake.events.get(l!.externalId)!.body);
    for (const t of ["987654", "9876.54", "55555", "555.55", "31337", "313.37", "42424", "424.24", "SECRET-DEAL", "PRIVATE-NOTE", "£"])
      expect(sent).not.toContain(t);
    expect(sent).toContain("Act A @ The Crown");
    // The token was refreshed and kept, sealed.
    const c = await connection(connA);
    expect(c.accessTokenEnc).toMatch(/^v1\./);
    expect(c.accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    fake.reset();
    await sync.syncBookingToCalendars(b.id);
    // A change the act can't see (the sale price) sends nothing either.
    await prisma.booking.update({ where: { id: b.id }, data: { feeMinor: 1 } });
    await sync.syncBookingToCalendars(b.id);
    expect(fake.calls).toEqual([]);
  });

  it("updates the event in place when the time changes, and adds it back if it was deleted by hand", async () => {
    const b = await gig(actA);
    await sync.syncBookingToCalendars(b.id);
    const first = (await link(connA, b.id))!;
    fake.reset();
    await prisma.booking.update({ where: { id: b.id }, data: { setStart: new Date(b.setStart.getTime() + 30 * 60_000) } });
    await sync.syncBookingToCalendars(b.id);
    expect(fake.apiCalls()).toEqual(["PATCH google"]);
    const second = (await link(connA, b.id))!;
    expect(second.externalId).toBe(first.externalId);
    expect(second.contentHash).not.toBe(first.contentHash);

    fake.events.delete(second.externalId);
    fake.reset();
    await prisma.booking.update({ where: { id: b.id }, data: { dayContact: "Jo on the door" } });
    await sync.syncBookingToCalendars(b.id);
    expect(fake.apiCalls()).toEqual(["PATCH google", "POST google"]);
    expect((await link(connA, b.id))!.externalId).not.toBe(first.externalId);
  });

  it("moves the event to the new act's calendar when the act changes", async () => {
    const b = await gig(actA);
    await sync.syncBookingToCalendars(b.id);
    const old = (await link(connA, b.id))!;
    fake.reset();
    await prisma.booking.update({ where: { id: b.id }, data: { artistId: actB } });
    await sync.syncBookingToCalendars(b.id);
    expect(fake.apiCalls().sort()).toEqual(["DELETE google", "POST microsoft"]);
    expect(await link(connA, b.id)).toBeNull();
    expect(fake.events.has(old.externalId)).toBe(false);
    const moved = (await link(connB, b.id))!;
    expect(fake.events.get(moved.externalId)!.body).toMatchObject({ subject: "Act B @ The Crown", start: { timeZone: "Europe/London" } });
  });

  it("removes cancelled, archived and deleted gigs, and puts a restored one back", async () => {
    const cancelled = await gig(actB);
    await sync.syncBookingToCalendars(cancelled.id);
    await prisma.booking.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });
    fake.reset();
    await sync.syncBookingToCalendars(cancelled.id);
    expect(fake.apiCalls()).toEqual(["DELETE microsoft"]);
    expect(await link(connB, cancelled.id)).toBeNull();

    const archived = await gig(actB);
    await sync.syncBookingToCalendars(archived.id);
    await prisma.booking.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    fake.reset();
    await sync.syncBookingToCalendars(archived.id);
    expect(fake.apiCalls()).toEqual(["DELETE microsoft"]);
    await prisma.booking.update({ where: { id: archived.id }, data: { archivedAt: null } });
    fake.reset();
    await sync.syncBookingToCalendars(archived.id);
    expect(fake.apiCalls()).toEqual(["POST microsoft"]);

    const deleted = await gig(actB);
    await sync.syncBookingToCalendars(deleted.id);
    await prisma.booking.delete({ where: { id: deleted.id } });
    fake.reset();
    await sync.syncBookingToCalendars(deleted.id);
    expect(fake.apiCalls()).toEqual(["DELETE microsoft"]);
    expect(await link(connB, deleted.id)).toBeNull();
  });

  it("puts a band's gig in a member act's calendar, and leaves gigs that aren't the act's alone", async () => {
    const b = await gig(band);
    await sync.syncBookingToCalendars(b.id);
    expect(fake.apiCalls()).toEqual(["POST google"]);
    expect(await link(connA, b.id)).not.toBeNull();
    expect(await link(connB, b.id)).toBeNull();

    fake.reset();
    const pending = await gig(actA, { status: "PENDING" });
    await sync.syncBookingToCalendars(pending.id);
    expect(fake.calls).toEqual([]);
  });

  it("doesn't add gigs for a business whose trial has ended, but still takes cancelled ones out", async () => {
    const b = await gig(actA);
    await sync.syncBookingToCalendars(b.id);
    await prisma.agency.update({ where: { id: agencyId }, data: { billingMode: "STRIPE", trialEndsAt: new Date(Date.now() - DAY) } });
    try {
      fake.reset();
      const fresh = await gig(actA);
      await sync.syncBookingToCalendars(fresh.id);
      expect(fake.calls).toEqual([]);
      await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED" } });
      await sync.syncBookingToCalendars(b.id);
      expect(fake.apiCalls()).toEqual(["DELETE google"]);
    } finally {
      await prisma.agency.update({ where: { id: agencyId }, data: { billingMode: "INVOICE", trialEndsAt: null } });
    }
  });

  it("never throws: a provider that can't be reached is noted on the connection and tried again later", async () => {
    await expect(sync.syncBookingToCalendars("no-such-booking")).resolves.toBeUndefined();
    await expect(sync.resyncConnection("no-such-connection")).resolves.toBeUndefined();
    await expect(sync.removeConnectionEvents("no-such-connection")).resolves.toBeUndefined();

    const b = await gig(actB);
    fake.down = true;
    await expect(sync.syncBookingToCalendars(b.id)).resolves.toBeUndefined();
    const c = await connection(connB);
    expect(c.status).toBe("ACTIVE");
    expect(c.lastError).toContain("ECONNREFUSED");
    expect(await link(connB, b.id)).toBeNull();

    // The next full resync adds it and clears the error.
    fake.down = false;
    await sync.resyncConnection(connB);
    expect(await link(connB, b.id)).not.toBeNull();
    const after = await connection(connB);
    expect(after.lastError).toBe("");
    expect(after.lastSyncedAt).not.toBeNull();
  });

  it("resync adds what's missing, removes what went, and leaves older gigs already there alone", async () => {
    const missing = await gig(actA, { setStart: new Date(Date.now() + 20 * DAY), arriveBy: new Date(Date.now() + 20 * DAY) });
    const gone = await gig(actA);
    await sync.syncBookingToCalendars(gone.id);
    // Cancelled without a sync (as if the queue was lost in a restart).
    await prisma.booking.update({ where: { id: gone.id }, data: { status: "CANCELLED" } });
    // A gig from months ago that's already in the calendar: older than the feed goes back, but kept.
    const old = await gig(actA, { setStart: new Date(Date.now() - 200 * DAY), arriveBy: new Date(Date.now() - 200 * DAY), setEnd: null });
    await prisma.calendarEventLink.create({ data: { connectionId: connA, bookingId: old.id, externalId: "old-evt", contentHash: "whatever" } });
    fake.events.set("old-evt", { body: {} });

    fake.reset();
    await sync.resyncConnection(connA);
    expect(await link(connA, missing.id)).not.toBeNull();
    expect(await link(connA, gone.id)).toBeNull();
    expect(await link(connA, old.id)).not.toBeNull();
    expect(fake.events.has("old-evt")).toBe(true);

    // Run again: everything matches, so no calls at all.
    fake.reset();
    await sync.resyncConnection(connA);
    expect(fake.apiCalls()).toEqual([]);
  });

  it("marks the connection for reconnecting when access is withdrawn, then leaves it alone", async () => {
    const c = await connection(connA);
    const { openToken } = await import("@/server/token-box");
    const refresh = openToken(c.refreshTokenEnc, KEY);
    fake.revoked.add(refresh);
    // Make it refresh rather than use the stored access token.
    await prisma.calendarConnection.update({ where: { id: connA }, data: { accessTokenExpiresAt: new Date(0) } });
    try {
      const b = await gig(actA);
      await sync.syncBookingToCalendars(b.id);
      const after = await connection(connA);
      expect(after.status).toBe("NEEDS_RECONNECT");
      expect(after.lastError).toContain("invalid_grant");

      fake.reset();
      await prisma.booking.update({ where: { id: b.id }, data: { dayContact: "changed" } });
      await sync.syncBookingToCalendars(b.id);
      await sync.resyncConnection(connA);
      expect(fake.calls).toEqual([]);
    } finally {
      fake.revoked.delete(refresh);
      await prisma.calendarConnection.update({ where: { id: connA }, data: { status: "ACTIVE", lastError: "" } });
    }
  });

  it("a 401 straight after a fresh token also means reconnect", async () => {
    const c = await connection(connB);
    const { openToken } = await import("@/server/token-box");
    const refresh = openToken(c.refreshTokenEnc, KEY);
    // The token endpoint still answers, but the calendar API turns every token down.
    fake.apiRefuses.add(refresh);
    try {
      const b = await gig(actB);
      await sync.syncBookingToCalendars(b.id);
      expect((await connection(connB)).status).toBe("NEEDS_RECONNECT");
      // The stored token was turned down, so it refreshed once, tried again, and stopped.
      expect(fake.calls.map((c) => c.path.endsWith("/token"))).toEqual([false, true, false]);
    } finally {
      fake.apiRefuses.delete(refresh);
      await prisma.calendarConnection.update({ where: { id: connB }, data: { status: "ACTIVE", lastError: "" } });
    }
  });

  it("getAccessToken refreshes and saves, and marks withdrawn access for reconnecting", async () => {
    await prisma.calendarConnection.update({ where: { id: connA }, data: { accessTokenExpiresAt: new Date(0) } });
    const c = await connection(connA);
    const { openToken } = await import("@/server/token-box");
    const refresh = openToken(c.refreshTokenEnc, KEY);
    expect(await sync.getAccessToken(c)).toBe(`at-${refresh}`);
    expect((await connection(connA)).accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    fake.revoked.add(refresh);
    try {
      await expect(sync.getAccessToken({ ...c, accessTokenEnc: "" })).rejects.toBeInstanceOf(sync.CalendarAccessError);
      expect((await connection(connA)).status).toBe("NEEDS_RECONNECT");
    } finally {
      fake.revoked.delete(refresh);
      await prisma.calendarConnection.update({ where: { id: connA }, data: { status: "ACTIVE", lastError: "" } });
    }
  });

  it("removeConnectionEvents takes every event out and forgets the links", async () => {
    await sync.resyncConnection(connB);
    const links = await prisma.calendarEventLink.findMany({ where: { connectionId: connB } });
    expect(links.length).toBeGreaterThan(0);
    fake.reset();
    await sync.removeConnectionEvents(connB);
    expect(fake.apiCalls().every((c) => c === "DELETE microsoft")).toBe(true);
    expect(fake.apiCalls()).toHaveLength(links.length);
    expect(await prisma.calendarEventLink.count({ where: { connectionId: connB } })).toBe(0);
    for (const l of links) expect(fake.events.has(l.externalId)).toBe(false);
  });

  it("the scheduler job retries a failed connection and tops up stale ones", async () => {
    const { runCalendarSync } = await import("@/lib/calendar-sync/job");
    const b = await gig(actB);
    // Failed a while ago and not yet tried again.
    await prisma.calendarConnection.update({ where: { id: connB }, data: { lastError: "Microsoft couldn't add the gig (503)." } });
    await prisma.$executeRaw`UPDATE "CalendarConnection" SET "updatedAt" = ${new Date(Date.now() - 60 * 60_000)} WHERE id = ${connB}`;
    // Last fully synced two days ago.
    await prisma.calendarConnection.update({ where: { id: connA }, data: { lastSyncedAt: new Date(Date.now() - 2 * DAY) } });
    const r = await runCalendarSync();
    expect(r.retried).toBeGreaterThanOrEqual(1);
    expect(r.toppedUp).toBeGreaterThanOrEqual(1);
    expect((await connection(connB)).lastError).toBe("");
    expect(await link(connB, b.id)).not.toBeNull();
    expect((await connection(connA)).lastSyncedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("a booking made through the app is queued for its calendars without waiting", async () => {
    const { createBookingWithReference } = await import("@/lib/bookings");
    const { calendarQueueIdle } = await import("@/lib/calendar-sync/queue");
    const setStart = new Date(Date.now() + 30 * DAY);
    const b = await createBookingWithReference(agencyId, { artistId: actA, venueId, status: "HOLD", arriveBy: setStart, setStart, timezone: "Europe/London" });
    await calendarQueueIdle();
    const l = await link(connA, b.id);
    expect(l).not.toBeNull();
    expect(fake.events.get(l!.externalId)!.body).toMatchObject({ summary: "[HOLD] Act A @ The Crown" });
  });
});
