import "server-only";
import { endpoints } from "@/lib/oauth";
import { env as serverEnv, type ServerEnv } from "@/server/env";
import { openToken, sealToken } from "@/server/token-box";
import { googleEventBody, microsoftEventBody, type CalendarEventContent, type Provider } from "./content";

// Google Calendar v3 and Microsoft Graph with plain fetch: refresh the access token from the
// stored (encrypted) refresh token, then create, change and delete events. No SDKs.
//
// Three kinds of failure, because each needs a different response:
//   CalendarAccessError  the act has to connect again (access withdrawn, or the calendar is gone
//                        or read-only): the connection is set to NEEDS_RECONNECT.
//   CalendarSetupError   our side isn't set up (no CALENDAR_TOKEN_KEY or provider app): nothing
//                        the act can do, so the connection stays as it is with the error noted.
//   CalendarApiError     anything else (rate limits, the provider being down): tried again later.
// Messages are plain English for the act's and staff's screens, and never carry a token.

export class CalendarAccessError extends Error {
  name = "CalendarAccessError";
}
export class CalendarSetupError extends Error {
  name = "CalendarSetupError";
}
export class CalendarApiError extends Error {
  name = "CalendarApiError";
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

type Env = Pick<ServerEnv, "oauth" | "oauthTestBase" | "calendarTokenKey">;

const LABEL: Record<Provider, string> = { GOOGLE: "Google", MICROSOFT: "Microsoft" };

/** The scopes the connect flow asks Microsoft for (docs/calendar-connect.md); a refresh asks for the same. */
const MICROSOFT_SCOPES = "openid email offline_access User.Read Calendars.ReadWrite";

/** Refresh a little before the provider's expiry, so a token doesn't run out between check and use. */
const EXPIRY_MARGIN_MS = 60_000;
const TIMEOUT_MS = 15_000;

/**
 * Where each provider's calendar API lives. OAUTH_TEST_BASE (never in production: env() drops it
 * there) points both at a stand-in, under the same base sign-in uses: <base>/google/calendar/v3
 * and <base>/microsoft/graph/v1.0.
 */
export function apiBase(provider: Provider, env: Pick<ServerEnv, "oauthTestBase"> = serverEnv()) {
  const test = env.oauthTestBase;
  if (provider === "GOOGLE") return test ? `${test}/google/calendar/v3` : "https://www.googleapis.com/calendar/v3";
  return test ? `${test}/microsoft/graph/v1.0` : "https://graph.microsoft.com/v1.0";
}

/** The stored connection, as much of it as the client needs. */
export type StoredConnection = {
  id: string;
  provider: string;
  calendarId: string;
  refreshTokenEnc: string;
  accessTokenEnc: string;
  accessTokenExpiresAt: Date | null;
};

/** New tokens to keep, already sealed. */
export type TokenUpdate = { accessTokenEnc: string; accessTokenExpiresAt: Date; refreshTokenEnc?: string };

export type ClientDeps = {
  /** Saves refreshed tokens on the connection. */
  saveTokens: (update: TokenUpdate) => Promise<void>;
  env?: Env;
  fetcher?: typeof fetch;
  now?: () => number;
};

/** Errors the token endpoint gives when the grant itself is no good: only connecting again fixes them. */
const DEAD_GRANT = new Set(["invalid_grant", "interaction_required", "consent_required", "login_required"]);

/** Google's 403s that mean "slow down", not "not allowed". */
const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"]);

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/** The provider's own short reason, e.g. "invalid_grant" or "ErrorAccessDenied", for logs and lastError. */
function reasonOf(json: Record<string, unknown>): string {
  const err = json.error as { code?: unknown; message?: unknown; errors?: { reason?: unknown }[] } | string | undefined;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const reason = err.errors?.[0]?.reason ?? err.code;
    return typeof reason === "string" ? reason : String(reason ?? "");
  }
  return "";
}

export class CalendarClient {
  private readonly provider: Provider;
  private readonly env: Env;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private access: string | null = null;
  private accessExpires = 0;

