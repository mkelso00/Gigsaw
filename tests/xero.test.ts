import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Xero (src/lib/xero.ts, src/actions/xero.ts, Settings, Xero). Xero is stood in for by a fake fetch: its sign-in,
// token, connections and Accounting API answer from `routes` below, at the stand-in addresses that XERO_LOGIN_BASE,
// XERO_IDENTITY_BASE and XERO_API_BASE point at. The database tests run only against the test database
// (see tests/helpers/db.ts).

vi.mock("server-only", () => ({}));
const nav = vi.hoisted(() => ({ user: null as unknown, redirects: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    nav.redirects.push(to);
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
// The browser's cookies, for the connect and callback routes.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => (value ? jar.set(name, value) : jar.delete(name)),
  }),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => nav.user, requireUser: async () => nav.user, requireStaff: async () => nav.user }));
// The real forms are client components; on the server they only need to show their contents.
vi.mock("@/components/forms", () => ({
  ActionForm: ({ children }: { children: unknown }) => children,
  ServerForm: ({ children }: { children: unknown }) => children,
  SubmitButton: ({ children }: { children: unknown }) => children,
  ConfirmButton: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/components/client-bits", () => ({ CopyField: ({ value }: { value: string }) => value }));

const xero = await import("@/lib/xero");
const { parseEnv } = await import("@/server/env");
const { openToken, sealToken } = await import("@/server/token-box");

const LOGIN = "https://xero.test/login";
const IDENTITY = "https://xero.test/identity";
const API = "https://xero.test/api";
const KEY = randomBytes(32);
const RAW_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://x/y",
  XERO_CLIENT_ID: "x-client",
  XERO_CLIENT_SECRET: "x-secret",
  XERO_TOKEN_KEY: KEY.toString("base64"),
  XERO_LOGIN_BASE: LOGIN,
  XERO_IDENTITY_BASE: IDENTITY,
  XERO_API_BASE: API,
};
const env = parseEnv(RAW_ENV).env;
const REDIRECT = "https://gigsaw.test/api/xero/callback";
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const INVOICE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const INVOICE_2 = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
const CONTACT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const noSleep = vi.fn(async (ms: number) => void ms);

// ---------------------------------------------------------------------------------------------
// A stand-in for Xero

type Reply = { status?: number; body: unknown; headers?: Record<string, string> };
type Call = { method: string; url: string; body: string; headers: Headers };
let routes: Record<string, (call: Call) => Reply> = {};
let calls: Call[] = [];
const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const call = { method, url, body: typeof init?.body === "string" ? init.body : "", headers: new Headers(init?.headers) };
  calls.push(call);
  // Longest match first, so "PUT https://…/Invoices" beats a shorter one.
  const key = Object.keys(routes)
    .sort((a, b) => b.length - a.length)
    .find((k) => {
      const [m, prefix] = k.includes(" ") ? k.split(" ") : ["", k];
      return (!m || m === method) && url.startsWith(prefix);
    });
  const reply = key ? routes[key](call) : { status: 404, body: { Title: "Not found" } };
  return new Response(JSON.stringify(reply.body), {
    status: reply.status ?? 200,
    headers: { "Content-Type": "application/json", ...reply.headers },
  });
});

