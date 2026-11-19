import "server-only";
import type { Prisma, XeroConnection } from "@prisma/client";
import { prisma } from "./db";
import { fromMinor, toMinor } from "./money";
import { randomToken } from "./oauth";
import { env as serverEnv, type ServerEnv } from "@/server/env";
import { openToken, sealToken } from "@/server/token-box";
import { log } from "@/server/log";

// Xero, for the monthly invoices the agency raises to venues and companies. An admin connects the business's
// Xero organisation in Settings, Xero; Gigsaw then creates each month's invoice there as a draft (the agency
// checks and approves it in Xero, and Xero sends it) and later reads back whether it's been paid.
//
// No SDK: plain fetch against Xero's documented endpoints, so tests can stand in for Xero by stubbing fetch
// and pointing XERO_LOGIN_BASE, XERO_IDENTITY_BASE and XERO_API_BASE at a fake (src/server/env.ts).
//
// Xero's documentation, as followed here:
//   OAuth 2.0 code flow, token refresh, revoking:   https://developer.xero.com/documentation/guides/oauth2/auth-flow
//   Token lifetimes (access 30 minutes, refresh 60 days, a new refresh token on every refresh):
//                                                   https://developer.xero.com/documentation/guides/oauth2/token-types
//   Scopes, and granular scopes for new apps:       https://developer.xero.com/documentation/guides/oauth2/scopes
//                                                   https://developer.xero.com/faq/granular-scopes
//   Connections (which organisations, tenantId):    https://developer.xero.com/documentation/guides/oauth2/tenants
//   Rate limits (60 calls a minute, 5,000 a day and 5 at once per organisation; 429 with Retry-After):
//                                                   https://developer.xero.com/documentation/guides/oauth2/limits
//   Errors (400 ValidationException etc.):          https://developer.xero.com/documentation/api/accounting/responsecodes
//   Invoices:                                       https://developer.xero.com/documentation/api/accounting/invoices
//   Contacts:                                       https://developer.xero.com/documentation/api/accounting/contacts
//   Organisation (name, ShortCode):                 https://developer.xero.com/documentation/api/accounting/organisation
//   Tax types (UK OUTPUT2 is 20% VAT on Income):    https://developer.xero.com/documentation/api/accounting/types#tax-types
//   Dates in JSON ("/Date(…)/"):                    https://developer.xero.com/documentation/api/accounting/requests-and-responses
//   Idempotency-Key header:                         https://developer.xero.com/documentation/guides/idempotent-requests/idempotency
//   Deep links into Xero:                           https://developer.xero.com/documentation/guides/how-to-guides/deep-link-xero

type Env = Pick<ServerEnv, "xero" | "xeroTokenKey" | "xeroBases">;
export type XeroOpts = { env?: Env; now?: number; sleep?: (ms: number) => Promise<void> };

/**
 * What Gigsaw asks Xero for. Apps made at developer.xero.com since 2 March 2026 can only ask for the granular
 * scopes, so invoices come from accounting.invoices rather than the old accounting.transactions. Older apps
 * may use these too. offline_access is what brings a refresh token.
 *   accounting.invoices       create the draft invoices and read whether they're paid
 *   accounting.contacts       find the venue or company, or add it
 *   accounting.settings.read  the organisation's name and short code (for links into Xero), for "Test the connection"
 */
export const XERO_SCOPES = "offline_access accounting.invoices accounting.contacts accounting.settings.read";

/** UK tax types for sales (https://developer.xero.com/documentation/api/accounting/types#tax-types). */
export const UK_SALES_TAX_TYPES: { value: string; label: string }[] = [
  { value: "OUTPUT2", label: "20% (VAT on Income)" },
  { value: "RROUTPUT", label: "5% (VAT on Income)" },
  { value: "ZERORATEDOUTPUT", label: "Zero Rated Income" },
  { value: "EXEMPTOUTPUT", label: "Exempt Income" },
  { value: "NONE", label: "No VAT" },
];

/** Where Xero sends the admin back. Paste this into the app at developer.xero.com. */
export function xeroRedirectUri(appUrl: string) {
  return `${appUrl.replace(/\/$/, "")}/api/xero/callback`;
}

/** Whether Xero can be used here: "ready", "no_app" (XERO_CLIENT_ID or SECRET missing) or "no_key" (nothing to seal tokens with). */
export function xeroSetup(env: Env = serverEnv()): "ready" | "no_app" | "no_key" {
  if (!env.xero) return "no_app";
  if (!env.xeroTokenKey) return "no_key";
  return "ready";
}

function key(env: Env) {
  if (!env.xeroTokenKey) throw new XeroError("Xero isn't set up on this site.");
  return env.xeroTokenKey;
}

const basic = (env: Env) => `Basic ${Buffer.from(`${env.xero!.clientId}:${env.xero!.clientSecret}`).toString("base64")}`;

// ---------------------------------------------------------------------------------------------
// Errors. Every message is plain and safe to show to an admin: never a token or secret.

