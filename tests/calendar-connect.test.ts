import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeDb, createTestAgency, removeTestAgency } from "./helpers/db";

// Connecting an act's own Google or Outlook calendar (src/lib/calendar-connect.ts). Google and Microsoft are
// stood in for by a fake fetch; the sync engine's entry points are mocked so we can see when they're called.
// The database tests run only against the test database (see tests/helpers/db.ts).

vi.mock("server-only", () => ({}));
const sync = vi.hoisted(() => ({
  resyncConnection: vi.fn(async (id: string) => void id),
  removeConnectionEvents: vi.fn(async (id: string) => void id),
  syncBookingToCalendars: vi.fn(async (id: string) => void id),
}));
vi.mock("@/lib/calendar-sync", () => sync);
const nav = vi.hoisted(() => ({ user: null as unknown, redirects: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    nav.redirects.push(to);
  },
  notFound: () => {},
}));
vi.mock("@/lib/auth", () => ({ requireUser: async () => nav.user }));

const cc = await import("@/lib/calendar-connect");
const { pkceChallenge } = await import("@/lib/oauth");
const { parseEnv } = await import("@/server/env");
const { openToken } = await import("@/server/token-box");

const BASE = "https://idp.test";
const KEY = randomBytes(32);
const env = parseEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://x/y",
  GOOGLE_CLIENT_ID: "g-client",
  GOOGLE_CLIENT_SECRET: "g-secret",
  MICROSOFT_CLIENT_ID: "m-client",
  MICROSOFT_CLIENT_SECRET: "m-secret",
  CALENDAR_TOKEN_KEY: KEY.toString("base64"),
  OAUTH_TEST_BASE: BASE,
}).env;
const REDIRECT = "https://gigsaw.test/api/calendar-connect/google/callback";
const TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const EVENTS = "https://www.googleapis.com/auth/calendar.events";

// ---------------------------------------------------------------------------------------------
// A stand-in for Google and Microsoft

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
function idToken(claims: Record<string, unknown>) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${enc({ alg: "RS256", kid: "k1", typ: "JWT" })}.${enc(claims)}`;
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
}
const nowS = () => Math.floor(Date.now() / 1000);
const googleClaims = (nonce: string, over: Record<string, unknown> = {}) => ({
  iss: `${BASE}/google`,
  aud: "g-client",
  sub: "g-123",
  email: "Jo.Rivers@Example.com",
  email_verified: true,
  nonce,
  iat: nowS() - 5,
  exp: nowS() + 3600,
  ...over,
});
const microsoftClaims = (nonce: string, over: Record<string, unknown> = {}) => ({
  iss: `${BASE}/microsoft/${TENANT}/v2.0`,
  aud: "m-client",
  sub: "m-123",
  tid: TENANT,
  preferred_username: "jo@outlook.com",
  nonce,
  iat: nowS() - 5,
  exp: nowS() + 3600,
  ...over,
});

type Reply = { status?: number; body: unknown };
type Call = { url: string; body: string; auth: string };
let routes: Record<string, (call: Call) => Reply> = {};
let calls: Call[] = [];
const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const call = { url, body: typeof init?.body === "string" ? init.body : "", auth: String(new Headers(init?.headers).get("authorization") ?? "") };
  calls.push(call);
  const key = Object.keys(routes).find((k) => url.startsWith(k));
  const reply = key ? routes[key](call) : { status: 404, body: { error: "not_found" } };
  return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "Content-Type": "application/json" } });
});

beforeEach(() => {
  vi.stubGlobal("fetch", fakeFetch);
  calls = [];
  routes = { [`${BASE}/google/jwks`]: () => ({ body: { keys: [jwk] } }), [`${BASE}/microsoft/common/discovery/v2.0/keys`]: () => ({ body: { keys: [jwk] } }) };
  sync.resyncConnection.mockClear();
  sync.removeConnectionEvents.mockClear();
  nav.redirects = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The token endpoint answers with these tokens (and an id_token for the flow's nonce). */
function tokenReply(provider: "google" | "microsoft", flow: { nonce: string }, over: Record<string, unknown> = {}, claims: Record<string, unknown> = {}) {
  const id_token = idToken(provider === "google" ? googleClaims(flow.nonce, claims) : microsoftClaims(flow.nonce, claims));
  const scope = provider === "google" ? `openid ${EVENTS} https://www.googleapis.com/auth/userinfo.email` : "openid email Calendars.ReadWrite User.Read";
  routes[provider === "google" ? `${BASE}/google/token` : `${BASE}/microsoft/common/oauth2/v2.0/token`] = () => ({
    body: { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3599, scope, id_token, ...over },
  });
}

