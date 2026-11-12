import { describe, expect, it, vi } from "vitest";
import { ACT_FEED_SELECT, actFeedEvent, type ActFeedBooking } from "@/lib/act-calendar";
import { buildIcs } from "@/lib/ics";
import {
  belongsInCalendar,
  calendarContent,
  CALENDAR_STATUSES,
  contentHash,
  googleEventBody,
  microsoftEventBody,
  planSync,
  wallClock,
} from "@/lib/calendar-sync/content";
import { apiBase, CalendarAccessError, CalendarApiError, CalendarClient, CalendarSetupError, type StoredConnection } from "@/lib/calendar-sync/providers";
import type { ServerEnv } from "@/server/env";
import { openToken, sealToken } from "@/server/token-box";

// The sync engine's rules without a database: what an act's event says (and never says), when a
// gig is sent, changed, removed or left alone, and how the provider clients handle tokens and
// errors. Provider calls go to a fake fetch.

vi.mock("server-only", () => ({}));

const KEY = Buffer.alloc(32, 7);
const BASE = "https://app.gigsaw.test";

// A booking with every money field set to a value that's easy to spot if it leaks.
const MONEY = { feeMinor: 987654, artistFeeMinor: 55555, bookingFeeMinor: 31337, depositMinor: 42424, commissionPct: 17.5, vatPct: 20 };
const MONEY_TEXT = [
  "987654",
  "9876.54",
  "9,876.54",
  "55555",
  "555.55",
  "31337",
  "313.37",
  "42424",
  "424.24",
  "17.5",
  "£",
  "SECRET-DEAL",
  "PRIVATE-NOTE",
  "HOSPITALITY-X",
];

function gig(over: Partial<ActFeedBooking> = {}): ActFeedBooking {
  const b = {
    id: "ckgig1",
    status: "CONFIRMED",
    timezone: "Europe/London",
    arriveBy: new Date("2026-07-04T17:00:00Z"),
    soundcheckAt: new Date("2026-07-04T17:30:00Z"),
    setStart: new Date("2026-07-04T18:00:00Z"),
    setEnd: new Date("2026-07-04T20:00:00Z"),
    dayContact: "Sam, 07700 900123",
    updatedAt: new Date("2026-06-01T09:15:00Z"),
    artist: { name: "The Velvet Owls" },
    venue: { name: "The Crown", address: "1 High St", city: "Leeds", country: "UK" },
    // Not part of the type: a whole booking row, as a careless caller might pass.
    ...MONEY,
    dealNotes: "SECRET-DEAL",
    notes: "PRIVATE-NOTE",
    hospitality: "HOSPITALITY-X",
    currency: "GBP",
    ...over,
  };
  return b as ActFeedBooking;
}