export class XeroError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "XeroError";
  }
}
/** Xero refused the connection's tokens or the organisation: an admin has to connect again in Settings, Xero. */
export class XeroReconnectNeeded extends XeroError {
  constructor(message = "Xero needs connecting again. An admin can do it in Settings, Xero.", status = 401) {
    super(message, status);
    this.name = "XeroReconnectNeeded";
  }
}
/** Too many calls to Xero for now (60 a minute, 5,000 a day per organisation). */
export class XeroRateLimited extends XeroError {
  constructor(
    readonly retryAfterSeconds: number,
    readonly problem: string,
  ) {
    super(
      problem === "day"
        ? "Xero's daily limit for this organisation has been reached. Please try again tomorrow."
        : `Xero is busy with other requests from Gigsaw. Please try again in ${retryAfterSeconds < 90 ? "a minute" : `${Math.ceil(retryAfterSeconds / 60)} minutes`}.`,
      429,
    );
    this.name = "XeroRateLimited";
  }
}
/** No organisation is connected. */
export class XeroNotConnected extends XeroError {
  constructor() {
    super("Xero isn't connected. An admin can connect it in Settings, Xero.");
    this.name = "XeroNotConnected";
  }
}

/** Every message in a Xero error body: ValidationErrors anywhere in it (invoice, line or contact), else its Message or Detail. */
export function xeroProblems(body: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== "object" || depth > 6) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    for (const [k, x] of Object.entries(v)) {
      if (k === "ValidationErrors" && Array.isArray(x)) {
        for (const e of x) if (e && typeof e.Message === "string" && e.Message.trim()) out.push(e.Message.trim());
      } else if (typeof x === "object") walk(x, depth + 1);
    }
  };
  walk(body, 0);
  const b = (body ?? {}) as { Message?: unknown; Detail?: unknown; Title?: unknown };
  const fallback = [b.Message, b.Detail, b.Title].find((m): m is string => typeof m === "string" && !!m.trim());
  if (!out.length && fallback) out.push(fallback.trim());
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------------------------
// Connecting: the OAuth 2.0 authorisation code flow (https://developer.xero.com/documentation/guides/oauth2/auth-flow)

/** Kept in a signed cookie between sending the admin to Xero and them coming back. Bound to their login and business. */
export type XeroFlow = { userId: string; agencyId: string; state: string; exp: number };

export const XERO_FLOW_COOKIE = "gigsaw_xero_connect";
export const XERO_FLOW_PATH = "/api/xero";
const FLOW_MINUTES = 10;

export function newXeroFlow(user: { id: string; agencyId: string }, now = Date.now()): XeroFlow {
  return { userId: user.id, agencyId: user.agencyId, state: randomToken(), exp: now + FLOW_MINUTES * 60_000 };
}