const act = (id = "user-1") => ({ id, role: "ARTIST", artistId: "act-1", agencyId: "agency-1" });

// ---------------------------------------------------------------------------------------------

describe("starting to connect", () => {
  it("offers a provider only when the token key and its sign-in settings are set", () => {
    expect(cc.calendarProviders(env)).toEqual(["google", "microsoft"]);
    expect(cc.calendarProviders({ ...env, calendarTokenKey: null })).toEqual([]);
    expect(cc.calendarProviders({ ...env, oauth: { google: null, microsoft: env.oauth.microsoft } })).toEqual(["microsoft"]);
  });

  it("only lets an act's own login connect", () => {
    expect(cc.canConnectCalendar({ role: "ARTIST", artistId: "a", agencyId: "x" })).toBe(true);
    expect(cc.canConnectCalendar({ role: "ARTIST", artistId: null, agencyId: "x" })).toBe(false);
    expect(cc.canConnectCalendar({ role: "ADMIN", artistId: "a", agencyId: "x" })).toBe(false);
  });

  it("asks Google for calendar events, offline access and fresh consent, with PKCE and state", () => {
    const flow = cc.newCalendarFlow("google", "user-1");
    const url = new URL(cc.calendarAuthorizeUrl(flow, { clientId: "g-client", redirectUri: REDIRECT, env }));
    expect(url.origin + url.pathname).toBe(`${BASE}/google/authorize`);
    const q = Object.fromEntries(url.searchParams);
    expect(q.scope.split(" ")).toEqual(expect.arrayContaining(["openid", "email", EVENTS, "https://www.googleapis.com/auth/calendar.calendarlist.readonly"]));
    expect(q.access_type).toBe("offline");
    expect(q.prompt).toBe("consent");
    expect(q.state).toBe(flow.state);
    expect(q.nonce).toBe(flow.nonce);
    expect(q.code_challenge).toBe(pkceChallenge(flow.verifier));
    expect(q.code_challenge_method).toBe("S256");
    expect(q.redirect_uri).toBe(REDIRECT);
    expect(q.response_type).toBe("code");
    // The verifier never leaves the server.
    expect(url.toString()).not.toContain(flow.verifier);
    expect(flow.userId).toBe("user-1");
  });

  it("asks Microsoft for offline access and calendars, and suggests the connected account when reconnecting", () => {
    const flow = cc.newCalendarFlow("microsoft", "user-1");
    const url = new URL(cc.calendarAuthorizeUrl(flow, { clientId: "m-client", redirectUri: REDIRECT, env, loginHint: "jo@outlook.com" }));
    expect(url.pathname).toBe("/microsoft/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")!.split(" ")).toEqual(expect.arrayContaining(["openid", "offline_access", "Calendars.ReadWrite", "User.Read"]));
    expect(url.searchParams.get("response_mode")).toBe("query");
    expect(url.searchParams.get("access_type")).toBeNull();
    expect(url.searchParams.get("login_hint")).toBe("jo@outlook.com");
  });

  it("uses the calendar callback, not the sign-in one", () => {
    expect(cc.calendarRedirectUri("google", "https://gigsaw.live/")).toBe("https://gigsaw.live/api/calendar-connect/google/callback");
    expect(cc.calendarRedirectUri("microsoft", "https://gigsaw.live")).toBe("https://gigsaw.live/api/calendar-connect/microsoft/callback");
  });
});