beforeEach(() => {
  vi.stubGlobal("fetch", fakeFetch);
  calls = [];
  routes = {};
  nav.redirects = [];
  noSleep.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** An access token like Xero's: a JWT whose claims say which sign-in made it. Gigsaw never checks its signature. */
const accessToken = (name: string, authEventId = "event-1") =>
  `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ authentication_event_id: authEventId, n: name })).toString("base64url")}.sig`;

/** The token endpoint answers a code with these tokens, and /connections with these organisations. */
function connectReplies(tenants: { tenantId: string; tenantName: string; authEventId?: string; tenantType?: string }[], over: Record<string, unknown> = {}) {
  routes[`POST ${IDENTITY}/connect/token`] = () => ({
    body: { access_token: accessToken("a1"), refresh_token: "refresh-1", expires_in: 1800, token_type: "Bearer", ...over },
  });
  routes[`GET ${API}/connections`] = () => ({
    body: tenants.map((t, i) => ({ id: `conn-${i}`, authEventId: "event-1", tenantType: "ORGANISATION", createdDateUtc: "2026-11-19T10:00:00", ...t })),
  });
}

const json = (call: Call) => JSON.parse(call.body);

// ---------------------------------------------------------------------------------------------

describe("settings and the start of connecting", () => {
  it("is off without the client id and secret, or a key for the tokens; the key falls back to the calendar one", () => {
    expect(xero.xeroSetup(env)).toBe("ready");
    const none = parseEnv({ NODE_ENV: "test" });
    expect(none.env.xero).toBeNull();
    expect(xero.xeroSetup(none.env)).toBe("no_app");
    const half = parseEnv({ NODE_ENV: "test", XERO_CLIENT_ID: "x" });
    expect(half.env.xero).toBeNull();
    expect(half.warnings.join(" ")).toMatch(/Xero is half set up: XERO_CLIENT_ID is set but XERO_CLIENT_SECRET is not/);
    const noKey = parseEnv({ NODE_ENV: "test", XERO_CLIENT_ID: "x", XERO_CLIENT_SECRET: "y" });
    expect(xero.xeroSetup(noKey.env)).toBe("no_key");
    expect(noKey.warnings.join(" ")).toMatch(/XERO_TOKEN_KEY/);
    const calendarKey = randomBytes(32);
    const shared = parseEnv({ NODE_ENV: "test", XERO_CLIENT_ID: "x", XERO_CLIENT_SECRET: "y", CALENDAR_TOKEN_KEY: calendarKey.toString("base64") });
    expect(shared.env.xeroTokenKey?.equals(calendarKey)).toBe(true);
    expect(parseEnv({ NODE_ENV: "test", XERO_TOKEN_KEY: "short" }).env.xeroTokenKey).toBeNull();
  });

  it("uses Xero's own servers unless a stand-in is set, and never a stand-in in production", () => {
    expect(parseEnv({ NODE_ENV: "test" }).env.xeroBases).toEqual({
      login: "https://login.xero.com",
      identity: "https://identity.xero.com",
      api: "https://api.xero.com",
    });
    expect(env.xeroBases).toEqual({ login: LOGIN, identity: IDENTITY, api: API });
    const prod = parseEnv({ ...RAW_ENV, NODE_ENV: "production", APP_URL: "https://gigsaw.live" });
    expect(prod.env.xeroBases.api).toBe("https://api.xero.com");
    expect(prod.warnings.join(" ")).toMatch(/XERO_API_BASE is only for testing/);
  });

  it("sends the admin to Xero's sign-in for the granular scopes and offline access, with state", () => {
    const flow = xero.newXeroFlow({ id: "user-1", agencyId: "agency-1" });
    const url = new URL(xero.xeroAuthorizeUrl(flow, { redirectUri: REDIRECT, env }));
    expect(url.origin + url.pathname).toBe(`${LOGIN}/identity/connect/authorize`);
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({ response_type: "code", client_id: "x-client", redirect_uri: REDIRECT, state: flow.state });
    expect(q.scope.split(" ").sort()).toEqual(["accounting.contacts", "accounting.invoices", "accounting.settings.read", "offline_access"]);
    expect(q.scope).not.toContain("accounting.transactions");
    expect(flow.state.length).toBeGreaterThan(30);
    expect(xero.xeroRedirectUri("https://gigsaw.live/")).toBe("https://gigsaw.live/api/xero/callback");
  });

  it("explains every outcome plainly, without dashes or apologies", () => {
    for (const code of ["connected", "choose", "disconnected", "cancelled", "expired", "state", "wrong_user", "no_refresh", "no_org", "off", "failed"]) {
      const m = xero.xeroConnectMessage(code, "Northern Lights Ltd");
      expect(m, code).not.toBeNull();
      expect(m!.text).not.toMatch(/[—–]|sorry|apolog/i);
    }
    expect(xero.xeroConnectMessage(undefined)).toBeNull();
    expect(xero.xeroConnectMessage("connected", "Northern Lights Ltd")!.text).toContain("Northern Lights Ltd");
  });
});

describe("the invoice Gigsaw sends", () => {
  const settings = { salesAccountCode: "200", taxType: "OUTPUT2", dueDays: null };
  const input = {
    contactName: "The Crown",
    reference: "PO-4471",
    date: "2026-10-31",
    currency: "gbp",
    lines: [
      { description: "Gigs in October 2026" },
      { description: "12 Oct, The Crown: Ellie Hart, 8pm to 11pm", unitAmountMinor: 25000 },
      { description: "19 Oct, The Crown: The Lamplighters, 8.30pm to 11.30pm", unitAmountMinor: 45050, quantity: 1 },
      { description: "Booking fee", unitAmountMinor: 1999, quantity: 2, taxType: "NONE", accountCode: "260" },
    ],
  };

  it("is a draft sales invoice, ex VAT, with the PO as its reference and pence turned into pounds", () => {
    const body = xero.draftInvoicePayload(settings, CONTACT_ID, input);
    expect(body).toEqual({
      Invoices: [
        {
          Type: "ACCREC",
          Contact: { ContactID: CONTACT_ID },
          Date: "2026-10-31",
          Reference: "PO-4471",
          Status: "DRAFT",
          LineAmountTypes: "Exclusive",
          CurrencyCode: "GBP",
          LineItems: [
            { Description: "Gigs in October 2026" },
            { Description: "12 Oct, The Crown: Ellie Hart, 8pm to 11pm", Quantity: 1, UnitAmount: 250, AccountCode: "200", TaxType: "OUTPUT2" },
            { Description: "19 Oct, The Crown: The Lamplighters, 8.30pm to 11.30pm", Quantity: 1, UnitAmount: 450.5, AccountCode: "200", TaxType: "OUTPUT2" },
            { Description: "Booking fee", Quantity: 2, UnitAmount: 19.99, AccountCode: "260", TaxType: "NONE" },
          ],
        },
      ],
    });
    // Exactly what goes over the wire: no float noise.
    expect(JSON.stringify(body)).toContain('"UnitAmount":19.99');
  });

  it("is due when asked, or after the set days, or else on Xero's terms", () => {
    expect(xero.draftInvoicePayload(settings, CONTACT_ID, input).Invoices[0]).not.toHaveProperty("DueDate");
    expect(xero.draftInvoicePayload({ ...settings, dueDays: 14 }, CONTACT_ID, input).Invoices[0].DueDate).toBe("2026-11-14");
    expect(xero.draftInvoicePayload({ ...settings, dueDays: 14 }, CONTACT_ID, { ...input, dueDate: "2026-12-01" }).Invoices[0].DueDate).toBe("2026-12-01");
    // A Date is the day in London: 23:30 UTC on 31 March is 1 April there.
    expect(xero.draftInvoicePayload(settings, CONTACT_ID, { ...input, date: new Date("2026-03-31T23:30:00Z") }).Invoices[0].Date).toBe("2026-04-01");
  });

  it("refuses an invoice with nothing to charge, a fraction of a penny, a bad currency or date", () => {
    expect(() => xero.draftInvoicePayload(settings, CONTACT_ID, { ...input, lines: [{ description: "Just words" }] })).toThrow(/nothing on it/);
    expect(() => xero.draftInvoicePayload(settings, CONTACT_ID, { ...input, lines: [{ description: "x", unitAmountMinor: 10.5 }] })).toThrow(
      /whole number of pence/,
    );
    expect(() => xero.draftInvoicePayload(settings, CONTACT_ID, { ...input, currency: "pounds" })).toThrow(/currency/);
    expect(() => xero.draftInvoicePayload(settings, CONTACT_ID, { ...input, date: "31/10/2026" })).toThrow(/isn't a date/);
    expect(() => xero.draftInvoicePayload(settings, CONTACT_ID, { ...input, lines: [{ description: " ", unitAmountMinor: 100 }] })).toThrow(/description/);
  });

  it("writes one gig as a line", () => {
    expect(xero.gigLineDescription({ date: "2026-10-12", venue: "The Crown", act: "Ellie Hart", start: "20:00", end: "23:00" })).toBe(
      "12 Oct, The Crown: Ellie Hart, 8pm to 11pm",
    );
    expect(xero.gigLineDescription({ date: "2026-09-05", venue: "Bar 1", act: "DJ Sol", start: "12:30", end: "00:15" })).toBe(
      "5 Sep, Bar 1: DJ Sol, 12.30pm to 12.15am",
    );
    expect(xero.gigLineDescription({ date: "2026-09-05", venue: "Bar 1", act: "DJ Sol" })).toBe("5 Sep, Bar 1: DJ Sol");
  });

  it("links into Xero through the organisation's short code", () => {
    expect(xero.xeroInvoiceUrl(INVOICE_ID, "!abc12")).toBe(
      `https://go.xero.com/organisationlogin/default.aspx?shortcode=!abc12&redirecturl=/AccountsReceivable/View.aspx?InvoiceID=${INVOICE_ID}`,
    );
    expect(xero.xeroInvoiceUrl(INVOICE_ID)).toBe(`https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${INVOICE_ID}`);
  });
});

describe("what Xero says back", () => {
  it("maps Xero's statuses, with money in on an approved invoice as part paid", () => {
    expect(xero.invoiceState("DRAFT")).toBe("draft");
    expect(xero.invoiceState("SUBMITTED")).toBe("awaiting_approval");
    expect(xero.invoiceState("AUTHORISED")).toBe("awaiting_payment");
    expect(xero.invoiceState("AUTHORISED", 100)).toBe("part_paid");
    expect(xero.invoiceState("PAID", 100)).toBe("paid");
    expect(xero.invoiceState("VOIDED")).toBe("voided");
    expect(xero.invoiceState("DELETED")).toBe("deleted");
    expect(xero.invoiceState("ODD")).toBe("unknown");
  });

  it("reads Xero's dates", () => {
    expect(xero.parseXeroDate("/Date(1792972800000+0000)/")).toBe("2026-10-26");
    expect(xero.parseXeroDate("/Date(1792972800000)/")).toBe("2026-10-26");
    expect(xero.parseXeroDate("2026-10-26T00:00:00")).toBe("2026-10-26");
    expect(xero.parseXeroDate(undefined)).toBeNull();
    expect(xero.parseXeroDate("soon")).toBeNull();
  });

  it("picks the validation messages out of Xero's errors", () => {
    expect(
      xero.xeroProblems({
        ErrorNumber: 10,
        Type: "ValidationException",
        Message: "A validation exception occurred",
        Elements: [
          {
            ValidationErrors: [{ Message: "Account code '999' is not a valid code for this document." }],
            LineItems: [{ ValidationErrors: [{ Message: "The TaxType code 'OUTPUT9' does not exist or cannot be used for this type of transaction." }] }],
          },
        ],
      }),
    ).toEqual([
      "Account code '999' is not a valid code for this document.",
      "The TaxType code 'OUTPUT9' does not exist or cannot be used for this type of transaction.",
    ]);
    expect(xero.xeroProblems({ Title: "Forbidden", Status: 403, Detail: "AuthenticationUnsuccessful" })).toEqual(["AuthenticationUnsuccessful"]);
    expect(xero.xeroProblems(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describeDb("Xero with the database", () => {
  let prisma: (typeof import("@/lib/db"))["prisma"];
  let agencyId = "";
  let otherAgencyId = "";
  let admin = { id: "", agencyId: "", role: "ADMIN", email: "" };
  let otherAdmin = { id: "", agencyId: "", role: "ADMIN", email: "" };
  const opts = { redirectUri: REDIRECT, env };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const a = await createTestAgency(prisma, "xero");
    agencyId = a.agency.id;
    admin = { id: a.admin.id, agencyId, role: "ADMIN", email: a.admin.email };
    const b = await createTestAgency(prisma, "xero-other");
    otherAgencyId = b.agency.id;
    otherAdmin = { id: b.admin.id, agencyId: otherAgencyId, role: "ADMIN", email: b.admin.email };
  });
  afterAll(async () => {
    await removeTestAgency(prisma, agencyId);
    await removeTestAgency(prisma, otherAgencyId);
  });
  beforeEach(async () => {
    await prisma.xeroConnection.deleteMany({ where: { agencyId: { in: [agencyId, otherAgencyId] } } });
  });

  /** Connects the test agency to one organisation, as the callback would. */
  const connect = async (tenants = [{ tenantId: TENANT_A, tenantName: "Northern Lights Ltd" }]) => {
    const flow = xero.newXeroFlow(admin);
    connectReplies(tenants);
    const done = await xero.finishXeroConnect(admin, flow, { code: "code-1", state: flow.state }, opts);
    routes = {};
    calls = [];
    return done;
  };
  const load = () => prisma.xeroConnection.findUniqueOrThrow({ where: { agencyId } });
  /** The stored access token has run out, so the next call refreshes it. */
  const expire = () => prisma.xeroConnection.update({ where: { agencyId }, data: { accessTokenExpiresAt: new Date(Date.now() - 1000) } });

  describe("connecting", () => {
    it("swaps the code for tokens with the app's secret, picks the organisation and seals the tokens", async () => {
      const flow = xero.newXeroFlow(admin);
      connectReplies([{ tenantId: TENANT_A, tenantName: "Northern Lights Ltd" }]);
      expect(await xero.finishXeroConnect(admin, flow, { code: "code-1", state: flow.state }, opts)).toEqual({ result: "connected" });

      const token = calls.find((c) => c.url === `${IDENTITY}/connect/token`)!;
      expect(token.headers.get("authorization")).toBe(`Basic ${Buffer.from("x-client:x-secret").toString("base64")}`);
      expect(Object.fromEntries(new URLSearchParams(token.body))).toEqual({ grant_type: "authorization_code", code: "code-1", redirect_uri: REDIRECT });
      const conns = calls.find((c) => c.url === `${API}/connections`)!;
      expect(conns.headers.get("authorization")).toBe(`Bearer ${accessToken("a1")}`);

      const conn = await load();
      expect(conn).toMatchObject({ tenantId: TENANT_A, tenantName: "Northern Lights Ltd", connectedById: admin.id, needsReconnect: false, lastError: "" });
      expect(conn.refreshTokenEnc).not.toContain("refresh-1");
      expect(openToken(conn.refreshTokenEnc, KEY)).toBe("refresh-1");
      expect(openToken(conn.accessTokenEnc, KEY)).toBe(accessToken("a1"));
      expect(conn.accessTokenExpiresAt!.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
      expect(conn.salesAccountCode).toBe("200");
      expect(conn.taxType).toBe("OUTPUT2");
    });

    it("refuses a state that doesn't match, a lost or expired flow, someone else's flow, and a cancel", async () => {
      connectReplies([{ tenantId: TENANT_A, tenantName: "Org" }]);
      const flow = xero.newXeroFlow(admin);
      expect(await xero.finishXeroConnect(admin, flow, { code: "c", state: "not-it" }, opts)).toEqual({ result: "state" });
      expect(await xero.finishXeroConnect(admin, null, { code: "c", state: flow.state }, opts)).toEqual({ result: "expired" });
      expect(await xero.finishXeroConnect(admin, { ...flow, exp: Date.now() - 1 }, { code: "c", state: flow.state }, opts)).toEqual({ result: "expired" });
      expect(await xero.finishXeroConnect({ ...admin, id: "someone-else" }, flow, { code: "c", state: flow.state }, opts)).toEqual({ result: "wrong_user" });
      expect(await xero.finishXeroConnect({ ...admin, agencyId: otherAgencyId }, flow, { code: "c", state: flow.state }, opts)).toEqual({
        result: "wrong_user",
      });
      expect(await xero.finishXeroConnect(admin, flow, { error: "access_denied", state: flow.state }, opts)).toEqual({ result: "cancelled" });
      expect(await xero.finishXeroConnect(admin, flow, { state: flow.state }, opts)).toEqual({ result: "failed" });
      expect(await xero.finishXeroConnect(admin, flow, { code: "c", state: flow.state }, { ...opts, env: { ...env, xero: null } })).toEqual({ result: "off" });
      // None of those reached Xero or saved anything.
      expect(calls).toEqual([]);
      expect(await prisma.xeroConnection.findUnique({ where: { agencyId } })).toBeNull();
    });

    it("reports a refused code, no refresh token or no organisation", async () => {
      const flow = xero.newXeroFlow(admin);
      routes[`POST ${IDENTITY}/connect/token`] = () => ({ status: 400, body: { error: "invalid_grant" } });
      expect(await xero.finishXeroConnect(admin, flow, { code: "c", state: flow.state }, opts)).toEqual({ result: "failed" });
      connectReplies([{ tenantId: TENANT_A, tenantName: "Org" }], { refresh_token: undefined });
      expect(await xero.finishXeroConnect(admin, flow, { code: "c", state: flow.state }, opts)).toEqual({ result: "no_refresh" });
      connectReplies([{ tenantId: TENANT_A, tenantName: "A practice", tenantType: "PRACTICEMANAGER" }]);
      expect(await xero.finishXeroConnect(admin, flow, { code: "c", state: flow.state }, opts)).toEqual({ result: "no_org" });
      expect(await prisma.xeroConnection.findUnique({ where: { agencyId } })).toBeNull();
    });

    it("with several organisations takes one allowed just now, offers the rest, and switches only to one of them", async () => {
      const flow = xero.newXeroFlow(admin);
      connectReplies([
        { tenantId: TENANT_B, tenantName: "Old Org", authEventId: "event-0" },
        { tenantId: TENANT_A, tenantName: "Northern Lights Ltd", authEventId: "event-1" },
      ]);
      expect(await xero.finishXeroConnect(admin, flow, { code: "c", state: flow.state }, opts)).toEqual({ result: "choose" });
      let conn = await load();
      expect(conn.tenantId).toBe(TENANT_A);
      expect(xero.savedTenants(conn).map((t) => t.tenantName)).toEqual(["Old Org", "Northern Lights Ltd"]);

      await prisma.xeroConnection.update({ where: { agencyId }, data: { shortCode: "!old" } });
      expect(await xero.chooseXeroTenant(agencyId, TENANT_B)).toEqual({ tenantId: TENANT_B, tenantName: "Old Org" });
      conn = await load();
      expect(conn).toMatchObject({ tenantId: TENANT_B, tenantName: "Old Org", shortCode: "" });
      await expect(xero.chooseXeroTenant(agencyId, "33333333-3333-4333-8333-333333333333")).rejects.toThrow(/Choose one of the organisations/);
      // Another business can't switch this one's.
      await expect(xero.chooseXeroTenant(otherAgencyId, TENANT_A)).rejects.toBeInstanceOf(xero.XeroNotConnected);
    });

    it("reconnecting keeps the organisation and the invoice settings, and clears a problem", async () => {
      await connect();
      await prisma.xeroConnection.update({
        where: { agencyId },
        data: { needsReconnect: true, lastError: "Refused", salesAccountCode: "210", shortCode: "!keep" },
      });
      await connect();
      expect(await load()).toMatchObject({ tenantId: TENANT_A, needsReconnect: false, lastError: "", salesAccountCode: "210", shortCode: "!keep" });
    });

    it("the connect and callback routes keep the state in a signed cookie, used once", async () => {
      nav.user = { ...admin, agency: { status: "ACTIVE" } };
      const before = { ...process.env };
      Object.assign(process.env, RAW_ENV, { APP_URL: "https://gigsaw.test" });
      jar.clear();
      try {
        const { GET: start } = await import("@/app/api/xero/connect/route");
        const { GET: back } = await import("@/app/api/xero/callback/route");
        const go = async (fn: () => Promise<unknown>) => {
          await fn().catch((e: Error) => {
            if (!e.message.startsWith("REDIRECT ")) throw e;
          });
          return nav.redirects.at(-1)!;
        };
        const to = new URL(await go(() => start()));
        expect(to.origin + to.pathname).toBe(`${LOGIN}/identity/connect/authorize`);
        expect(to.searchParams.get("redirect_uri")).toBe(REDIRECT);
        const state = to.searchParams.get("state")!;
        const cookie = jar.get("gigsaw_xero_connect")!;
        expect(cookie).toBeTruthy();

        // Signed: a changed cookie isn't accepted.
        connectReplies([{ tenantId: TENANT_A, tenantName: "Northern Lights Ltd" }]);
        jar.set("gigsaw_xero_connect", `${cookie.slice(0, -2)}xx`);
        expect(await go(() => back(new Request(`https://gigsaw.test/api/xero/callback?code=c&state=${state}`)))).toBe("/settings/xero?xero=expired");

        jar.set("gigsaw_xero_connect", cookie);
        expect(await go(() => back(new Request(`https://gigsaw.test/api/xero/callback?code=c&state=wrong`)))).toBe("/settings/xero?xero=state");
        // That used the cookie up, so even the right state now fails.
        expect(await go(() => back(new Request(`https://gigsaw.test/api/xero/callback?code=c&state=${state}`)))).toBe("/settings/xero?xero=expired");
        expect(await prisma.xeroConnection.findUnique({ where: { agencyId } })).toBeNull();

        await go(() => start());
        const state2 = new URL(nav.redirects.at(-1)!).searchParams.get("state")!;
        expect(await go(() => back(new Request(`https://gigsaw.test/api/xero/callback?code=c&state=${state2}`)))).toBe("/settings/xero?xero=connected");
        expect((await load()).tenantName).toBe("Northern Lights Ltd");

        // Without Xero's settings, Connect goes back to the page with a message instead of to Xero.
        delete process.env.XERO_CLIENT_ID;
        expect(await go(() => start())).toBe("/settings/xero?xero=off");
      } finally {
        for (const k of [...Object.keys(RAW_ENV), "APP_URL"]) if (!(k in before)) delete process.env[k];
        Object.assign(process.env, before);
      }
    });

    it("disconnecting asks Xero to revoke the token, then forgets it but keeps the settings", async () => {
      await connect();
      await prisma.xeroConnection.update({ where: { agencyId }, data: { taxType: "NONE" } });
      routes[`POST ${IDENTITY}/connect/revocation`] = () => ({ body: {} });
      expect(await xero.disconnectXero(agencyId, { env })).toBe(true);
      const revoke = calls.find((c) => c.url === `${IDENTITY}/connect/revocation`)!;
      expect(new URLSearchParams(revoke.body).get("token")).toBe("refresh-1");
      expect(revoke.headers.get("authorization")).toMatch(/^Basic /);
      expect(await load()).toMatchObject({ tenantId: "", refreshTokenEnc: "", accessTokenEnc: "", taxType: "NONE" });
      expect(await xero.xeroConnectionFor(agencyId)).toBeNull();
      // Still forgets it when Xero can't be reached.
      await connect();
      routes[`POST ${IDENTITY}/connect/revocation`] = () => ({ status: 503, body: {} });
      expect(await xero.disconnectXero(agencyId, { env })).toBe(true);
      expect(await xero.xeroConnectionFor(agencyId)).toBeNull();
    });
  });

  describe("calls to Xero", () => {
    it("refreshes a run-out access token and saves the new refresh token Xero rotates to", async () => {
      await connect();
      await expire();
      routes[`POST ${IDENTITY}/connect/token`] = (call) => {
        expect(Object.fromEntries(new URLSearchParams(call.body))).toEqual({ grant_type: "refresh_token", refresh_token: "refresh-1" });
        expect(call.headers.get("authorization")).toBe(`Basic ${Buffer.from("x-client:x-secret").toString("base64")}`);
        return { body: { access_token: "access-2", refresh_token: "refresh-2", expires_in: 1800 } };
      };
      routes[`GET ${API}/api.xro/2.0/Organisation`] = (call) => {
        expect(call.headers.get("authorization")).toBe("Bearer access-2");
        expect(call.headers.get("xero-tenant-id")).toBe(TENANT_A);
        return { body: { Organisations: [{ Name: "Northern Lights Ltd", ShortCode: "!nl123", BaseCurrency: "GBP", CountryCode: "GB" }] } };
      };
      const conn = await load();
      expect(await xero.getXeroOrganisation(conn, { env })).toEqual({
        name: "Northern Lights Ltd",
        shortCode: "!nl123",
        baseCurrency: "GBP",
        countryCode: "GB",
      });
      const saved = await load();
      expect(openToken(saved.refreshTokenEnc, KEY)).toBe("refresh-2");
      expect(openToken(saved.accessTokenEnc, KEY)).toBe("access-2");
      expect(saved.shortCode).toBe("!nl123");

      // The fresh access token is used from now on, without refreshing again.
      calls = [];
      await xero.getXeroOrganisation(saved, { env });
      expect(calls.map((c) => c.url)).toEqual([`${API}/api.xro/2.0/Organisation`]);
    });

    it("a refused refresh token marks the connection as needing reconnecting, and stops calling Xero", async () => {
      await connect();
      await expire();
      routes[`POST ${IDENTITY}/connect/token`] = () => ({ status: 400, body: { error: "invalid_grant" } });
      const conn = await load();
      await expect(xero.getXeroOrganisation(conn, { env })).rejects.toBeInstanceOf(xero.XeroReconnectNeeded);
      expect(await load()).toMatchObject({ needsReconnect: true });
      expect((await load()).lastError).toMatch(/Connect Xero again/);
      calls = [];
      await expect(xero.getXeroOrganisation(await load(), { env })).rejects.toBeInstanceOf(xero.XeroReconnectNeeded);
      expect(calls).toEqual([]);
    });

    it("a 401 gets a fresh token and tries once more; refused again, the connection needs reconnecting", async () => {
      await connect();
      let n = 0;
      routes[`POST ${IDENTITY}/connect/token`] = () => ({ body: { access_token: `access-${++n + 1}`, refresh_token: `refresh-${n + 1}`, expires_in: 1800 } });
      routes[`GET ${API}/api.xro/2.0/Organisation`] = (call) =>
        call.headers.get("authorization") === "Bearer access-2"
          ? { body: { Organisations: [{ Name: "Northern Lights Ltd", ShortCode: "!nl" }] } }
          : { status: 401, body: { Title: "Unauthorized", Status: 401, Detail: "TokenExpired" } };
      expect((await xero.getXeroOrganisation(await load(), { env })).name).toBe("Northern Lights Ltd");
      expect(openToken((await load()).refreshTokenEnc, KEY)).toBe("refresh-2");

      routes[`GET ${API}/api.xro/2.0/Organisation`] = () => ({
        status: 401,
        body: { Title: "Unauthorized", Status: 401, Detail: "AuthenticationUnsuccessful" },
      });
      await expect(xero.getXeroOrganisation(await load(), { env })).rejects.toBeInstanceOf(xero.XeroReconnectNeeded);
      expect(await load()).toMatchObject({ needsReconnect: true });
    });

    it("a 403 (the organisation was disconnected from the app) needs reconnecting", async () => {
      await connect();
      routes[`GET ${API}/api.xro/2.0/Organisation`] = () => ({ status: 403, body: { Title: "Forbidden", Status: 403, Detail: "AuthenticationUnsuccessful" } });
      await expect(xero.getXeroOrganisation(await load(), { env })).rejects.toThrow(/refused access to Northern Lights Ltd/);
      expect(await load()).toMatchObject({ needsReconnect: true });
    });

    it("waits for Retry-After on a 429 and tries again, but not for the daily limit or too long", async () => {
      await connect();
      let n = 0;
      routes[`GET ${API}/api.xro/2.0/Organisation`] = () =>
        ++n < 3
          ? { status: 429, body: {}, headers: { "Retry-After": "7", "X-Rate-Limit-Problem": "minute" } }
          : { body: { Organisations: [{ Name: "Northern Lights Ltd" }] } };
      expect((await xero.getXeroOrganisation(await load(), { env, sleep: noSleep })).name).toBe("Northern Lights Ltd");
      expect(noSleep.mock.calls).toEqual([[7000], [7000]]);

      noSleep.mockClear();
      routes[`GET ${API}/api.xro/2.0/Organisation`] = () => ({ status: 429, body: {}, headers: { "Retry-After": "5", "X-Rate-Limit-Problem": "minute" } });
      const busy = await xero.getXeroOrganisation(await load(), { env, sleep: noSleep }).catch((e) => e);
      expect(busy).toBeInstanceOf(xero.XeroRateLimited);
      expect(busy.message).toMatch(/try again in a minute/);
      expect(noSleep).toHaveBeenCalledTimes(2);

      noSleep.mockClear();
      routes[`GET ${API}/api.xro/2.0/Organisation`] = () => ({ status: 429, body: {}, headers: { "Retry-After": "40000", "X-Rate-Limit-Problem": "day" } });
      await expect(xero.getXeroOrganisation(await load(), { env, sleep: noSleep })).rejects.toThrow(/daily limit/);
      expect(noSleep).not.toHaveBeenCalled();
      // A rate limit isn't a reason to reconnect.
      expect(await load()).toMatchObject({ needsReconnect: false });
    });

    it("finds the contact by its exact name, ignoring case, or adds it with the email", async () => {
      await connect();
      routes[`GET ${API}/api.xro/2.0/Contacts`] = () => ({
        body: {
          Contacts: [
            { ContactID: "x1", Name: "The Crown and Anchor", ContactStatus: "ACTIVE" },
            { ContactID: CONTACT_ID, Name: "the crown", ContactStatus: "ACTIVE" },
          ],
        },
      });
      expect(await xero.findOrCreateXeroContact(await load(), { name: " The  Crown ", email: "a@b.c" }, { env })).toEqual({
        contactId: CONTACT_ID,
        name: "the crown",
        created: false,
      });
      expect(calls.at(-1)!.url).toBe(`${API}/api.xro/2.0/Contacts?searchTerm=The%20Crown`);

      routes[`GET ${API}/api.xro/2.0/Contacts`] = () => ({ body: { Contacts: [{ ContactID: "x1", Name: "The Crown and Anchor" }] } });
      routes[`PUT ${API}/api.xro/2.0/Contacts`] = (call) => {
        expect(json(call)).toEqual({ Contacts: [{ Name: "The Crown", EmailAddress: "accounts@thecrown.test" }] });
        return { body: { Contacts: [{ ContactID: "new-1", Name: "The Crown" }] } };
      };
      expect(await xero.findOrCreateXeroContact(await load(), { name: "The Crown", email: "accounts@thecrown.test" }, { env })).toEqual({
        contactId: "new-1",
        name: "The Crown",
        created: true,
      });
      // A broken email is left out rather than refused by Xero.
      routes[`PUT ${API}/api.xro/2.0/Contacts`] = (call) => {
        expect(json(call)).toEqual({ Contacts: [{ Name: "The Crown" }] });
        return { body: { Contacts: [{ ContactID: "new-2", Name: "The Crown" }] } };
      };
      expect((await xero.findOrCreateXeroContact(await load(), { name: "The Crown", email: "not an email" }, { env })).contactId).toBe("new-2");
    });

    it("asks for an archived contact to be restored, and uses one added in Xero at the same moment", async () => {
      await connect();
      routes[`GET ${API}/api.xro/2.0/Contacts`] = () => ({ body: { Contacts: [{ ContactID: CONTACT_ID, Name: "The Crown", ContactStatus: "ARCHIVED" }] } });
      await expect(xero.findOrCreateXeroContact(await load(), { name: "The Crown" }, { env })).rejects.toThrow(/archived in Xero/);

      let searches = 0;
      routes[`GET ${API}/api.xro/2.0/Contacts`] = () => ({ body: { Contacts: ++searches === 1 ? [] : [{ ContactID: CONTACT_ID, Name: "The Crown" }] } });
      routes[`PUT ${API}/api.xro/2.0/Contacts`] = () => ({
        status: 400,
        body: {
          ErrorNumber: 10,
          Type: "ValidationException",
          Elements: [{ ValidationErrors: [{ Message: "The contact name The Crown is already assigned to another contact." }] }],
        },
      });
      expect(await xero.findOrCreateXeroContact(await load(), { name: "The Crown" }, { env })).toEqual({
        contactId: CONTACT_ID,
        name: "The Crown",
        created: false,
      });
    });

    it("creates the draft invoice and returns its number, id and a link into Xero", async () => {
      await connect();
      routes[`GET ${API}/api.xro/2.0/Contacts`] = () => ({ body: { Contacts: [{ ContactID: CONTACT_ID, Name: "The Crown" }] } });
      routes[`PUT ${API}/api.xro/2.0/Invoices`] = (call) => {
        const body = json(call);
        expect(body.Invoices[0]).toMatchObject({
          Type: "ACCREC",
          Status: "DRAFT",
          LineAmountTypes: "Exclusive",
          Reference: "PO-4471",
          Contact: { ContactID: CONTACT_ID },
          CurrencyCode: "GBP",
        });
        expect(body.Invoices[0].LineItems).toEqual([
          { Description: "12 Oct, The Crown: Ellie Hart, 8pm to 11pm", Quantity: 1, UnitAmount: 250, AccountCode: "200", TaxType: "OUTPUT2" },
        ]);
        expect(call.headers.get("idempotency-key")).toBe("bill-1");
        expect(call.headers.get("content-type")).toBe("application/json");
        return {
          body: {
            Invoices: [{ InvoiceID: INVOICE_ID, InvoiceNumber: "INV-0042", Status: "DRAFT", SubTotal: 250, TotalTax: 50, Total: 300, CurrencyCode: "GBP" }],
          },
        };
      };
      routes[`GET ${API}/api.xro/2.0/Organisation`] = () => ({ body: { Organisations: [{ Name: "Northern Lights Ltd", ShortCode: "!nl123" }] } });
      const made = await xero.createDraftInvoice(
        await load(),
        {
          contactName: "The Crown",
          reference: "PO-4471",
          date: "2026-10-31",
          currency: "GBP",
          lines: [{ description: "12 Oct, The Crown: Ellie Hart, 8pm to 11pm", unitAmountMinor: 25000 }],
          idempotencyKey: "bill-1",
        },
        { env },
      );
      expect(made).toEqual({
        invoiceId: INVOICE_ID,
        invoiceNumber: "INV-0042",
        status: "DRAFT",
        url: `https://go.xero.com/organisationlogin/default.aspx?shortcode=!nl123&redirecturl=/AccountsReceivable/View.aspx?InvoiceID=${INVOICE_ID}`,
        subTotalMinor: 25000,
        taxMinor: 5000,
        totalMinor: 30000,
      });
    });

    it("passes on Xero's validation messages, and checks the invoice before adding a contact", async () => {
      await connect();
      routes[`GET ${API}/api.xro/2.0/Contacts`] = () => ({ body: { Contacts: [{ ContactID: CONTACT_ID, Name: "The Crown" }] } });
      routes[`PUT ${API}/api.xro/2.0/Invoices`] = () => ({
        status: 400,
        body: {
          ErrorNumber: 10,
          Type: "ValidationException",
          Message: "A validation exception occurred",
          Elements: [{ ValidationErrors: [{ Message: "Account code '999' is not a valid code for this document." }] }],
        },
      });
      const base = { contactName: "The Crown", reference: "PO", date: "2026-10-31", currency: "GBP" };
      await expect(
        xero.createDraftInvoice(await load(), { ...base, lines: [{ description: "x", unitAmountMinor: 100, accountCode: "999" }] }, { env }),
      ).rejects.toThrow("Xero said: Account code '999' is not a valid code for this document.");
      calls = [];
      await expect(xero.createDraftInvoice(await load(), { ...base, lines: [] }, { env })).rejects.toThrow(/nothing on it/);
      expect(calls).toEqual([]);
    });

    it("reads an invoice's status and many at once", async () => {
      await connect();
      routes[`GET ${API}/api.xro/2.0/Invoices/${INVOICE_ID}`] = () => ({
        body: {
          Invoices: [
            {
              InvoiceID: INVOICE_ID,
              InvoiceNumber: "INV-0042",
              Status: "PAID",
              AmountDue: 0,
              AmountPaid: 300,
              Total: 300,
              CurrencyCode: "GBP",
              FullyPaidOnDate: "/Date(1792972800000+0000)/",
            },
          ],
        },
      });
      expect(await xero.getInvoiceStatus(await load(), INVOICE_ID, { env })).toEqual({
        invoiceId: INVOICE_ID,
        invoiceNumber: "INV-0042",
        status: "PAID",
        state: "paid",
        amountDueMinor: 0,
        amountPaidMinor: 30000,
        totalMinor: 30000,
        fullyPaidOn: "2026-10-26",
      });
      await expect(xero.getInvoiceStatus(await load(), "../Contacts", { env })).rejects.toThrow(/isn't a Xero invoice id/);

      routes[`GET ${API}/api.xro/2.0/Invoices?IDs=`] = (call) => {
        expect(call.url).toBe(`${API}/api.xro/2.0/Invoices?IDs=${INVOICE_ID},${INVOICE_2}`);
        return {
          body: {
            Invoices: [
              { InvoiceID: INVOICE_ID.toUpperCase(), InvoiceNumber: "INV-0042", Status: "AUTHORISED", AmountDue: 100.5, AmountPaid: 199.5, Total: 300 },
              { InvoiceID: INVOICE_2, InvoiceNumber: "INV-0043", Status: "VOIDED", AmountDue: 0, AmountPaid: 0, Total: 120 },
            ],
          },
        };
      };
      const many = await xero.getInvoiceStatuses(await load(), [INVOICE_ID, INVOICE_2, INVOICE_ID, "nonsense"], { env });
      expect(many.get(INVOICE_ID)).toMatchObject({ state: "part_paid", amountDueMinor: 10050, amountPaidMinor: 19950 });
      expect(many.get(INVOICE_2)).toMatchObject({ state: "voided", fullyPaidOn: null });
    });
  });

  describe("the actions the billing page uses", () => {
    const withEnv = async <T>(fn: () => Promise<T>) => {
      const before = { ...process.env };
      Object.assign(process.env, RAW_ENV, { NODE_ENV: "test" });
      try {
        return await fn();
      } finally {
        for (const k of Object.keys(RAW_ENV)) if (!(k in before)) delete process.env[k];
        Object.assign(process.env, before);
      }
    };

    it("sendInvoiceToXero makes the draft with a month heading, the PO as reference and one line a gig", async () => {
      await connect();
      await prisma.xeroConnection.update({ where: { agencyId }, data: { shortCode: "!nl123", dueDays: 30 } });
      routes[`GET ${API}/api.xro/2.0/Contacts`] = () => ({ body: { Contacts: [] } });
      routes[`PUT ${API}/api.xro/2.0/Contacts`] = () => ({ body: { Contacts: [{ ContactID: CONTACT_ID, Name: "Crown Inns Ltd" }] } });
      routes[`PUT ${API}/api.xro/2.0/Invoices`] = (call) => {
        const inv = json(call).Invoices[0];
        expect(inv).toMatchObject({ Reference: "PO-9", Date: "2026-10-31", DueDate: "2026-11-30", Status: "DRAFT", LineAmountTypes: "Exclusive" });
        expect(inv.LineItems.map((l: { Description: string }) => l.Description)).toEqual([
          "Gigs in October 2026",
          "12 Oct, The Crown: Ellie Hart, 8pm to 11pm",
          "19 Oct, The Crown: Ellie Hart, 8pm to 11pm",
        ]);
        expect(call.headers.get("idempotency-key")).toBe(`gigsaw-${agencyId}-bill-7`);
        return { body: { Invoices: [{ InvoiceID: INVOICE_ID, InvoiceNumber: "INV-0050", Status: "DRAFT", SubTotal: 500, TotalTax: 100, Total: 600 }] } };
      };
      nav.user = admin;
      const { sendInvoiceToXero } = await import("@/actions/xero");
      const res = await withEnv(() =>
        sendInvoiceToXero({
          contactName: "Crown Inns Ltd",
          contactEmail: "accounts@crown.test",
          poNumber: "PO-9",
          monthLabel: "October 2026",
          currency: "GBP",
          date: "2026-10-31",
          idempotencyKey: "bill-7",
          lines: [
            {
              description: xero.gigLineDescription({ date: "2026-10-12", venue: "The Crown", act: "Ellie Hart", start: "20:00", end: "23:00" }),
              unitAmountMinor: 25000,
            },
            {
              description: xero.gigLineDescription({ date: "2026-10-19", venue: "The Crown", act: "Ellie Hart", start: "20:00", end: "23:00" }),
              unitAmountMinor: 25000,
            },
          ],
        }),
      );
      expect(res).toEqual({
        ok: true,
        invoiceId: INVOICE_ID,
        invoiceNumber: "INV-0050",
        status: "DRAFT",
        url: `https://go.xero.com/organisationlogin/default.aspx?shortcode=!nl123&redirecturl=/AccountsReceivable/View.aspx?InvoiceID=${INVOICE_ID}`,
        subTotalMinor: 50000,
        taxMinor: 10000,
        totalMinor: 60000,
      });
      expect(await prisma.activity.count({ where: { agencyId, entity: "XERO", entityId: INVOICE_ID } })).toBe(1);
    });

    it("only reaches the signed-in admin's own business's Xero", async () => {
      await connect();
      nav.user = otherAdmin;
      const { sendInvoiceToXero, syncXeroStatuses } = await import("@/actions/xero");
      const sent = await withEnv(() =>
        sendInvoiceToXero({ contactName: "The Crown", monthLabel: "October 2026", currency: "GBP", lines: [{ description: "Gig", unitAmountMinor: 100 }] }),
      );
      expect(sent).toEqual({ ok: false, error: "Xero isn't connected. Connect it in Settings, Xero first." });
      expect(await withEnv(() => syncXeroStatuses([{ id: "b1", xeroInvoiceId: INVOICE_ID }]))).toMatchObject({ ok: false });
      expect(calls).toEqual([]);
    });

    it("tells billing when Xero needs reconnecting", async () => {
      await connect();
      await prisma.xeroConnection.update({ where: { agencyId }, data: { needsReconnect: true } });
      nav.user = admin;
      const { sendInvoiceToXero } = await import("@/actions/xero");
      const res = await withEnv(() =>
        sendInvoiceToXero({ contactName: "The Crown", monthLabel: "October 2026", currency: "GBP", lines: [{ description: "Gig", unitAmountMinor: 100 }] }),
      );
      expect(res).toMatchObject({ ok: false, reconnect: true, error: expect.stringMatching(/connecting again/) });
    });

    it("syncXeroStatuses says what each invoice is up to, keyed by the caller's ids", async () => {
      await connect();
      routes[`GET ${API}/api.xro/2.0/Invoices?IDs=`] = () => ({
        body: {
          Invoices: [
            {
              InvoiceID: INVOICE_ID,
              InvoiceNumber: "INV-1",
              Status: "PAID",
              AmountDue: 0,
              AmountPaid: 600,
              Total: 600,
              FullyPaidOnDate: "/Date(1792972800000+0000)/",
            },
          ],
        },
      });
      nav.user = admin;
      const { syncXeroStatuses } = await import("@/actions/xero");
      const res = await withEnv(() =>
        syncXeroStatuses([
          { id: "bill-1", xeroInvoiceId: INVOICE_ID },
          { id: "bill-2", xeroInvoiceId: INVOICE_2 },
          { id: "bill-3", xeroInvoiceId: "" },
        ]),
      );
      expect(res).toEqual({
        ok: true,
        results: [
          {
            id: "bill-1",
            xeroInvoiceId: INVOICE_ID,
            ok: true,
            invoiceNumber: "INV-1",
            status: "PAID",
            state: "paid",
            label: "Paid",
            amountDueMinor: 0,
            amountPaidMinor: 60000,
            totalMinor: 60000,
            fullyPaidOn: "2026-10-26",
          },
          { id: "bill-2", xeroInvoiceId: INVOICE_2, ok: false, error: "Xero couldn't find this invoice in the connected organisation." },
          { id: "bill-3", xeroInvoiceId: "", ok: false, error: "Not sent to Xero yet." },
        ],
      });
    });
  });

  describe("Settings, Xero", () => {
    const render = async (search: Record<string, string> = {}) => {
      const { renderToStaticMarkup } = await import("react-dom/server");
      (globalThis as { React?: unknown }).React = await import("react");
      const { default: Page } = await import("@/app/(agency)/settings/xero/page");
      return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(search) }));
    };
    const withoutXero = async <T>(fn: () => Promise<T>) => {
      const names = [...Object.keys(RAW_ENV).filter((k) => k.startsWith("XERO_")), "CALENDAR_TOKEN_KEY"];
      const before = Object.fromEntries(names.map((k) => [k, process.env[k]]));
      for (const k of names) delete process.env[k];
      try {
        return await fn();
      } finally {
        for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v;
      }
    };

    it("without Xero's settings, explains what to set in Railway and the redirect URL instead of offering Connect", async () => {
      nav.user = admin;
      const html = await withoutXero(() => render());
      expect(html).toContain("Xero isn&#x27;t set up yet");
      expect(html).toContain("XERO_CLIENT_ID");
      expect(html).toContain("XERO_CLIENT_SECRET");
      expect(html).toContain("developer.xero.com");
      expect(html).toMatch(/\/api\/xero\/callback/);
      expect(html).not.toContain(">Connect Xero</a>");
      expect(html).not.toContain('href="/api/xero/connect"');
      expect(html).not.toMatch(/[—–]|sorry|apolog/i);
    });

    it("with the settings, offers Connect; once connected, shows the organisation, Test and Disconnect", async () => {
      nav.user = admin;
      const before = { ...process.env };
      Object.assign(process.env, RAW_ENV);
      try {
        let html = await render();
        expect(html).toContain('href="/api/xero/connect"');
        expect(html).toContain("Connect Xero");
        await connect([
          { tenantId: TENANT_A, tenantName: "Northern Lights Ltd" },
          { tenantId: TENANT_B, tenantName: "Side Org" },
        ]);
        html = await render({ xero: "choose" });
        expect(html).toContain("Northern Lights Ltd");
        expect(html).toContain("Side Org");
        expect(html).toContain("Test the connection");
        expect(html).toContain("Disconnect Xero");
        expect(html).toContain("OUTPUT2");
        expect(html).not.toContain("refresh-1");
        await prisma.xeroConnection.update({ where: { agencyId }, data: { needsReconnect: true } });
        expect(await render()).toContain("Connect again");
      } finally {
        for (const k of Object.keys(RAW_ENV)) if (!(k in before)) delete process.env[k];
      }
    });

    it("saves the account, tax rate and days to pay, and checks them", async () => {
      nav.user = admin;
      const { saveXeroSettings } = await import("@/actions/xero");
      const form = (f: Record<string, string>) => {
        const d = new FormData();
        for (const [k, v] of Object.entries(f)) d.append(k, v);
        return d;
      };
      expect(await saveXeroSettings(undefined, form({ salesAccountCode: "201", taxType: "rroutput", dueDays: "14" }))).toEqual({ ok: "Saved" });
      expect(await load()).toMatchObject({ salesAccountCode: "201", taxType: "RROUTPUT", dueDays: 14, refreshTokenEnc: "" });
      expect(await saveXeroSettings(undefined, form({ salesAccountCode: "201", taxType: "OUTPUT2", dueDays: "" }))).toEqual({ ok: "Saved" });
      expect((await load()).dueDays).toBeNull();
      expect((await saveXeroSettings(undefined, form({ salesAccountCode: "2 0 0", taxType: "OUTPUT2" })))?.error).toMatch(/account/);
      expect((await saveXeroSettings(undefined, form({ salesAccountCode: "200", taxType: "OUTPUT2", dueDays: "-3" })))?.error).toMatch(/Days to pay/);
    });
  });

  it("never stores a token unsealed", async () => {
    await connect();
    const conn = await load();
    expect(conn.refreshTokenEnc.startsWith("v1.")).toBe(true);
    expect(() => openToken(conn.refreshTokenEnc, randomBytes(32))).toThrow();
    expect(sealToken("x", KEY)).not.toBe(sealToken("x", KEY));
  });
});