/** Where to send the admin: Xero's sign-in, asking for the scopes above, with our state. */
export function xeroAuthorizeUrl(flow: XeroFlow, opts: { redirectUri: string; env?: Env }) {
  const env = opts.env ?? serverEnv();
  if (!env.xero) throw new XeroError("Xero isn't set up on this site.");
  const url = new URL(`${env.xeroBases.login}/identity/connect/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.xero.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("scope", XERO_SCOPES);
  url.searchParams.set("state", flow.state);
  return url.toString();
}

/** The ?xero=<code> the admin is sent back to Settings, Xero with. */
export type XeroConnectResult = "connected" | "choose" | "cancelled" | "expired" | "state" | "failed" | "wrong_user" | "off" | "no_org" | "no_refresh";

type TokenReply = { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; error?: string; error_description?: string };

async function tokenRequest(env: Env, body: Record<string, string>) {
  const res = await fetch(`${env.xeroBases.identity}/connect/token`, {
    method: "POST",
    headers: { Authorization: basic(env), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  return { res, json: (await res.json().catch(() => ({}))) as TokenReply };
}

/** One of the organisations the admin allowed, from GET /connections. */
export type XeroTenant = { tenantId: string; tenantName: string };
type ConnectionRow = { id?: string; authEventId?: string; tenantId?: string; tenantType?: string; tenantName?: string };

/** The authentication_event_id in an access token, which says which connections this sign-in made. Only read, never trusted for access. */
function authEventId(accessToken: string) {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { authentication_event_id?: unknown };
    return typeof claims.authentication_event_id === "string" ? claims.authentication_event_id : "";
  } catch {
    return "";
  }
}

/**
 * Finishes connecting: checks Xero's answer against the flow this browser started (same state, same login, same
 * business), swaps the code for tokens, asks /connections which organisations were allowed and saves the
 * connection. With several organisations it keeps the one used before if it's still there, otherwise the first one
 * allowed just now, and returns "choose" so the page offers the others. Never throws for a Xero problem: it returns
 * what to tell the admin.
 */
export async function finishXeroConnect(
  user: { id: string; agencyId: string },
  flow: XeroFlow | null,
  params: { code?: string | null; state?: string | null; error?: string | null },
  opts: { redirectUri: string; env?: Env; now?: number },
): Promise<{ result: XeroConnectResult }> {
  const env = opts.env ?? serverEnv();
  const now = opts.now ?? Date.now();
  if (xeroSetup(env) !== "ready") return { result: "off" };
  if (params.error) return { result: params.error === "access_denied" ? "cancelled" : "failed" };
  if (!flow || flow.exp < now) return { result: "expired" };
  if (!params.state || params.state !== flow.state) return { result: "state" };
  // Started by someone else, or in another business: a link can't connect a Xero organisation to this one.
  if (flow.userId !== user.id || flow.agencyId !== user.agencyId) return { result: "wrong_user" };
  if (!params.code) return { result: "failed" };

  let tokens: TokenReply;
  let rows: ConnectionRow[];
  try {
    const { res, json } = await tokenRequest(env, { grant_type: "authorization_code", code: params.code, redirect_uri: opts.redirectUri });
    if (!res.ok || !json.access_token) throw new XeroError(`Token exchange failed: ${json.error ?? res.status}`);
    tokens = json;
    // https://developer.xero.com/documentation/guides/oauth2/tenants: GET /connections lists what the token can reach.
    const conns = await fetch(`${env.xeroBases.api}/connections`, {
      headers: { Authorization: `Bearer ${json.access_token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!conns.ok) throw new XeroError(`Connections failed: ${conns.status}`);
    const list = (await conns.json().catch(() => [])) as unknown;
    rows = Array.isArray(list) ? (list as ConnectionRow[]) : [];
  } catch (e) {
    log.warn("Xero connect failed", { agencyId: user.agencyId, userId: user.id, reason: e instanceof Error ? e.message : "unknown" });
    return { result: "failed" };
  }
  if (!tokens.refresh_token) return { result: "no_refresh" };
  // Only organisations: practices (PRACTICEMANAGER, PRACTICE) have no invoices.
  const orgs = rows.filter((r) => r.tenantId && (r.tenantType ?? "ORGANISATION") === "ORGANISATION");
  if (!orgs.length) return { result: "no_org" };

  const tenants: XeroTenant[] = orgs.map((r) => ({ tenantId: r.tenantId!, tenantName: r.tenantName || "Xero organisation" }));
  const event = authEventId(tokens.access_token!);
  const justAllowed = event ? orgs.filter((r) => r.authEventId === event).map((r) => r.tenantId!) : [];
  const existing = await prisma.xeroConnection.findUnique({ where: { agencyId: user.agencyId } });
  const pool = justAllowed.length ? tenants.filter((t) => justAllowed.includes(t.tenantId)) : tenants;
  const picked = pool.find((t) => t.tenantId === existing?.tenantId) ?? pool[0];

  const data = {
    tenantId: picked.tenantId,
    tenantName: picked.tenantName,
    tenants: tenants as unknown as Prisma.InputJsonValue,
    ...(existing?.tenantId === picked.tenantId ? {} : { shortCode: "" }),
    refreshTokenEnc: sealToken(tokens.refresh_token, key(env)),
    accessTokenEnc: sealToken(tokens.access_token!, key(env)),
    accessTokenExpiresAt: new Date(now + (tokens.expires_in ?? 1800) * 1000),
    connectedById: user.id,
    connectedAt: new Date(now),
    needsReconnect: false,
    lastError: "",
  };
  await prisma.xeroConnection.upsert({ where: { agencyId: user.agencyId }, create: { agencyId: user.agencyId, ...data }, update: data });
  return { result: tenants.length > 1 ? "choose" : "connected" };
}

/** The organisations the admin allowed when connecting, as saved. */
export function savedTenants(conn: Pick<XeroConnection, "tenants">): XeroTenant[] {
  const list = Array.isArray(conn.tenants) ? (conn.tenants as unknown[]) : [];
  return list.filter((t): t is XeroTenant => !!t && typeof (t as XeroTenant).tenantId === "string" && typeof (t as XeroTenant).tenantName === "string");
}

/** Switches invoices to another organisation the admin allowed when connecting. */
export async function chooseXeroTenant(agencyId: string, tenantId: string) {
  const conn = await prisma.xeroConnection.findUnique({ where: { agencyId } });
  if (!conn?.refreshTokenEnc) throw new XeroNotConnected();
  const t = savedTenants(conn).find((x) => x.tenantId === tenantId);
  if (!t) throw new XeroError("Choose one of the organisations you allowed when connecting. To add another, connect Xero again.");
  if (t.tenantId !== conn.tenantId)
    await prisma.xeroConnection.update({ where: { id: conn.id }, data: { tenantId: t.tenantId, tenantName: t.tenantName, shortCode: "" } });
  return t;
}