describe("coming back from the provider", () => {
  const opts = { redirectUri: REDIRECT, env };

  it("refuses a state that doesn't match, an expired flow, or one for the other provider", async () => {
    const flow = cc.newCalendarFlow("google", "user-1");
    expect(await cc.finishConnect(act(), "google", flow, { code: "c", state: "someone-else" }, opts)).toEqual({ result: "state" });
    expect(await cc.finishConnect(act(), "google", null, { code: "c", state: flow.state }, opts)).toEqual({ result: "expired" });
    expect(await cc.finishConnect(act(), "microsoft", flow, { code: "c", state: flow.state }, opts)).toEqual({ result: "expired" });
    expect(calls).toEqual([]);
  });

  it("refuses a flow started by a different login", async () => {
    const flow = cc.newCalendarFlow("google", "someone-else");
    expect(await cc.finishConnect(act("user-1"), "google", flow, { code: "c", state: flow.state }, opts)).toEqual({ result: "wrong_user" });
    expect(calls).toEqual([]);
  });

  it("tells a cancel from other provider errors", async () => {
    const flow = cc.newCalendarFlow("google", "user-1");
    expect(await cc.finishConnect(act(), "google", flow, { error: "access_denied", state: flow.state }, opts)).toEqual({ result: "cancelled" });
    expect(await cc.finishConnect(act(), "google", flow, { error: "server_error", state: flow.state }, opts)).toEqual({ result: "failed" });
  });

  it("refuses when not set up, or for a staff login", async () => {
    const flow = cc.newCalendarFlow("google", "user-1");
    const off = { ...opts, env: { ...env, calendarTokenKey: null } };
    expect(await cc.finishConnect(act(), "google", flow, { code: "c", state: flow.state }, off)).toEqual({ result: "off" });
    expect(await cc.finishConnect(act(), null, flow, { code: "c", state: flow.state }, opts)).toEqual({ result: "off" });
    const staff = { ...act(), role: "ADMIN" };
    expect(await cc.finishConnect(staff, "google", flow, { code: "c", state: flow.state }, opts)).toEqual({ result: "not_act" });
  });

  it("sends the code with the PKCE verifier, and needs a refresh token", async () => {
    const flow = cc.newCalendarFlow("google", "user-1");
    tokenReply("google", flow, { refresh_token: undefined });
    expect(await cc.finishConnect(act(), "google", flow, { code: "the-code", state: flow.state }, opts)).toEqual({ result: "no_refresh" });
    const sent = new URLSearchParams(calls.find((c) => c.url.endsWith("/google/token"))!.body);
    expect(sent.get("code")).toBe("the-code");
    expect(sent.get("code_verifier")).toBe(flow.verifier);
    expect(sent.get("redirect_uri")).toBe(REDIRECT);
    expect(sent.get("client_secret")).toBe("g-secret");
    expect(sync.resyncConnection).not.toHaveBeenCalled();
  });

  it("needs the calendar box ticked on Google's consent screen", async () => {
    const flow = cc.newCalendarFlow("google", "user-1");
    tokenReply("google", flow, { scope: "openid https://www.googleapis.com/auth/userinfo.email" });
    expect(await cc.finishConnect(act(), "google", flow, { code: "c", state: flow.state }, opts)).toEqual({ result: "scope" });
  });

  it("refuses an id_token with the wrong nonce or for another app", async () => {
    const flow = cc.newCalendarFlow("google", "user-1");
    tokenReply("google", flow, {}, { nonce: "not-ours" });
    expect(await cc.finishConnect(act(), "google", flow, { code: "c", state: flow.state }, opts)).toEqual({ result: "failed" });
    tokenReply("google", flow, {}, { aud: "another-app" });
    expect(await cc.finishConnect(act(), "google", flow, { code: "c", state: flow.state }, opts)).toEqual({ result: "failed" });
  });

  it("reports a refused code as a failure", async () => {
    const flow = cc.newCalendarFlow("google", "user-1");
    routes[`${BASE}/google/token`] = () => ({ status: 400, body: { error: "invalid_grant" } });
    expect(await cc.finishConnect(act(), "google", flow, { code: "c", state: flow.state }, opts)).toEqual({ result: "failed" });
  });

  it("reads the granted calendar access from either provider's answer", () => {
    expect(cc.grantedCalendarAccess("google", `openid ${EVENTS}`)).toBe(true);
    expect(cc.grantedCalendarAccess("google", "openid email")).toBe(false);
    expect(cc.grantedCalendarAccess("microsoft", "https://graph.microsoft.com/Calendars.ReadWrite openid")).toBe(true);
    expect(cc.grantedCalendarAccess("microsoft", "User.Read openid")).toBe(false);
  });
});