describe("event content", () => {
  it("reads no money fields from a booking at all", () => {
    const keys = Object.keys(ACT_FEED_SELECT);
    for (const k of [
      "feeMinor",
      "artistFeeMinor",
      "bookingFeeMinor",
      "depositMinor",
      "depositDueDate",
      "commissionPct",
      "vatPct",
      "dealNotes",
      "dealType",
      "currency",
      "payments",
      "notes",
      "hospitality",
      "promoter",
      "promoterId",
    ])
      expect(keys).not.toContain(k);
  });

  it("never puts the sale price, booking fee, deposit, act fee or private notes in either provider's event", () => {
    const c = calendarContent(gig(), { baseUrl: BASE });
    const sent = JSON.stringify([googleEventBody(c, "ckgig1"), microsoftEventBody(c)]);
    for (const t of MONEY_TEXT) expect(sent).not.toContain(t);
  });

  it("says what the act's subscribe feed says", () => {
    const c = calendarContent(gig(), { baseUrl: BASE });
    const feed = actFeedEvent(gig(), { baseUrl: BASE });
    expect(c.summary).toBe(feed.summary);
    expect(c.location).toBe(feed.location);
    expect(c.description).toBe(feed.description);
    expect(c.summary).toBe("The Velvet Owls @ The Crown");
    expect(c.location).toBe("The Crown, 1 High St, Leeds, UK");
    expect(c.description).toBe(
      ["Status: Confirmed", "Arrive by 18:00", "Soundcheck 18:30", "On stage 19:00", "Contact: Sam, 07700 900123", `Details: ${BASE}/app/gigs/ckgig1`].join(
        "\n",
      ),
    );
    expect(c.start).toEqual(new Date("2026-07-04T17:00:00Z"));
    expect(c.end).toEqual(new Date("2026-07-04T20:00:00Z"));
  });

  it("keeps the act's subscribe feed exactly as it was before the builder was shared", () => {
    // Lines captured from /api/calendar/[token] before actFeedEvent was moved out of the route.
    const b = gig({
      id: "capbooking1",
      artist: { name: "The Owls" },
      venue: { name: "The Crown; Upstairs", address: "1 High St", city: "Leeds", country: "UK" },
      arriveBy: new Date("2027-01-04T17:00:00Z"),
      soundcheckAt: new Date("2027-01-04T17:30:00Z"),
      setStart: new Date("2027-01-04T18:00:00Z"),
      setEnd: new Date("2027-01-04T20:00:00Z"),
      dayContact: "Sam, 07700",
    });
    const ics = buildIcs("The Owls · Gigsaw", [actFeedEvent(b, { baseUrl: "http://localhost:3000" })], { timezone: "Europe/London" });
    const event = ics.slice(ics.indexOf("BEGIN:VEVENT"), ics.indexOf("END:VCALENDAR"));
    expect(event).toBe(
      [
        "BEGIN:VEVENT",
        "UID:capbooking1@gigsaw",
        "DTSTAMP:20260601T091500Z",
        "LAST-MODIFIED:20260601T091500Z",
        "SEQUENCE:1270635",
        "DTSTART;TZID=Europe/London:20270104T170000",
        "DTEND;TZID=Europe/London:20270104T200000",
        "SUMMARY:The Owls @ The Crown\\; Upstairs",
        "LOCATION:The Crown\\; Upstairs\\, 1 High St\\, Leeds\\, UK",
        "DESCRIPTION:Status: Confirmed\\nArrive by 17:00\\nSoundcheck 17:30\\nOn stage ",
        " 18:00\\nContact: Sam\\, 07700\\nDetails: http://localhost:3000/app/gigs/capbo",
        " oking1",
        "URL:http://localhost:3000/app/gigs/capbooking1",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "",
      ].join("\r\n"),
    );
  });

  it("marks a hold in the title, and copes with no venue or act yet", () => {
    const c = calendarContent(gig({ status: "HOLD", venue: null, artist: null }), { baseUrl: BASE });
    expect(c.summary).toBe("[HOLD] Needs an act");
    expect(c.location).toBe("");
  });

  it("sends the venue's wall-clock time with its time zone to both providers", () => {
    const c = calendarContent(gig({ timezone: "America/New_York", arriveBy: new Date("2026-07-04T23:00:00Z"), setEnd: new Date("2026-07-05T03:30:00Z") }), {
      baseUrl: BASE,
    });
    expect(c.timeZone).toBe("America/New_York");
    const g = googleEventBody(c, "ckgig1");
    expect(g.start).toEqual({ dateTime: "2026-07-04T19:00:00", timeZone: "America/New_York" });
    expect(g.end).toEqual({ dateTime: "2026-07-04T23:30:00", timeZone: "America/New_York" });
    const m = microsoftEventBody(c);
    expect(m.start).toEqual({ dateTime: "2026-07-04T19:00:00", timeZone: "America/New_York" });
    expect(m.end).toEqual({ dateTime: "2026-07-04T23:30:00", timeZone: "America/New_York" });
    // Winter in London: no daylight saving.
    expect(wallClock(new Date("2026-12-24T00:00:00Z"), "Europe/London")).toBe("2026-12-24T00:00:00");
  });

  it("falls back to UTC for an unknown zone, and never ends before it starts", () => {
    const c = calendarContent(gig({ timezone: "Mars/Olympus", setEnd: new Date("2026-07-04T16:00:00Z") }), { baseUrl: BASE });
    expect(c.timeZone).toBe("UTC");
    expect(c.end.getTime()).toBeGreaterThan(c.start.getTime());
  });
});