/**
 * Disconnects: asks Xero to revoke the refresh token, which removes this app's access to every organisation it
 * was allowed (best effort), then forgets the tokens and the organisation. The invoice settings are kept.
 */
export async function disconnectXero(agencyId: string, opts: { env?: Env } = {}) {
  const env = opts.env ?? serverEnv();
  const conn = await prisma.xeroConnection.findUnique({ where: { agencyId } });
  if (!conn?.refreshTokenEnc) return false;
  if (env.xero && env.xeroTokenKey) {
    try {
      const res = await fetch(`${env.xeroBases.identity}/connect/revocation`, {
        method: "POST",
        headers: { Authorization: basic(env), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: openToken(conn.refreshTokenEnc, env.xeroTokenKey) }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) log.warn("Couldn't revoke the Xero token", { agencyId, status: res.status });
    } catch (e) {
      log.warn("Couldn't revoke the Xero token", { agencyId, reason: e instanceof Error ? e.message : "unknown" });
    }
  }
  await prisma.xeroConnection.update({
    where: { id: conn.id },
    data: {
      tenantId: "",
      tenantName: "",
      shortCode: "",
      tenants: [],
      refreshTokenEnc: "",
      accessTokenEnc: "",
      accessTokenExpiresAt: null,
      needsReconnect: false,
      lastError: "",
    },
  });
  return true;
}

/** The agency's connection, if an organisation is connected (it may still need reconnecting). */
export async function xeroConnectionFor(agencyId: string) {
  const conn = await prisma.xeroConnection.findUnique({ where: { agencyId } });
  return conn?.refreshTokenEnc && conn.tenantId ? conn : null;
}

// ---------------------------------------------------------------------------------------------
// Access tokens and calls

async function markReconnect(conn: XeroConnection, why: string) {
  conn.needsReconnect = true;
  conn.lastError = why.slice(0, 500);
  await prisma.xeroConnection.updateMany({ where: { id: conn.id }, data: { needsReconnect: true, lastError: conn.lastError } });
}

/**
 * An access token: the stored one while it has a minute left, otherwise a new one from the refresh token. Xero
 * sends a new refresh token with every refresh and the old one stops working 30 minutes later, so the new one is
 * saved straight away. A refused refresh (invalid_grant: access removed, or unused for 60 days) marks the
 * connection as needing reconnecting. `conn` is updated in place, so later calls in the same request use the new token.
 */
export async function xeroAccessToken(conn: XeroConnection, opts: XeroOpts & { force?: boolean } = {}): Promise<string> {
  const env = opts.env ?? serverEnv();
  const now = opts.now ?? Date.now();
  if (!conn.refreshTokenEnc || !conn.tenantId) throw new XeroNotConnected();
  if (conn.needsReconnect) throw new XeroReconnectNeeded();
  if (!opts.force && conn.accessTokenEnc && conn.accessTokenExpiresAt && conn.accessTokenExpiresAt.getTime() > now + 60_000)
    return openToken(conn.accessTokenEnc, key(env));
  if (!env.xero) throw new XeroError("Xero isn't set up on this site.");
  let reply: Awaited<ReturnType<typeof tokenRequest>>;
  try {
    reply = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: openToken(conn.refreshTokenEnc, key(env)) });
  } catch (e) {
    log.warn("Xero token refresh failed", { agencyId: conn.agencyId, reason: e instanceof Error ? e.message : "unknown" });
    throw new XeroError("Xero couldn't be reached. Please try again in a minute.");
  }
  const { res, json } = reply;
  if (!res.ok || !json.access_token) {
    if (json.error === "invalid_grant" || json.error === "unauthorized_client" || res.status === 401) {
      await markReconnect(conn, `Xero refused the connection (${json.error ?? res.status}). Connect Xero again.`);
      throw new XeroReconnectNeeded();
    }
    log.warn("Xero token refresh failed", { agencyId: conn.agencyId, status: res.status, error: json.error });
    throw new XeroError("Xero couldn't be reached. Please try again in a minute.", res.status);
  }
  const data = {
    accessTokenEnc: sealToken(json.access_token, key(env)),
    accessTokenExpiresAt: new Date(now + (json.expires_in ?? 1800) * 1000),
    ...(json.refresh_token ? { refreshTokenEnc: sealToken(json.refresh_token, key(env)) } : {}),
  };
  await prisma.xeroConnection.update({ where: { id: conn.id }, data });
  Object.assign(conn, data);
  return json.access_token;
}