  constructor(
    private readonly conn: StoredConnection,
    private readonly deps: ClientDeps,
  ) {
    if (conn.provider !== "GOOGLE" && conn.provider !== "MICROSOFT") throw new CalendarSetupError(`Unknown calendar provider ${conn.provider}`);
    this.provider = conn.provider;
    this.env = deps.env ?? serverEnv();
    this.fetcher = deps.fetcher ?? ((...args) => fetch(...args));
    this.now = deps.now ?? Date.now;
  }

  private get label() {
    return LABEL[this.provider];
  }

  private key() {
    if (!this.env.calendarTokenKey) throw new CalendarSetupError("Calendar connect isn't set up on this server (CALENDAR_TOKEN_KEY is missing).");
    return this.env.calendarTokenKey;
  }

  /** A usable access token: the stored one while it lasts, otherwise a fresh one. */
  private async accessToken(): Promise<string> {
    if (this.access && this.accessExpires - EXPIRY_MARGIN_MS > this.now()) return this.access;
    if (
      !this.access &&
      this.conn.accessTokenEnc &&
      this.conn.accessTokenExpiresAt &&
      this.conn.accessTokenExpiresAt.getTime() - EXPIRY_MARGIN_MS > this.now()
    ) {
      try {
        this.access = openToken(this.conn.accessTokenEnc, this.key());
        this.accessExpires = this.conn.accessTokenExpiresAt.getTime();
        return this.access;
      } catch (e) {
        if (e instanceof CalendarSetupError) throw e;
        // A stored access token that won't open is just thrown away: the refresh token gets a new one.
      }
    }
    return this.refresh();
  }

  /** Swap the refresh token for a new access token, and keep it (and a new refresh token, if one comes back). */
  async refresh(): Promise<string> {
    const creds = this.env.oauth[this.provider === "GOOGLE" ? "google" : "microsoft"];
    if (!creds) throw new CalendarSetupError(`Sign in with ${this.label} isn't set up on this server, so its calendar can't be reached.`);
    const key = this.key();
    let refreshToken: string;
    try {
      refreshToken = openToken(this.conn.refreshTokenEnc, key);
    } catch {
      // Sealed with another key (CALENDAR_TOKEN_KEY changed) or damaged: only connecting again helps.
      throw new CalendarAccessError(`The saved ${this.label} access can't be read any more. Connect the calendar again.`);
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    });
    if (this.provider === "MICROSOFT") body.set("scope", MICROSOFT_SCOPES);
    let res: Response;
    try {
      res = await this.fetcher(endpoints(this.provider === "GOOGLE" ? "google" : "microsoft", this.env).token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: body.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new CalendarApiError(`Couldn't reach ${this.label} to renew access (${e instanceof Error ? e.message : String(e)}).`);
    }
    const json = await readJson(res);
    const accessToken = typeof json.access_token === "string" ? json.access_token : "";
    if (!res.ok || !accessToken) {
      const reason = reasonOf(json);
      if (DEAD_GRANT.has(reason))
        throw new CalendarAccessError(`${this.label} says Gigsaw's access to the calendar has been withdrawn or has expired (${reason}). Connect it again.`);
      throw new CalendarApiError(`${this.label} wouldn't renew access (${reason || res.status}).`, res.status);
    }
    const expiresIn = Number(json.expires_in);
    const expiresAt = new Date(this.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000);
    const update: TokenUpdate = { accessTokenEnc: sealToken(accessToken, key), accessTokenExpiresAt: expiresAt };
    // Microsoft hands out a new refresh token each time; Google rarely does. Keep whichever is newest.
    if (typeof json.refresh_token === "string" && json.refresh_token && json.refresh_token !== refreshToken) {
      update.refreshTokenEnc = sealToken(json.refresh_token, key);
      this.conn.refreshTokenEnc = update.refreshTokenEnc;
    }
    await this.deps.saveTokens(update);
    this.access = accessToken;
    this.accessExpires = expiresAt.getTime();
    return accessToken;
  }

