import "server-only";
import type { CalendarConnection } from "@prisma/client";
import { prisma } from "./db";
import { removeConnectionEvents, resyncConnection } from "./calendar-sync";
import {
  authorizeUrl,
  checkCallback,
  endpoints,
  exchangeCodeForTokens,
  OAuthError,
  PROVIDER_KEYS,
  PROVIDERS,
  providerCredentials,
  randomToken,
  verifyIdToken,
  type CallbackProblem,
  type ProviderKey,
  type TokenResponse,
} from "./oauth";
import { env as serverEnv, type ServerEnv } from "@/server/env";
import { openToken, sealToken } from "@/server/token-box";
import { log } from "@/server/log";
import { apiBase } from "@/lib/calendar-sync/providers";

// Connecting an act's own Google or Outlook calendar (docs/calendar-connect.md): the start of the flow, the
// callback, storing the connection, choosing which calendar, and disconnecting. It reuses sign-in's OAuth
// pieces (src/lib/oauth.ts: PKCE, state, nonce, id_token checks), with calendar scopes and offline access so
// a refresh token comes back. Putting gigs in the calendar is the sync engine's job (src/lib/calendar-sync).
//
// Everything that talks to a provider uses the global fetch, so tests can stand in for Google and Microsoft.

type Env = Pick<ServerEnv, "oauth" | "oauthTestBase" | "calendarTokenKey">;

/** What acts call each provider's calendar. */
export const CALENDAR_LABELS: Record<ProviderKey, string> = { google: "Google Calendar", microsoft: "Outlook" };

const GOOGLE_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
// Only to list the act's calendars so they can choose one; adding events needs just the scope above.
const GOOGLE_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";

/** What each provider is asked for. */
export const CALENDAR_SCOPES: Record<ProviderKey, string> = {
  google: `openid email ${GOOGLE_EVENTS_SCOPE} ${GOOGLE_LIST_SCOPE}`,
  microsoft: "openid email offline_access User.Read Calendars.ReadWrite",
};

/** Providers an act can connect: the token key and that provider's sign-in settings are both in place. */
export function calendarProviders(env: Env = serverEnv()): ProviderKey[] {
  if (!env.calendarTokenKey) return [];
  return PROVIDER_KEYS.filter((p) => providerCredentials(p, env));
}