describe("content hash", () => {
  const hash = (over: Partial<ActFeedBooking> = {}, provider: "GOOGLE" | "MICROSOFT" = "GOOGLE") =>
    contentHash(calendarContent(gig(over), { baseUrl: BASE }), provider);

  it("is the same for the same gig, whatever else changed on the booking", () => {
    expect(hash()).toBe(hash());
    expect(hash({ updatedAt: new Date() })).toBe(hash());
    expect(hash({ feeMinor: 1 } as Partial<ActFeedBooking>)).toBe(hash());
  });

  it("changes when anything the act sees changes", () => {
    const base = hash();
    expect(hash({ setStart: new Date("2026-07-04T18:30:00Z") })).not.toBe(base);
    expect(hash({ arriveBy: new Date("2026-07-04T16:30:00Z") })).not.toBe(base);
    expect(hash({ status: "HOLD" })).not.toBe(base);
    expect(hash({ dayContact: "Jo" })).not.toBe(base);
    expect(hash({ venue: { name: "The Swan", address: "", city: "York", country: "UK" } })).not.toBe(base);
    expect(hash({ timezone: "Europe/Dublin" })).not.toBe(base);
    expect(hash({}, "MICROSOFT")).not.toBe(base);
  });
});

describe("which gigs go in", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const g = (over: Partial<Parameters<typeof belongsInCalendar>[0]> = {}) => ({
    status: "CONFIRMED",
    archivedAt: null,
    artistId: "actA",
    setStart: new Date("2026-12-01T20:00:00Z"),
    ...over,
  });

  it("takes the act feed's statuses less cancelled", () => {
    expect(CALENDAR_STATUSES).toEqual(["AWAITING", "HOLD", "CONFIRMED", "SETTLED"]);
    for (const s of CALENDAR_STATUSES) expect(belongsInCalendar(g({ status: s }), ["actA"], { now })).toBe(true);
    for (const s of ["CANCELLED", "PENDING", "ENQUIRY"]) expect(belongsInCalendar(g({ status: s }), ["actA"], { now })).toBe(false);
  });

  it("leaves out archived gigs, other acts' gigs and gigs with no act", () => {
    expect(belongsInCalendar(g({ archivedAt: new Date() }), ["actA"], { now })).toBe(false);
    expect(belongsInCalendar(g({ artistId: "actB" }), ["actA"], { now })).toBe(false);
    expect(belongsInCalendar(g({ artistId: null }), ["actA"], { now })).toBe(false);
    // A band the act is in counts when it's in the list (actIdsFor adds bands).
    expect(belongsInCalendar(g({ artistId: "band" }), ["actA", "band"], { now })).toBe(true);
  });

  it("goes back 90 days like the feed, unless the gig is already in the calendar", () => {
    const old = g({ setStart: new Date("2026-07-01T20:00:00Z") });
    expect(belongsInCalendar(old, ["actA"], { now })).toBe(false);
    expect(belongsInCalendar(old, ["actA"], { now, ignoreAge: true })).toBe(true);
    expect(belongsInCalendar(g({ setStart: new Date("2026-09-01T20:00:00Z") }), ["actA"], { now })).toBe(true);
  });

  it("plans create, update, delete and skip", () => {
    expect(planSync(true, null, "h1")).toBe("create");
    expect(planSync(true, { contentHash: "h1" }, "h1")).toBe("skip");
    expect(planSync(true, { contentHash: "h0" }, "h1")).toBe("update");
    expect(planSync(false, { contentHash: "h1" }, null)).toBe("delete");
    expect(planSync(false, null, null)).toBe("skip");
  });
});

// ---------------------------------------------------------------------------------------------
// Provider clients

type Call = { method: string; url: string; body: string };

function fakeFetch(handler: (c: Call) => { status: number; json?: unknown }) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const c = { method: init?.method ?? "GET", url: String(url), body: typeof init?.body === "string" ? init.body : "" };
    calls.push(c);
    const r = handler(c);
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status, headers: { "Content-Type": "application/json" } });
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const testEnv: Pick<ServerEnv, "oauth" | "oauthTestBase" | "calendarTokenKey"> = {
  oauth: { google: { clientId: "gid", clientSecret: "gsecret" }, microsoft: { clientId: "mid", clientSecret: "msecret" } },
  oauthTestBase: "http://stand.in",
  calendarTokenKey: KEY,
};

function conn(over: Partial<StoredConnection> = {}): StoredConnection {
  return {
    id: "conn1",
    provider: "GOOGLE",
    calendarId: "primary",
    refreshTokenEnc: sealToken("refresh-1", KEY),
    accessTokenEnc: "",
    accessTokenExpiresAt: null,
    ...over,
  };
}