  /**
   * One API call. A 401 refreshes the access token and tries once more; a 401 straight after a
   * refresh means the access is gone. Returns the response for the caller to read.
   */
  private async call(method: string, url: string, body?: unknown): Promise<Response> {
    for (let retried = false; ; retried = true) {
      const token = await this.accessToken();
      let res: Response;
      try {
        res = await this.fetcher(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new CalendarApiError(`Couldn't reach ${this.label} Calendar (${e instanceof Error ? e.message : String(e)}).`);
      }
      if (res.status !== 401) return res;
      if (retried) throw new CalendarAccessError(`${this.label} turned down Gigsaw's access to the calendar. Connect it again.`);
      this.access = null;
      this.accessExpires = 0;
      await this.refresh();
    }
  }

  /** Turns a failed response into the right error. */
  private async fail(res: Response, what: string): Promise<never> {
    const json = await readJson(res);
    const reason = reasonOf(json);
    if (res.status === 403 && !RATE_LIMIT_REASONS.has(reason)) {
      throw new CalendarAccessError(
        `${this.label} won't let Gigsaw ${what} in this calendar (${reason || "forbidden"}). Connect again and choose a calendar you can edit.`,
      );
    }
    throw new CalendarApiError(`${this.label} couldn't ${what} (${reason || res.status}).`, res.status);
  }

  private eventsUrl() {
    const base = apiBase(this.provider, this.env);
    const cal = this.conn.calendarId;
    if (this.provider === "GOOGLE") return `${base}/calendars/${encodeURIComponent(cal || "primary")}/events`;
    return !cal || cal === "primary" ? `${base}/me/calendar/events` : `${base}/me/calendars/${encodeURIComponent(cal)}/events`;
  }

  private eventUrl(externalId: string) {
    // Graph addresses an event by its id alone, whichever calendar it's in; Google needs the calendar.
    if (this.provider === "MICROSOFT") return `${apiBase(this.provider, this.env)}/me/events/${encodeURIComponent(externalId)}`;
    return `${this.eventsUrl()}/${encodeURIComponent(externalId)}`;
  }

  private body(content: CalendarEventContent, bookingId: string) {
    return this.provider === "GOOGLE" ? googleEventBody(content, bookingId) : microsoftEventBody(content);
  }

  /** Add the gig to the calendar. Returns the provider's id for the new event. */
  async createEvent(content: CalendarEventContent, bookingId: string): Promise<string> {
    // Google's "send notifications to guests" off: there are none, but say so.
    const url = this.provider === "GOOGLE" ? `${this.eventsUrl()}?sendUpdates=none` : this.eventsUrl();
    const res = await this.call("POST", url, this.body(content, bookingId));
    if (res.status === 404) {
      throw new CalendarAccessError(`The ${this.label} calendar Gigsaw puts gigs in can't be found any more. Connect again and choose a calendar.`);
    }
    if (!res.ok) return this.fail(res, "add the gig");
    const json = await readJson(res);
    if (typeof json.id !== "string" || !json.id) throw new CalendarApiError(`${this.label} added the gig but didn't say its id.`, res.status);
    return json.id;
  }

  /** Change the gig's event. "gone" if it isn't there any more (deleted by hand), so the caller can add it again. */
  async updateEvent(externalId: string, content: CalendarEventContent, bookingId: string): Promise<"ok" | "gone"> {
    const url = this.provider === "GOOGLE" ? `${this.eventUrl(externalId)}?sendUpdates=none` : this.eventUrl(externalId);
    const res = await this.call("PATCH", url, this.body(content, bookingId));
    if (res.status === 404 || res.status === 410) return "gone";
    if (!res.ok) return this.fail(res, "change the gig");
    return "ok";
  }

  /** Take the gig's event out. Already gone counts as done. */
  async deleteEvent(externalId: string): Promise<void> {
    const url = this.provider === "GOOGLE" ? `${this.eventUrl(externalId)}?sendUpdates=none` : this.eventUrl(externalId);
    const res = await this.call("DELETE", url);
    if (res.ok || res.status === 404 || res.status === 410) return;
    return this.fail(res, "remove the gig");
  }
}