/** Longest Gigsaw waits for Xero's minute limit before giving up with XeroRateLimited. */
const MAX_WAIT_SECONDS = 60;
const RATE_RETRIES = 2;
const sleepFor = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One call to the Accounting API (https://api.xero.com/api.xro/2.0/<path>) for the connected organisation.
 *  - 401: the access token is refreshed once and the call tried again; refused again, the connection needs reconnecting.
 *  - 403: the organisation was disconnected from the app or a permission is missing: needs reconnecting.
 *  - 429: waits for Retry-After and tries again (up to twice, up to a minute each); the daily limit isn't waited for.
 *  - 400: XeroError with Xero's validation messages.
 */
export async function xeroApi<T>(
  conn: XeroConnection,
  method: "GET" | "PUT" | "POST",
  path: string,
  opts: XeroOpts & { body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const env = opts.env ?? serverEnv();
  const sleep = opts.sleep ?? sleepFor;
  let refreshed = false;
  let waits = 0;
  for (;;) {
    const token = await xeroAccessToken(conn, opts);
    let res: Response;
    try {
      res = await fetch(`${env.xeroBases.api}/api.xro/2.0/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "xero-tenant-id": conn.tenantId,
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey.slice(0, 128) } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      log.warn("Xero call failed", { agencyId: conn.agencyId, path: path.split("?")[0], reason: e instanceof Error ? e.message : "unknown" });
      throw new XeroError("Xero couldn't be reached. Please try again in a minute.");
    }
    const json = (await res.json().catch(() => ({}))) as unknown;
    if (res.ok) return json as T;
    if (res.status === 401) {
      if (!refreshed) {
        // The access token may have been cut short by Xero: get a fresh one and try once more.
        refreshed = true;
        await xeroAccessToken(conn, { ...opts, force: true });
        continue;
      }
      await markReconnect(conn, "Xero refused Gigsaw's access. Connect Xero again.");
      throw new XeroReconnectNeeded();
    }
    if (res.status === 403) {
      await markReconnect(
        conn,
        `Xero refused access to ${conn.tenantName || "the organisation"}: ${xeroProblems(json)[0] ?? "Forbidden"}. Connect Xero again.`,
      );
      throw new XeroReconnectNeeded(`Xero refused access to ${conn.tenantName || "the organisation"}. An admin can connect it again in Settings, Xero.`, 403);
    }
    if (res.status === 429) {
      const problem = (res.headers.get("x-rate-limit-problem") ?? "").toLowerCase();
      const retryAfter = Math.max(1, Number(res.headers.get("retry-after")) || MAX_WAIT_SECONDS);
      if (problem === "day" || retryAfter > MAX_WAIT_SECONDS || waits >= RATE_RETRIES) throw new XeroRateLimited(retryAfter, problem);
      waits++;
      log.info("Waiting for Xero's rate limit", { agencyId: conn.agencyId, retryAfter, problem });
      await sleep(retryAfter * 1000);
      continue;
    }
    const problems = xeroProblems(json);
    if (res.status === 400) throw new XeroError(problems.length ? `Xero said: ${problems.join(" ")}` : "Xero didn't accept that.", 400, problems);
    if (res.status === 404) throw new XeroError("Xero couldn't find that.", 404, problems);
    log.warn("Xero call failed", { agencyId: conn.agencyId, path: path.split("?")[0], status: res.status });
    throw new XeroError(`Xero had a problem (${res.status}). Please try again in a minute.`, res.status, problems);
  }
}

// ---------------------------------------------------------------------------------------------
// The organisation

export type XeroOrganisation = { name: string; shortCode: string; baseCurrency: string; countryCode: string };

/** The connected organisation (a cheap call, used by "Test the connection"). Keeps its name and short code up to date. */
export async function getXeroOrganisation(conn: XeroConnection, opts: XeroOpts = {}): Promise<XeroOrganisation> {
  type Org = { Name?: string; ShortCode?: string; BaseCurrency?: string; CountryCode?: string };
  const json = await xeroApi<{ Organisations?: Org[] }>(conn, "GET", "Organisation", opts);
  const o = json.Organisations?.[0];
  if (!o) throw new XeroError("Xero didn't send the organisation's details.");
  const org = { name: o.Name ?? conn.tenantName, shortCode: o.ShortCode ?? "", baseCurrency: o.BaseCurrency ?? "", countryCode: o.CountryCode ?? "" };
  const data = { shortCode: org.shortCode, tenantName: org.name || conn.tenantName, lastError: "" };
  await prisma.xeroConnection.update({ where: { id: conn.id }, data });
  Object.assign(conn, data);
  return org;
}

/**
 * A link that opens the invoice in Xero, switching to the right organisation first by its short code
 * (https://developer.xero.com/documentation/guides/how-to-guides/deep-link-xero). Without the short code it opens
 * in whichever organisation the person last used.
 */
export function xeroInvoiceUrl(invoiceId: string, shortCode = "") {
  const page = `/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(invoiceId)}`;
  return shortCode
    ? `https://go.xero.com/organisationlogin/default.aspx?shortcode=${encodeURIComponent(shortCode)}&redirecturl=${page}`
    : `https://go.xero.com${page}`;
}

// ---------------------------------------------------------------------------------------------
// Contacts (https://developer.xero.com/documentation/api/accounting/contacts)

type XeroContact = { ContactID: string; Name?: string; EmailAddress?: string; ContactStatus?: string };

const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

async function findContact(conn: XeroConnection, name: string, opts: XeroOpts) {
  // searchTerm: a case-insensitive search of Name, first and last names, contact number and email.
  const json = await xeroApi<{ Contacts?: XeroContact[] }>(conn, "GET", `Contacts?searchTerm=${encodeURIComponent(name)}`, opts);
  const matches = (json.Contacts ?? []).filter((c) => c.ContactID && c.Name && sameName(c.Name, name));
  return matches.find((c) => c.ContactStatus !== "ARCHIVED") ?? matches[0] ?? null;
}

/**
 * The venue or company in Xero, by name (Xero contact names are unique in an organisation), or a new contact with
 * that name and email. An archived contact isn't brought back: the admin is asked to restore it in Xero.
 */
export async function findOrCreateXeroContact(
  conn: XeroConnection,
  who: { name: string; email?: string | null },
  opts: XeroOpts = {},
): Promise<{ contactId: string; name: string; created: boolean }> {
  const name = who.name.trim().replace(/\s+/g, " ").slice(0, 255);
  if (!name) throw new XeroError("The invoice needs a contact name.");
  const found = await findContact(conn, name, opts);
  if (found) {
    if (found.ContactStatus === "ARCHIVED") throw new XeroError(`${found.Name} is archived in Xero. Restore the contact in Xero, then send the invoice again.`);
    return { contactId: found.ContactID, name: found.Name ?? name, created: false };
  }
  const email = (who.email ?? "").trim();
  const contact = { Name: name, ...(looksLikeEmail(email) ? { EmailAddress: email } : {}) };
  try {
    const json = await xeroApi<{ Contacts?: XeroContact[] }>(conn, "PUT", "Contacts", { ...opts, body: { Contacts: [contact] } });
    const made = json.Contacts?.[0];
    if (!made?.ContactID) throw new XeroError("Xero didn't make the contact.");
    return { contactId: made.ContactID, name: made.Name ?? name, created: true };
  } catch (e) {
    // Added in Xero at the same moment (names are unique): use that one.
    if (e instanceof XeroError && e.status === 400) {
      const again = await findContact(conn, name, opts);
      if (again && again.ContactStatus !== "ARCHIVED") return { contactId: again.ContactID, name: again.Name ?? name, created: false };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Invoices (https://developer.xero.com/documentation/api/accounting/invoices)

/**
 * One line of the invoice. Amounts are in minor units (pence), ex VAT: Gigsaw's sale prices are before VAT
 * (dealBreakdown in src/lib/money.ts adds VAT on top), so invoices go to Xero with LineAmountTypes "Exclusive" and
 * Xero adds the VAT for each line's tax type. Leave out unitAmountMinor for a line of text only (a heading).
 */
export type XeroInvoiceLine = { description: string; quantity?: number; unitAmountMinor?: number; taxType?: string; accountCode?: string };

export type DraftInvoiceInput = {
  contactName: string;
  contactEmail?: string | null;
  /** The customer's purchase order number, shown on the invoice as its Reference. */
  reference: string;
  /** The invoice date, "YYYY-MM-DD" (or a Date, taken as that day in London). */
  date: string | Date;
  /** When it's due. Left out: the connection's due days, or else Xero's own terms for the contact. */
  dueDate?: string | Date | null;
  lines: XeroInvoiceLine[];
  currency: string;
  /** Sent as Idempotency-Key, so the same invoice isn't made twice if a request is repeated. */
  idempotencyKey?: string;
};

export type DraftInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  url: string;
  subTotalMinor: number;
  taxMinor: number;
  totalMinor: number;
};

/** "YYYY-MM-DD" for a date: as given when it's already one, otherwise the day in London. */
export function isoDay(d: string | Date, timeZone = "Europe/London") {
  if (typeof d === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new XeroError(`"${d}" isn't a date.`);
    return d;
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function addDays(day: string, n: number) {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** The body Gigsaw sends to PUT /Invoices for a draft sales invoice. Pure, for tests. */
export function draftInvoicePayload(settings: Pick<XeroConnection, "salesAccountCode" | "taxType" | "dueDays">, contactId: string, input: DraftInvoiceInput) {
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new XeroError(`"${input.currency}" isn't a currency code.`);
  if (!input.lines.some((l) => l.unitAmountMinor !== undefined)) throw new XeroError("The invoice has nothing on it to charge for.");
  const date = isoDay(input.date);
  const due = input.dueDate ? isoDay(input.dueDate) : settings.dueDays !== null && settings.dueDays !== undefined ? addDays(date, settings.dueDays) : null;
  const LineItems = input.lines.map((l) => {
    const Description = l.description.trim().slice(0, 4000);
    if (!Description) throw new XeroError("Every invoice line needs a description.");
    if (l.unitAmountMinor === undefined) return { Description };
    if (!Number.isInteger(l.unitAmountMinor)) throw new XeroError(`The amount on "${Description}" must be a whole number of pence.`);
    const Quantity = l.quantity ?? 1;
    if (!(Quantity > 0)) throw new XeroError(`The quantity on "${Description}" must be more than 0.`);
    return {
      Description,
      Quantity,
      // Pence to pounds: 12345 → 123.45. fromMinor knows currencies without pence.
      UnitAmount: fromMinor(l.unitAmountMinor, currency),
      AccountCode: (l.accountCode || settings.salesAccountCode).trim(),
      TaxType: (l.taxType || settings.taxType).trim(),
    };
  });
  return {
    Invoices: [
      {
        Type: "ACCREC",
        Contact: { ContactID: contactId },
        Date: date,
        ...(due ? { DueDate: due } : {}),
        Reference: input.reference.trim().slice(0, 255),
        Status: "DRAFT",
        LineAmountTypes: "Exclusive",
        CurrencyCode: currency,
        LineItems,
      },
    ],
  };
}

type XeroInvoiceJson = {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Status?: string;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  AmountDue?: number;
  AmountPaid?: number;
  CurrencyCode?: string;
  FullyPaidOnDate?: string;
};

/** Finds the contact (or adds it), then creates the invoice in Xero as a DRAFT for the agency to check and approve there. */
export async function createDraftInvoice(conn: XeroConnection, input: DraftInvoiceInput, opts: XeroOpts = {}): Promise<DraftInvoice> {
  // Checked before any call to Xero, so a mistake doesn't add a contact for nothing.
  draftInvoicePayload(conn, "check", input);
  const contact = await findOrCreateXeroContact(conn, { name: input.contactName, email: input.contactEmail }, opts);
  const body = draftInvoicePayload(conn, contact.contactId, input);
  const json = await xeroApi<{ Invoices?: XeroInvoiceJson[] }>(conn, "PUT", "Invoices", { ...opts, body, idempotencyKey: input.idempotencyKey });
  const inv = json.Invoices?.[0];
  if (!inv?.InvoiceID) throw new XeroError("Xero didn't make the invoice.");
  if (!conn.shortCode) {
    // For the link into Xero. Not worth failing the invoice over.
    await getXeroOrganisation(conn, opts).catch((e) =>
      log.warn("Couldn't read the Xero organisation's short code", { agencyId: conn.agencyId, reason: e?.message }),
    );
  }
  const currency = inv.CurrencyCode || body.Invoices[0].CurrencyCode;
  return {
    invoiceId: inv.InvoiceID,
    invoiceNumber: inv.InvoiceNumber ?? "",
    status: inv.Status ?? "DRAFT",
    url: xeroInvoiceUrl(inv.InvoiceID, conn.shortCode),
    subTotalMinor: toMinor(inv.SubTotal ?? 0, currency),
    taxMinor: toMinor(inv.TotalTax ?? 0, currency),
    totalMinor: toMinor(inv.Total ?? 0, currency),
  };
}

/** Where an invoice is up to, in Gigsaw's words. */
export type XeroInvoiceState = "draft" | "awaiting_approval" | "awaiting_payment" | "part_paid" | "paid" | "voided" | "deleted" | "unknown";

export const XERO_STATE_LABELS: Record<XeroInvoiceState, string> = {
  draft: "Draft in Xero",
  awaiting_approval: "Awaiting approval in Xero",
  awaiting_payment: "Awaiting payment",
  part_paid: "Part paid",
  paid: "Paid",
  voided: "Voided in Xero",
  deleted: "Deleted in Xero",
  unknown: "Unknown",
};

/** Xero's Status (DRAFT, SUBMITTED, AUTHORISED, PAID, VOIDED, DELETED) as a state; an AUTHORISED one with money in is part paid. */
export function invoiceState(status: string, amountPaidMinor = 0): XeroInvoiceState {
  switch (status) {
    case "DRAFT":
      return "draft";
    case "SUBMITTED":
      return "awaiting_approval";
    case "AUTHORISED":
      return amountPaidMinor > 0 ? "part_paid" : "awaiting_payment";
    case "PAID":
      return "paid";
    case "VOIDED":
      return "voided";
    case "DELETED":
      return "deleted";
    default:
      return "unknown";
  }
}

/**
 * A date from Xero's JSON as "YYYY-MM-DD": "/Date(1730332800000+0000)/" (milliseconds, midnight UTC on that day)
 * or "2026-10-31T00:00:00". Null when there isn't one.
 */
export function parseXeroDate(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const ms = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(v);
  if (ms) return new Date(Number(ms[1])).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

export type XeroInvoiceStatus = {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  state: XeroInvoiceState;
  amountDueMinor: number;
  amountPaidMinor: number;
  totalMinor: number;
  /** "YYYY-MM-DD" once fully paid. */
  fullyPaidOn: string | null;
};

function statusOf(inv: XeroInvoiceJson): XeroInvoiceStatus {
  const currency = inv.CurrencyCode || "GBP";
  const amountPaidMinor = toMinor(inv.AmountPaid ?? 0, currency);
  const status = inv.Status ?? "";
  return {
    invoiceId: inv.InvoiceID ?? "",
    invoiceNumber: inv.InvoiceNumber ?? "",
    status,
    state: invoiceState(status, amountPaidMinor),
    amountDueMinor: toMinor(inv.AmountDue ?? 0, currency),
    amountPaidMinor,
    totalMinor: toMinor(inv.Total ?? 0, currency),
    fullyPaidOn: parseXeroDate(inv.FullyPaidOnDate),
  };
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isXeroId = (id: string) => GUID.test(id);

/** One invoice's status, amount due and paid, and the day it was fully paid. */
export async function getInvoiceStatus(conn: XeroConnection, invoiceId: string, opts: XeroOpts = {}): Promise<XeroInvoiceStatus> {
  if (!isXeroId(invoiceId)) throw new XeroError("That isn't a Xero invoice id.");
  const json = await xeroApi<{ Invoices?: XeroInvoiceJson[] }>(conn, "GET", `Invoices/${invoiceId}`, opts);
  const inv = json.Invoices?.[0];
  if (!inv) throw new XeroError("Xero couldn't find that invoice.", 404);
  return statusOf(inv);
}

/** Up to this many invoices are read in one call, with the IDs filter, to keep within 60 calls a minute. */
const IDS_PER_CALL = 40;

/** Many invoices' statuses, a few calls in all. Ids Xero doesn't know are left out of the map. */
export async function getInvoiceStatuses(conn: XeroConnection, invoiceIds: string[], opts: XeroOpts = {}): Promise<Map<string, XeroInvoiceStatus>> {
  const ids = [...new Set(invoiceIds.filter(isXeroId).map((id) => id.toLowerCase()))];
  const out = new Map<string, XeroInvoiceStatus>();
  for (let i = 0; i < ids.length; i += IDS_PER_CALL) {
    const chunk = ids.slice(i, i + IDS_PER_CALL);
    const json = await xeroApi<{ Invoices?: XeroInvoiceJson[] }>(conn, "GET", `Invoices?IDs=${chunk.join(",")}`, opts);
    for (const inv of json.Invoices ?? []) if (inv.InvoiceID) out.set(inv.InvoiceID.toLowerCase(), statusOf(inv));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Words

/** The message on Settings, Xero after connecting, disconnecting or a problem (?xero=<code>). */
export function xeroConnectMessage(code: string | undefined, orgName = ""): { tone: "ok" | "error"; text: string } | null {
  const org = orgName || "your Xero organisation";
  switch (code) {
    case "connected":
      return { tone: "ok", text: `Xero is connected to ${org}. Monthly invoices can now be sent there as drafts.` };
    case "choose":
      return { tone: "ok", text: `Xero is connected to ${org}. You allowed more than one organisation, so check below that this is the right one.` };
    case "disconnected":
      return { tone: "ok", text: "Xero is disconnected. Invoices already in Xero stay there." };
    case "cancelled":
      return { tone: "error", text: "Xero wasn't connected because access wasn't given. You can try again any time." };
    case "expired":
    case "state":
      return { tone: "error", text: "That took too long or was started in another tab. Please try again." };
    case "wrong_user":
      return { tone: "error", text: "That was started from a different Gigsaw login. Please try again from here." };
    case "no_refresh":
      return { tone: "error", text: "Xero only gave Gigsaw short-term access, so it couldn't be connected. Please try again." };
    case "no_org":
      return { tone: "error", text: "No Xero organisation was chosen. Please try again and pick your organisation on Xero's screen." };
    case "off":
      return { tone: "error", text: "Xero isn't set up on this site yet. See below for what's needed." };
    case "failed":
      return { tone: "error", text: "Xero couldn't be connected. Please try again." };
    default:
      return null;
  }
}

// Words for invoice lines

// Fixed short names: Intl gives "Sept" or "Sep" depending on the server's ICU version.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "20:00" → "8pm", "20:30" → "8.30pm", "00:00" → "12am". */
export function twelveHour(time: string) {
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return time.trim();
  const h = Number(m[1]) % 24;
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m[2] === "00" ? "" : `.${m[2]}`}${suffix}`;
}

/** One gig as an invoice line: "12 Oct, The Crown: Act name, 8pm to 11pm". `date` is "YYYY-MM-DD". */
export function gigLineDescription(gig: { date: string; venue: string; act: string; start?: string | null; end?: string | null }) {
  const [, month, dayOfMonth] = isoDay(gig.date).split("-").map(Number);
  const day = `${dayOfMonth} ${MONTHS[month - 1]}`;
  const times = gig.start && gig.end ? `, ${twelveHour(gig.start)} to ${twelveHour(gig.end)}` : gig.start ? `, ${twelveHour(gig.start)}` : "";
  return `${day}, ${gig.venue.trim()}: ${gig.act.trim()}${times}`;
}