describe("words", () => {
  it("explains every outcome plainly, without jargon or dashes", () => {
    for (const code of ["connected", "disconnected", "cancelled", "expired", "state", "wrong_user", "no_refresh", "scope", "off", "not_act", "failed"])
      for (const p of ["google", "microsoft", null] as const) {
        const msg = cc.calendarMessage(code, p);
        expect(msg?.text).toBeTruthy();
        expect(msg!.text).not.toMatch(/—|OAuth|token|sorry/i);
      }
    expect(cc.calendarMessage("connected", "google")?.text).toContain("Google Calendar is connected");
    expect(cc.calendarMessage("nonsense", "google")).toBeNull();
  });

  it("gives staff one line about the act's calendar", () => {
    expect(cc.staffCalendarLine([], true)).toMatch(/not connected/);
    expect(cc.staffCalendarLine([], false)).toBeNull();
    expect(cc.staffCalendarLine([{ provider: "GOOGLE", accountEmail: "jo@gmail.com", status: "ACTIVE" }], true)).toBe(
      "Calendar: Google Calendar connected (jo@gmail.com). New and changed gigs go straight in.",
    );
    expect(cc.staffCalendarLine([{ provider: "MICROSOFT", accountEmail: "", status: "NEEDS_RECONNECT" }], true)).toMatch(
      /^Calendar: Outlook needs reconnecting/,
    );
  });
});

// ---------------------------------------------------------------------------------------------