const NOW = Date.parse("2026-11-12T12:00:00Z");
const content = calendarContent(gig(), { baseUrl: BASE });

function client(c: StoredConnection, handler: Parameters<typeof fakeFetch>[0], env: typeof testEnv = testEnv) {
  const f = fakeFetch(handler);
  const saved: Record<string, unknown>[] = [];
  const cl = new CalendarClient(c, { env, fetcher: f.fetcher, now: () => NOW, saveTokens: async (u) => void saved.push(u) });
  return { cl, calls: f.calls, saved };
}

describe("calendar API addresses", () => {
  it("uses the real APIs unless a test stand-in is set", () => {
    expect(apiBase("GOOGLE", { oauthTestBase: null })).toBe("https://www.googleapis.com/calendar/v3");
    expect(apiBase("MICROSOFT", { oauthTestBase: null })).toBe("https://graph.microsoft.com/v1.0");
    expect(apiBase("GOOGLE", { oauthTestBase: "http://stand.in" })).toBe("http://stand.in/google/calendar/v3");
    expect(apiBase("MICROSOFT", { oauthTestBase: "http://stand.in" })).toBe("http://stand.in/graph/v1.0");
  });
});

describe("calendar client", () => {
  it("uses a stored access token while it lasts, and adds the event", async () => {
    const stored = conn({ accessTokenEnc: sealToken("access-0", KEY), accessTokenExpiresAt: new Date(NOW + 30 * 60_000) });
    const { cl, calls, saved } = client(stored, () => ({ status: 200, json: { id: "evt1" } }));
    expect(await cl.createEvent(content, "ckgig1")).toBe("evt1");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("http://stand.in/google/calendar/v3/calendars/primary/events?sendUpdates=none");
    for (const t of MONEY_TEXT) expect(calls[0].body).not.toContain(t);
    expect(saved).toEqual([]);
  });

  it("refreshes an expired token and keeps the new one, sealed", async () => {
    const stored = conn({ accessTokenEnc: sealToken("old", KEY), accessTokenExpiresAt: new Date(NOW - 1000) });
    const { cl, calls, saved } = client(stored, (c) =>
      c.url.endsWith("/token") ? { status: 200, json: { access_token: "access-1", expires_in: 3599 } } : { status: 200, json: { id: "evt1" } },
    );
    await cl.createEvent(content, "ckgig1");
    expect(calls[0].url).toBe("http://stand.in/google/token");
    const form = new URLSearchParams(calls[0].body);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("refresh-1");
    expect(form.get("client_id")).toBe("gid");
    expect(saved).toHaveLength(1);
    expect(openToken(saved[0].accessTokenEnc as string, KEY)).toBe("access-1");
    expect(saved[0].accessTokenExpiresAt).toEqual(new Date(NOW + 3599_000));
    expect(saved[0].refreshTokenEnc).toBeUndefined();
  });

  it("keeps Microsoft's new refresh token, and uses the default calendar or the chosen one", async () => {
    const { cl, calls, saved } = client(conn({ provider: "MICROSOFT" }), (c) =>
      c.url.endsWith("/token")
        ? { status: 200, json: { access_token: "a", refresh_token: "refresh-2", expires_in: 3600 } }
        : { status: 201, json: { id: "AAMk1" } },
    );
    expect(await cl.createEvent(content, "ckgig1")).toBe("AAMk1");
    expect(calls[0].url).toBe("http://stand.in/microsoft/common/oauth2/v2.0/token");
    expect(new URLSearchParams(calls[0].body).get("scope")).toContain("Calendars.ReadWrite");
    expect(calls[1].url).toBe("http://stand.in/graph/v1.0/me/calendar/events");
    expect(openToken(saved[0].refreshTokenEnc as string, KEY)).toBe("refresh-2");

    const chosen = client(conn({ provider: "MICROSOFT", calendarId: "AQMkCal" }), (c) =>
      c.url.endsWith("/token") ? { status: 200, json: { access_token: "a", expires_in: 3600 } } : { status: 201, json: { id: "x" } },
    );
    await chosen.cl.createEvent(content, "ckgig1");
    expect(chosen.calls[1].url).toBe("http://stand.in/graph/v1.0/me/calendars/AQMkCal/events");
    await chosen.cl.updateEvent("x", content, "ckgig1");
    expect(chosen.calls[2]).toMatchObject({ method: "PATCH", url: "http://stand.in/graph/v1.0/me/events/x" });
  });

  it("treats invalid_grant as access withdrawn", async () => {
    const { cl } = client(conn(), () => ({ status: 400, json: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }));
    await expect(cl.createEvent(content, "ckgig1")).rejects.toBeInstanceOf(CalendarAccessError);
  });

  it("refreshes once on a 401, and gives up on a second 401 straight after the refresh", async () => {
    const stored = conn({ accessTokenEnc: sealToken("stale", KEY), accessTokenExpiresAt: new Date(NOW + 30 * 60_000) });
    let apiCalls = 0;
    const ok = client(stored, (c) => {
      if (c.url.endsWith("/token")) return { status: 200, json: { access_token: "fresh", expires_in: 3600 } };
      return ++apiCalls === 1 ? { status: 401 } : { status: 200, json: { id: "evt1" } };
    });
    expect(await ok.cl.createEvent(content, "ckgig1")).toBe("evt1");
    expect(ok.calls.map((c) => c.url.endsWith("/token"))).toEqual([false, true, false]);

    const dead = client(conn(), (c) => (c.url.endsWith("/token") ? { status: 200, json: { access_token: "fresh", expires_in: 3600 } } : { status: 401 }));
    await expect(dead.cl.createEvent(content, "ckgig1")).rejects.toBeInstanceOf(CalendarAccessError);
  });

  it("sorts other failures: gone, rate limits, forbidden, provider errors", async () => {
    const stored = conn({ accessTokenEnc: sealToken("a", KEY), accessTokenExpiresAt: new Date(NOW + 30 * 60_000) });
    expect(await client(stored, () => ({ status: 404 })).cl.updateEvent("e", content, "b")).toBe("gone");
    expect(await client(stored, () => ({ status: 410 })).cl.updateEvent("e", content, "b")).toBe("gone");
    await expect(client(stored, () => ({ status: 410 })).cl.deleteEvent("e")).resolves.toBeUndefined();
    await expect(client(stored, () => ({ status: 204 })).cl.deleteEvent("e")).resolves.toBeUndefined();
    const limited = client(stored, () => ({ status: 403, json: { error: { code: 403, errors: [{ reason: "rateLimitExceeded" }] } } }));
    await expect(limited.cl.deleteEvent("e")).rejects.toBeInstanceOf(CalendarApiError);
    const forbidden = client(stored, () => ({ status: 403, json: { error: { code: 403, errors: [{ reason: "forbidden" }] } } }));
    await expect(forbidden.cl.createEvent(content, "b")).rejects.toBeInstanceOf(CalendarAccessError);
    await expect(client(stored, () => ({ status: 404 })).cl.createEvent(content, "b")).rejects.toBeInstanceOf(CalendarAccessError);
    await expect(client(stored, () => ({ status: 503 })).cl.createEvent(content, "b")).rejects.toBeInstanceOf(CalendarApiError);
    const down = new CalendarClient(stored, {
      env: testEnv,
      now: () => NOW,
      saveTokens: async () => {},
      fetcher: (async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
    });
    await expect(down.createEvent(content, "b")).rejects.toBeInstanceOf(CalendarApiError);
  });

  it("says when the server isn't set up, rather than blaming the act", async () => {
    await expect(client(conn(), () => ({ status: 200 }), { ...testEnv, calendarTokenKey: null }).cl.createEvent(content, "b")).rejects.toBeInstanceOf(
      CalendarSetupError,
    );
    await expect(
      client(conn(), () => ({ status: 200 }), { ...testEnv, oauth: { google: null, microsoft: null } }).cl.createEvent(content, "b"),
    ).rejects.toBeInstanceOf(CalendarSetupError);
    // A refresh token sealed with a different key can only be fixed by connecting again.
    const otherKey = conn({ refreshTokenEnc: sealToken("r", Buffer.alloc(32, 9)) });
    await expect(client(otherKey, () => ({ status: 200 })).cl.createEvent(content, "b")).rejects.toBeInstanceOf(CalendarAccessError);
  });
});