export function calendarRedirectUri(p: ProviderKey, baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/calendar-connect/${p}/callback`;
}

/** Only an act's own login connects a calendar: the sync engine puts that act's gigs in it (user.artistId). */
export function canConnectCalendar(user: { role: string; artistId: string | null; agencyId: string | null }) {
  return user.role === "ARTIST" && !!user.artistId && !!user.agencyId;
}

// ---------------------------------------------------------------------------------------------
// Starting the flow

/** Kept in a signed cookie between sending the act to the provider and them coming back. Bound to their login. */
export type CalendarFlow = { provider: ProviderKey; userId: string; state: string; verifier: string; nonce: string; exp: number };

export const FLOW_COOKIE = "gigsaw_calendar_connect";
export const FLOW_PATH = "/api/calendar-connect";
const FLOW_MINUTES = 10;

export function newCalendarFlow(provider: ProviderKey, userId: string, now = Date.now()): CalendarFlow {
  return { provider, userId, state: randomToken(), verifier: randomToken(48), nonce: randomToken(), exp: now + FLOW_MINUTES * 60_000 };
}

/**
 * Where to send the act. Google needs access_type=offline for a refresh token, and prompt=consent so it sends
 * one every time, even to someone who connected before. Microsoft sends one for offline_access.
 * `loginHint` suggests the account already connected, when reconnecting.
 */
export function calendarAuthorizeUrl(flow: CalendarFlow, opts: { clientId: string; redirectUri: string; loginHint?: string; env?: Env }) {
  const extra: Record<string, string> = flow.provider === "google" ? { access_type: "offline", prompt: "consent" } : {};
  if (opts.loginHint) extra.login_hint = opts.loginHint;
  return authorizeUrl(flow, { clientId: opts.clientId, redirectUri: opts.redirectUri, env: opts.env, scope: CALENDAR_SCOPES[flow.provider], extra });
}

// ---------------------------------------------------------------------------------------------
// The callback

/** The ?calendar=<code> an act is sent back with. */
export type ConnectResult = CallbackProblem | "connected" | "off" | "wrong_user" | "not_act" | "no_refresh" | "scope";

/** True when the provider says it granted calendar access (Google lets people untick it on the consent screen). */
export function grantedCalendarAccess(provider: ProviderKey, scope: string | undefined) {
  // Some responses leave out the scope; the calls to the calendar then show whether access was given.
  if (!scope) return true;
  const granted = scope.split(/\s+/);
  if (provider === "google") return granted.includes(GOOGLE_EVENTS_SCOPE) || granted.includes("https://www.googleapis.com/auth/calendar");
  // Microsoft may return "Calendars.ReadWrite" or "https://graph.microsoft.com/Calendars.ReadWrite".
  return granted.some((s) => /(^|\/)calendars\.readwrite$/i.test(s));
}

type ConnectUser = { id: string; role: string; artistId: string | null; agencyId: string | null };

/**
 * Finishes connecting: checks the provider's answer against the flow this browser started (same provider,
 * same state, same login), swaps the code for tokens with the PKCE verifier, checks the id_token, then saves
 * the connection and asks the sync engine to fill the calendar. Never throws for a provider problem: it
 * returns what to tell the act.
 */
export async function finishConnect(
  user: ConnectUser,
  provider: ProviderKey | null,
  flow: CalendarFlow | null,
  params: { code?: string | null; state?: string | null; error?: string | null },
  opts: { redirectUri: string; env?: Env; now?: number },
): Promise<{ result: ConnectResult; connectionId?: string }> {
  const env = opts.env ?? serverEnv();
  if (!provider || !calendarProviders(env).includes(provider)) return { result: "off" };
  if (!canConnectCalendar(user)) return { result: "not_act" };
  const checked = checkCallback(flow, provider, params);
  if (!checked.ok) return { result: checked.problem };
  // State is bound to the login that started it: a link started by someone else can't connect their calendar here.
  if (checked.flow.userId !== user.id) return { result: "wrong_user" };
  const creds = providerCredentials(provider, env)!;

  let tokens: TokenResponse;
  let email: string;
  try {
    tokens = await exchangeCodeForTokens(provider, { code: checked.code, verifier: checked.flow.verifier, ...creds, redirectUri: opts.redirectUri, env });
    if (!tokens.id_token) throw new OAuthError("No id_token");
    const identity = await verifyIdToken(provider, tokens.id_token, { clientId: creds.clientId, nonce: checked.flow.nonce, now: opts.now, env });
    email = identity.email || preferredUsername(tokens.id_token);
  } catch (e) {
    log.warn("Calendar connect failed", { provider, userId: user.id, ...(e instanceof OAuthError ? { reason: e.message } : { err: e }) });
    return { result: "failed" };
  }
  if (!grantedCalendarAccess(provider, tokens.scope)) return { result: "scope" };
  // Without a refresh token Gigsaw could only reach the calendar for an hour.
  if (!tokens.refresh_token) return { result: "no_refresh" };

  const connectionId = await saveConnection(
    { id: user.id, agencyId: user.agencyId! },
    provider,
    { refreshToken: tokens.refresh_token, accessToken: tokens.access_token, expiresIn: tokens.expires_in, email },
    { env, now: opts.now },
  );
  return { result: "connected", connectionId };
}

/**
 * The account's sign-in name from an id_token that verifyIdToken has already checked. Some Microsoft work
 * accounts have no "email" claim; this is only shown to the act, never used to match logins.
 */
function preferredUsername(idToken: string) {
  try {
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { preferred_username?: unknown };
    return typeof claims.preferred_username === "string" && claims.preferred_username.includes("@") ? claims.preferred_username.trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

/**
 * Creates or updates the act's connection for this provider with fresh tokens, then asks the sync engine to put
 * their gigs in. Reconnecting the same account keeps the chosen calendar and the events already there; a
 * different account starts again in its main calendar.
 */
export async function saveConnection(
  user: { id: string; agencyId: string },
  provider: ProviderKey,
  t: { refreshToken: string; accessToken?: string; expiresIn?: number; email: string },
  opts: { env?: Env; now?: number } = {},
) {
  const env = opts.env ?? serverEnv();
  const now = opts.now ?? Date.now();
  const key = env.calendarTokenKey;
  const db = PROVIDERS[provider].db;
  const tokens = {
    refreshTokenEnc: sealToken(t.refreshToken, key),
    accessTokenEnc: t.accessToken ? sealToken(t.accessToken, key) : "",
    accessTokenExpiresAt: t.accessToken && t.expiresIn ? new Date(now + t.expiresIn * 1000) : null,
    accountEmail: t.email,
    status: "ACTIVE",
    lastError: "",
  };
  const existing = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId: user.id, provider: db } } });
  if (existing && existing.accountEmail.toLowerCase() !== t.email.toLowerCase()) {
    // Another account: take the gigs out of the old one first (best effort; its access may be gone).
    await clearCalendar(existing.id);
  }
  const sameAccount = !!existing && existing.accountEmail.toLowerCase() === t.email.toLowerCase();
  const saved = await prisma.calendarConnection.upsert({
    where: { userId_provider: { userId: user.id, provider: db } },
    create: { agencyId: user.agencyId, userId: user.id, provider: db, calendarId: "primary", calendarName: "", ...tokens },
    update: { ...tokens, ...(sameAccount ? {} : { calendarId: "primary", calendarName: "" }) },
  });
  await resyncConnection(saved.id);
  return saved.id;
}

/**
 * Takes Gigsaw's events out of a connection's calendar before it points somewhere else. removeConnectionEvents
 * forgets the links when it succeeds; if it couldn't (access gone), the links are dropped here anyway so the next
 * sync doesn't try to change events that live in another calendar.
 */
async function clearCalendar(connectionId: string) {
  await removeConnectionEvents(connectionId);
  await prisma.calendarEventLink.deleteMany({ where: { connectionId } });
}

// ---------------------------------------------------------------------------------------------
// Access tokens, the calendar list and choosing a calendar

/** The connection can't be used until the act connects again (access was removed or ran out). */
export class ReconnectNeeded extends Error {}

/** Google's calendar API and Microsoft Graph, or the stand-in for tests. */
export function calendarApiBase(provider: ProviderKey, env: Pick<ServerEnv, "oauthTestBase"> = serverEnv()) {
  // One place for the API addresses (and their test stand-ins), shared with the sync engine.
  return apiBase(provider === "google" ? "GOOGLE" : "MICROSOFT", env);
}

type Connection = CalendarConnection;

const providerOf = (c: Pick<Connection, "provider">): ProviderKey => (c.provider === "MICROSOFT" ? "microsoft" : "google");

/**
 * An access token for the connection: the stored one while it has a minute left, otherwise a new one from the
 * refresh token. A refused refresh token marks the connection NEEDS_RECONNECT, as the sync engine does.
 */
export async function accessTokenFor(conn: Connection, opts: { env?: Env; now?: number } = {}): Promise<string> {
  const env = opts.env ?? serverEnv();
  const now = opts.now ?? Date.now();
  const key = env.calendarTokenKey;
  if (conn.accessTokenEnc && conn.accessTokenExpiresAt && conn.accessTokenExpiresAt.getTime() > now + 60_000) return openToken(conn.accessTokenEnc, key);
  const provider = providerOf(conn);
  const creds = providerCredentials(provider, env);
  if (!creds) throw new ReconnectNeeded("Provider isn't set up");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: openToken(conn.refreshTokenEnc, key),
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  if (provider === "microsoft") body.set("scope", CALENDAR_SCOPES.microsoft);
  const res = await fetch(endpoints(provider, env).token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    if (json.error === "invalid_grant") {
      await prisma.calendarConnection.update({
        where: { id: conn.id },
        data: { status: "NEEDS_RECONNECT", lastError: `Refresh refused: ${json.error_description ?? json.error}`.slice(0, 500) },
      });
      throw new ReconnectNeeded("Refresh token refused");
    }
    throw new Error(`Token refresh failed: ${json.error ?? res.status}`);
  }
  await prisma.calendarConnection.update({
    where: { id: conn.id },
    data: {
      accessTokenEnc: sealToken(json.access_token, key),
      accessTokenExpiresAt: new Date(now + (json.expires_in ?? 3600) * 1000),
      // Microsoft hands out a new refresh token with each refresh; keep the newest.
      ...(json.refresh_token ? { refreshTokenEnc: sealToken(json.refresh_token, key) } : {}),
    },
  });
  return json.access_token;
}

export type CalendarChoice = { id: string; name: string; main: boolean };

/** The connection can list calendars but wasn't allowed to (Google: the calendar list box was unticked). */
export class ListNotAllowed extends Error {}

/** The calendars the act can add events to, main one first. */
export async function listCalendars(conn: Connection, opts: { env?: Env; now?: number } = {}): Promise<CalendarChoice[]> {
  const env = opts.env ?? serverEnv();
  const provider = providerOf(conn);
  const token = await accessTokenFor(conn, opts);
  const get = async (url: string) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 403) {
      // Also what Google says when the Calendar API isn't turned on for the app: logged for whoever set it up.
      log.warn("Calendar list refused", { provider, connectionId: conn.id, body: (await res.text().catch(() => "")).slice(0, 300) });
      throw new ListNotAllowed(`${provider} refused the calendar list`);
    }
    if (res.status === 401) throw new ReconnectNeeded("Access token refused");
    if (!res.ok) throw new Error(`Calendar list failed: ${res.status}`);
    return res.json();
  };
  const base = calendarApiBase(provider, env);
  const out: CalendarChoice[] = [];
  if (provider === "google") {
    type Item = { id: string; summary?: string; summaryOverride?: string; primary?: boolean; deleted?: boolean };
    let page = "";
    for (let i = 0; i < 5; i++) {
      const json = (await get(`${base}/users/me/calendarList?minAccessRole=writer&maxResults=250${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`)) as {
        items?: Item[];
        nextPageToken?: string;
      };
      for (const c of json.items ?? []) if (!c.deleted) out.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, main: !!c.primary });
      if (!json.nextPageToken) break;
      page = json.nextPageToken;
    }
  } else {
    type Item = { id: string; name?: string; canEdit?: boolean; isDefaultCalendar?: boolean };
    let url: string | undefined = `${base}/me/calendars?$select=id,name,canEdit,isDefaultCalendar&$top=100`;
    for (let i = 0; i < 5 && url; i++) {
      const json = (await get(url)) as { value?: Item[]; "@odata.nextLink"?: string };
      for (const c of json.value ?? []) if (c.canEdit !== false) out.push({ id: c.id, name: c.name || "Calendar", main: !!c.isDefaultCalendar });
      // Only follow next links back to the same API.
      const next = json["@odata.nextLink"];
      url = next && next.startsWith(base) ? next : undefined;
    }
  }
  return out.sort((a, b) => Number(b.main) - Number(a.main) || a.name.localeCompare(b.name));
}

/** The id saved for the main calendar: "primary" for both providers, so the main one is always used, even if renamed. */
export const MAIN_CALENDAR = "primary";

/** Which calendar in a list the connection uses now. */
export function currentChoice(conn: Pick<Connection, "calendarId">, list: CalendarChoice[]) {
  return conn.calendarId === MAIN_CALENDAR ? list.find((c) => c.main) : list.find((c) => c.id === conn.calendarId);
}

/**
 * Moves the act's gigs to another of their calendars: takes them out of the old one, saves the choice, and asks
 * the sync engine to add them to the new one. Only a calendar from the act's own list can be chosen.
 */
export async function chooseCalendar(userId: string, connectionId: string, calendarId: string, opts: { env?: Env; now?: number } = {}) {
  const conn = await prisma.calendarConnection.findFirst({ where: { id: connectionId, userId } });
  if (!conn) return { error: "That calendar isn't connected any more." } as const;
  const list = await listCalendars(conn, opts);
  const picked = list.find((c) => c.id === calendarId);
  if (!picked) return { error: "Choose one of your calendars." } as const;
  if (currentChoice(conn, list)?.id === picked.id) return { ok: `Your gigs already go in ${picked.name}.`, name: picked.name } as const;
  await clearCalendar(conn.id);
  await prisma.calendarConnection.update({
    where: { id: conn.id },
    data: picked.main ? { calendarId: MAIN_CALENDAR, calendarName: "" } : { calendarId: picked.id, calendarName: picked.name },
  });
  await resyncConnection(conn.id);
  return { ok: `Done. Your gigs now go in ${picked.name}.`, name: picked.name } as const;
}

// ---------------------------------------------------------------------------------------------
// Disconnecting

/** Where Google takes back a token. Microsoft has no such address for one app's access, so the act removes it there. */
export function revokeUrl(env: Pick<ServerEnv, "oauthTestBase"> = serverEnv()) {
  return env.oauthTestBase ? `${env.oauthTestBase}/google/revoke` : "https://oauth2.googleapis.com/revoke";
}

/**
 * Disconnects one of the act's calendars: the sync engine takes Gigsaw's events out first (while it still has
 * access), then Google is told to cancel the access (best effort), then the connection is deleted.
 */
export async function disconnectCalendar(userId: string, connectionId: string, opts: { env?: Env } = {}): Promise<ProviderKey | null> {
  const env = opts.env ?? serverEnv();
  const conn = await prisma.calendarConnection.findFirst({ where: { id: connectionId, userId } });
  if (!conn) return null;
  const provider = providerOf(conn);
  await removeConnectionEvents(conn.id);
  if (provider === "google") {
    try {
      const res = await fetch(revokeUrl(env), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: openToken(conn.refreshTokenEnc, env.calendarTokenKey) }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      // 400 means the token was already gone, which is what we wanted.
      if (!res.ok && res.status !== 400) log.warn("Couldn't revoke a Google calendar token", { status: res.status, connectionId: conn.id });
    } catch (e) {
      log.warn("Couldn't revoke a Google calendar token", { err: e, connectionId: conn.id });
    }
  }
  await prisma.calendarConnection.deleteMany({ where: { id: conn.id, userId } });
  return provider;
}

// ---------------------------------------------------------------------------------------------
// Words

/** The message shown in the act app after connecting, disconnecting or a problem (?calendar=<code>&p=<provider>). */
export function calendarMessage(code: string | undefined, provider: ProviderKey | null): { tone: "error" | "ok"; text: string } | null {
  const cal = provider ? `your ${CALENDAR_LABELS[provider]}` : "your calendar";
  const Cal = cal[0].toUpperCase() + cal.slice(1);
  switch (code) {
    case "connected":
      return { tone: "ok", text: `${Cal} is connected. Gigsaw is putting your gigs in it now, and keeps them up to date.` };
    case "disconnected":
      return {
        tone: "ok",
        text:
          provider === "microsoft"
            ? "Outlook is disconnected and Gigsaw has taken its gigs out. To remove Gigsaw completely, find it in your Microsoft account's app permissions."
            : `${Cal} is disconnected and Gigsaw has taken its gigs out.`,
      };
    case "cancelled":
      return { tone: "error", text: `${Cal} wasn't connected because access wasn't given. You can try again any time.` };
    case "expired":
    case "state":
      return { tone: "error", text: "That took too long or was started in another tab. Please try again." };
    case "wrong_user":
      return { tone: "error", text: "That was started from a different Gigsaw login. Please try again from here." };
    case "no_refresh":
      return { tone: "error", text: `${Cal} only gave Gigsaw short-term access, so it couldn't be connected. Please try again.` };
    case "scope":
      return { tone: "error", text: `Gigsaw needs permission to add events to ${cal}. Please try again and tick every box on the permissions screen.` };
    case "off":
      return { tone: "error", text: "Connecting a calendar isn't set up here yet. You can still subscribe below." };
    case "not_act":
      return { tone: "error", text: "Only an act's own login can connect a calendar." };
    case "failed":
      return {
        tone: "error",
        text: `${Cal} couldn't be connected. Please try again.${provider === "microsoft" ? " With a work or school account, your IT team may need to allow Gigsaw first." : ""}`,
      };
    default:
      return null;
  }
}

/** One line for staff on the act's page: whether the act's calendar is connected. */
export function staffCalendarLine(conns: { provider: string; accountEmail: string; status: string }[], offered = calendarProviders().length > 0) {
  // Nothing to say when the site has calendar connect switched off and nothing was connected before.
  if (!conns.length) return offered ? "Calendar: not connected. They can connect Google Calendar or Outlook in their app." : null;
  return conns
    .map((c) => {
      const label = CALENDAR_LABELS[providerOf(c)];
      const who = c.accountEmail ? ` (${c.accountEmail})` : "";
      return c.status === "NEEDS_RECONNECT"
        ? `Calendar: ${label}${who} needs reconnecting. Gigs aren't reaching it until they reconnect in their app.`
        : `Calendar: ${label} connected${who}. New and changed gigs go straight in.`;
    })
    .join(" ");
}