describeDb("connecting, choosing and disconnecting (database)", () => {
  let prisma: (typeof import("@/lib/db"))["prisma"];
  let agencyId = "";
  let user = { id: "", role: "ARTIST", artistId: "" as string | null, agencyId: "" as string | null };
  let other = { id: "" };
  const opts = { redirectUri: REDIRECT, env };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "calconnect");
    agencyId = t.agency.id;
    const artist = await prisma.artist.create({ data: { agencyId, name: "Jo Rivers", demo: true } });
    const u = await prisma.user.create({
      data: { email: `act-${t.stamp}@gigsaw.invalid`, name: "Jo Rivers", passwordHash: "x", role: "ARTIST", agencyId, artistId: artist.id },
    });
    user = { id: u.id, role: "ARTIST", artistId: artist.id, agencyId };
    const artist2 = await prisma.artist.create({ data: { agencyId, name: "Other act", demo: true } });
    other = await prisma.user.create({
      data: { email: `act2-${t.stamp}@gigsaw.invalid`, name: "Other", passwordHash: "x", role: "ARTIST", agencyId, artistId: artist2.id },
    });
  });
  afterAll(async () => {
    await removeTestAgency(prisma, agencyId);
  });
  beforeEach(async () => {
    await prisma.calendarConnection.deleteMany({ where: { agencyId } });
  });

  const connectGoogle = async (over: Record<string, unknown> = {}, claims: Record<string, unknown> = {}) => {
    const flow = cc.newCalendarFlow("google", user.id);
    tokenReply("google", flow, over, claims);
    return cc.finishConnect(user, "google", flow, { code: "c", state: flow.state }, opts);
  };

  it("saves the connection with sealed tokens, then asks for the gigs to be added", async () => {
    const done = await connectGoogle();
    expect(done.result).toBe("connected");
    const row = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: done.connectionId } });
    expect(row).toMatchObject({
      userId: user.id,
      agencyId,
      provider: "GOOGLE",
      accountEmail: "jo.rivers@example.com",
      calendarId: "primary",
      status: "ACTIVE",
      lastError: "",
    });
    // Never stored in plain text, and only opens with the key.
    expect(row.refreshTokenEnc).not.toContain("refresh-1");
    expect(openToken(row.refreshTokenEnc, KEY)).toBe("refresh-1");
    expect(openToken(row.accessTokenEnc, KEY)).toBe("access-1");
    expect(row.accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 3500_000);
    expect(sync.resyncConnection).toHaveBeenCalledWith(row.id);
    expect(sync.removeConnectionEvents).not.toHaveBeenCalled();
  });

  it("uses Microsoft's sign-in name when there's no email claim", async () => {
    const flow = cc.newCalendarFlow("microsoft", user.id);
    tokenReply("microsoft", flow);
    const done = await cc.finishConnect(
      user,
      "microsoft",
      flow,
      { code: "c", state: flow.state },
      { ...opts, redirectUri: REDIRECT.replace("google", "microsoft") },
    );
    expect(done.result).toBe("connected");
    const row = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: done.connectionId } });
    expect(row).toMatchObject({ provider: "MICROSOFT", accountEmail: "jo@outlook.com", calendarId: "primary" });
  });

  it("reconnecting the same account clears the problem and keeps the chosen calendar", async () => {
    const first = await connectGoogle();
    await prisma.calendarConnection.update({
      where: { id: first.connectionId },
      data: { status: "NEEDS_RECONNECT", lastError: "invalid_grant", calendarId: "band@group.calendar.google.com", calendarName: "Band" },
    });
    sync.resyncConnection.mockClear();
    const again = await connectGoogle({ refresh_token: "refresh-2" });
    expect(again.connectionId).toBe(first.connectionId);
    const row = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: first.connectionId } });
    expect(row).toMatchObject({ status: "ACTIVE", lastError: "", calendarId: "band@group.calendar.google.com", calendarName: "Band" });
    expect(openToken(row.refreshTokenEnc, KEY)).toBe("refresh-2");
    expect(sync.removeConnectionEvents).not.toHaveBeenCalled();
    expect(sync.resyncConnection).toHaveBeenCalledWith(first.connectionId);
    expect(await prisma.calendarConnection.count({ where: { userId: user.id } })).toBe(1);
  });

  it("connecting a different account takes the gigs out of the old one and starts in the main calendar", async () => {
    const first = await connectGoogle();
    await prisma.calendarConnection.update({ where: { id: first.connectionId }, data: { calendarId: "band@group", calendarName: "Band" } });
    await prisma.calendarEventLink.create({ data: { connectionId: first.connectionId!, bookingId: "b1", externalId: "e1" } });
    const again = await connectGoogle({}, { email: "someone.else@example.com" });
    expect(sync.removeConnectionEvents).toHaveBeenCalledWith(first.connectionId);
    const row = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: again.connectionId } });
    expect(row).toMatchObject({ accountEmail: "someone.else@example.com", calendarId: "primary", calendarName: "" });
    expect(await prisma.calendarEventLink.count({ where: { connectionId: row.id } })).toBe(0);
  });

  it("disconnecting takes the gigs out first, then cancels Google's access and deletes the connection", async () => {
    const { connectionId } = await connectGoogle();
    let rowAtRemoval = false;
    sync.removeConnectionEvents.mockImplementationOnce(async (id: string) => {
      rowAtRemoval = !!(await prisma.calendarConnection.findUnique({ where: { id } }));
    });
    routes[`${BASE}/google/revoke`] = () => ({ body: {} });
    expect(await cc.disconnectCalendar(user.id, connectionId!, { env })).toBe("google");
    expect(sync.removeConnectionEvents).toHaveBeenCalledWith(connectionId);
    expect(rowAtRemoval).toBe(true);
    const revoke = calls.find((c) => c.url === `${BASE}/google/revoke`);
    expect(new URLSearchParams(revoke!.body).get("token")).toBe("refresh-1");
    expect(await prisma.calendarConnection.findUnique({ where: { id: connectionId } })).toBeNull();
  });

  it("still disconnects when Google can't be reached, and never touches someone else's", async () => {
    const { connectionId } = await connectGoogle();
    expect(await cc.disconnectCalendar(other.id, connectionId!, { env })).toBeNull();
    expect(sync.removeConnectionEvents).not.toHaveBeenCalled();
    expect(await prisma.calendarConnection.findUnique({ where: { id: connectionId } })).not.toBeNull();
    routes[`${BASE}/google/revoke`] = () => ({ status: 503, body: {} });
    expect(await cc.disconnectCalendar(user.id, connectionId!, { env })).toBe("google");
    expect(await prisma.calendarConnection.findUnique({ where: { id: connectionId } })).toBeNull();
  });

  it("the Disconnect button's action disconnects and sends the act back with a message", async () => {
    const { connectionId } = await connectGoogle();
    routes[`${BASE}/google/revoke`] = () => ({ body: {} });
    nav.user = { ...user };
    const prev = process.env.CALENDAR_TOKEN_KEY;
    process.env.CALENDAR_TOKEN_KEY = KEY.toString("base64");
    process.env.OAUTH_TEST_BASE = BASE;
    try {
      const { disconnectMyCalendar } = await import("@/actions/calendar-connect");
      await disconnectMyCalendar(connectionId!);
    } finally {
      process.env.CALENDAR_TOKEN_KEY = prev;
      delete process.env.OAUTH_TEST_BASE;
    }
    expect(nav.redirects).toEqual(["/app?calendar=disconnected&p=google#calendar"]);
    expect(await prisma.calendarConnection.findUnique({ where: { id: connectionId } })).toBeNull();
  });

  it("lists the act's calendars and moves the gigs to the one they choose", async () => {
    const { connectionId } = await connectGoogle();
    routes[`${BASE}/google/calendar/v3/users/me/calendarList`] = (call) => {
      expect(call.auth).toBe("Bearer access-1");
      expect(call.url).toContain("minAccessRole=writer");
      return {
        body: {
          items: [
            { id: "band@group.calendar.google.com", summary: "Band" },
            { id: "jo.rivers@example.com", summary: "jo.rivers@example.com", primary: true },
          ],
        },
      };
    };
    const conn = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const list = await cc.listCalendars(conn, { env });
    expect(list.map((c) => c.name)).toEqual(["jo.rivers@example.com", "Band"]);
    expect(cc.currentChoice(conn, list)?.main).toBe(true);

    expect(await cc.chooseCalendar(other.id, connectionId!, "band@group.calendar.google.com", { env })).toEqual({
      error: "That calendar isn't connected any more.",
    });
    expect(await cc.chooseCalendar(user.id, connectionId!, "not-mine", { env })).toEqual({ error: "Choose one of your calendars." });
    expect(sync.removeConnectionEvents).not.toHaveBeenCalled();

    sync.resyncConnection.mockClear();
    const done = await cc.chooseCalendar(user.id, connectionId!, "band@group.calendar.google.com", { env });
    expect(done).toMatchObject({ name: "Band" });
    expect(sync.removeConnectionEvents).toHaveBeenCalledWith(connectionId);
    expect(sync.resyncConnection).toHaveBeenCalledWith(connectionId);
    expect(sync.removeConnectionEvents.mock.invocationCallOrder[0]).toBeLessThan(sync.resyncConnection.mock.invocationCallOrder[0]);
    expect(await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connectionId } })).toMatchObject({
      calendarId: "band@group.calendar.google.com",
      calendarName: "Band",
    });

    // Back to the main one: saved as "primary", so it follows the account's main calendar.
    await cc.chooseCalendar(user.id, connectionId!, "jo.rivers@example.com", { env });
    expect(await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connectionId } })).toMatchObject({ calendarId: "primary", calendarName: "" });
  });

  it("gets a new access token when the stored one has run out, and marks a refused refresh as needing reconnecting", async () => {
    const { connectionId } = await connectGoogle();
    await prisma.calendarConnection.update({ where: { id: connectionId }, data: { accessTokenExpiresAt: new Date(Date.now() - 1000) } });
    routes[`${BASE}/google/token`] = (call) => {
      expect(new URLSearchParams(call.body).get("refresh_token")).toBe("refresh-1");
      return { body: { access_token: "access-2", expires_in: 3600 } };
    };
    let conn = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(await cc.accessTokenFor(conn, { env })).toBe("access-2");
    conn = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(openToken(conn.accessTokenEnc, KEY)).toBe("access-2");

    await prisma.calendarConnection.update({ where: { id: connectionId }, data: { accessTokenExpiresAt: new Date(Date.now() - 1000) } });
    routes[`${BASE}/google/token`] = () => ({ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } });
    conn = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connectionId } });
    await expect(cc.accessTokenFor(conn, { env })).rejects.toBeInstanceOf(cc.ReconnectNeeded);
    expect(await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connectionId } })).toMatchObject({ status: "NEEDS_RECONNECT" });
  });

  it("lists Outlook calendars the act can add to, default first", async () => {
    const flow = cc.newCalendarFlow("microsoft", user.id);
    tokenReply("microsoft", flow);
    const { connectionId } = await cc.finishConnect(user, "microsoft", flow, { code: "c", state: flow.state }, opts);
    routes[`${BASE}/microsoft/graph/v1.0/me/calendars`] = () => ({
      body: {
        value: [
          { id: "AAA", name: "Birthdays", canEdit: false },
          { id: "BBB", name: "Gigs", canEdit: true },
          { id: "CCC", name: "Calendar", canEdit: true, isDefaultCalendar: true },
        ],
      },
    });
    const conn = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(await cc.listCalendars(conn, { env })).toEqual([
      { id: "CCC", name: "Calendar", main: true },
      { id: "BBB", name: "Gigs", main: false },
    ]);
  });
});
