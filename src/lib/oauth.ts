import "server-only";
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify, type JsonWebKey } from "node:crypto";

// "Sign in with Google" and "Sign in with Microsoft": OpenID Connect, authorisation code flow with
// PKCE, a random state and a nonce. No SDK: plain fetch, and id_tokens are checked against the
// provider's published signing keys (JWKS) with node:crypto.
//
// Setup is two settings per provider on the server. Buttons only show for providers that are set up.
//   Google:    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   Microsoft: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET (the "common" tenant: work, school and personal accounts)
// Redirect URIs to register: <APP_URL>/api/auth/google/callback and <APP_URL>/api/auth/microsoft/callback

export type ProviderKey = "google" | "microsoft";
export type OAuthIntent = "login" | "signup" | "link";

export const PROVIDERS: Record<ProviderKey, { key: ProviderKey; label: string; db: "GOOGLE" | "MICROSOFT"; idEnv: string; secretEnv: string }> = {
  google: { key: "google", label: "Google", db: "GOOGLE", idEnv: "GOOGLE_CLIENT_ID", secretEnv: "GOOGLE_CLIENT_SECRET" },
  microsoft: { key: "microsoft", label: "Microsoft", db: "MICROSOFT", idEnv: "MICROSOFT_CLIENT_ID", secretEnv: "MICROSOFT_CLIENT_SECRET" },
};

export const PROVIDER_KEYS = Object.keys(PROVIDERS) as ProviderKey[];

/** Personal Microsoft accounts (Outlook.com, Hotmail, Live) all sign in through this tenant. */
export const MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

type Env = Record<string, string | undefined>;

export function parseProvider(s: string | null | undefined): ProviderKey | null {
  return s === "google" || s === "microsoft" ? s : null;
}

export function providerFromDb(s: string): ProviderKey | null {
  return PROVIDER_KEYS.find((k) => PROVIDERS[k].db === s) ?? null;
}

export function providerCredentials(p: ProviderKey, env: Env = process.env) {
  const clientId = env[PROVIDERS[p].idEnv]?.trim();
  const clientSecret = env[PROVIDERS[p].secretEnv]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Providers with both settings in place, so their buttons can show. */
export function configuredProviders(env: Env = process.env): ProviderKey[] {
  return PROVIDER_KEYS.filter((p) => providerCredentials(p, env));
}

export type Endpoints = { authorize: string; token: string; jwks: string; issuerOk: (claims: Claims) => boolean };

/**
 * Where each provider lives. OAUTH_TEST_BASE points both at a stand-in server for testing, and is
 * ignored in production so a stray setting can never send real sign-ins anywhere else.
 */
export function endpoints(p: ProviderKey, env: Env = process.env): Endpoints {
  const test = env.NODE_ENV !== "production" && env.OAUTH_TEST_BASE ? env.OAUTH_TEST_BASE.replace(/\/$/, "") : null;
  if (p === "google") {
    const base = test ? `${test}/google` : null;
    return {
      authorize: base ? `${base}/authorize` : "https://accounts.google.com/o/oauth2/v2/auth",
      token: base ? `${base}/token` : "https://oauth2.googleapis.com/token",
      jwks: base ? `${base}/jwks` : "https://www.googleapis.com/oauth2/v3/certs",
      issuerOk: (c) => (base ? c.iss === base : c.iss === "https://accounts.google.com" || c.iss === "accounts.google.com"),
    };
  }
  const base = test ? `${test}/microsoft` : "https://login.microsoftonline.com";
  return {
    authorize: `${base}/common/oauth2/v2.0/authorize`,
    token: `${base}/common/oauth2/v2.0/token`,
    jwks: `${base}/common/discovery/v2.0/keys`,
    // The "common" endpoint issues tokens from the user's own tenant: the issuer must name that same tenant.
    issuerOk: (c) => typeof c.tid === "string" && /^[0-9a-f-]{36}$/i.test(c.tid) && c.iss === `${base}/${c.tid}/v2.0`,
  };
}

export function redirectUri(p: ProviderKey, baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/auth/${p}/callback`;
}

// ---------------------------------------------------------------------------------------------
// PKCE, state and nonce

const b64url = (buf: Buffer) => buf.toString("base64url");

/** A random, URL-safe secret (32 bytes = 43 characters). */
export function randomToken(bytes = 32) {
  return b64url(randomBytes(bytes));
}

/** The S256 code challenge for a PKCE code verifier (RFC 7636). */
export function pkceChallenge(verifier: string) {
  return b64url(createHash("sha256").update(verifier).digest());
}

/** What we remember between sending someone to the provider and them coming back. */
export type OAuthFlow = { provider: ProviderKey; intent: OAuthIntent; state: string; verifier: string; nonce: string; exp: number };

export const FLOW_MINUTES = 10;

export function newFlow(provider: ProviderKey, intent: OAuthIntent, now = Date.now()): OAuthFlow {
  return { provider, intent, state: randomToken(), verifier: randomToken(48), nonce: randomToken(), exp: now + FLOW_MINUTES * 60_000 };
}

export function authorizeUrl(flow: OAuthFlow, opts: { clientId: string; redirectUri: string; env?: Env }) {
  const url = new URL(endpoints(flow.provider, opts.env).authorize);
  const params: Record<string, string> = {
    client_id: opts.clientId,
    response_type: "code",
    redirect_uri: opts.redirectUri,
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: pkceChallenge(flow.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  };
  if (flow.provider === "microsoft") params.response_mode = "query";
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

// ---------------------------------------------------------------------------------------------
// Signed cookies: a JSON value with an expiry, and an HMAC so it can't be changed in the browser.

export function signValue(value: { exp: number }, key: string) {
  const body = b64url(Buffer.from(JSON.stringify(value)));
  return `${body}.${b64url(createHmac("sha256", key).update(body).digest())}`;
}

export function readSigned<T extends { exp: number }>(token: string | undefined | null, key: string, now = Date.now()): T | null {
  if (!token) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const want = createHmac("sha256", key).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    if (typeof value?.exp !== "number" || value.exp < now) return null;
    return value;
  } catch {
    return null;
  }
}

function sameString(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type CallbackProblem = "cancelled" | "expired" | "state" | "failed";

/**
 * Checks the provider's redirect back to us against the flow we started: same provider, same
 * state (stops someone else's sign-in being slipped into this browser), not expired, and a code.
 */
export function checkCallback(
  flow: OAuthFlow | null,
  provider: ProviderKey,
  params: { code?: string | null; state?: string | null; error?: string | null },
): { ok: true; code: string; flow: OAuthFlow } | { ok: false; problem: CallbackProblem } {
  if (params.error) return { ok: false, problem: params.error === "access_denied" ? "cancelled" : "failed" };
  if (!flow || flow.provider !== provider) return { ok: false, problem: "expired" };
  if (!params.state || !sameString(params.state, flow.state)) return { ok: false, problem: "state" };
  if (!params.code) return { ok: false, problem: "failed" };
  return { ok: true, code: params.code, flow };
}

// ---------------------------------------------------------------------------------------------
// Code exchange and id_token checks

export class OAuthError extends Error {}

export async function exchangeCode(
  provider: ProviderKey,
  opts: { code: string; verifier: string; clientId: string; clientSecret: string; redirectUri: string; env?: Env; fetcher?: typeof fetch },
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    code_verifier: opts.verifier,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
  });
  const res = await (opts.fetcher ?? fetch)(endpoints(provider, opts.env).token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.id_token) throw new OAuthError(`Token exchange failed: ${json.error ?? res.status} ${json.error_description ?? ""}`.trim());
  return json.id_token;
}

export type Claims = Record<string, unknown> & {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  iat?: number;
  nonce?: string;
  tid?: string;
};
type Jwk = JsonWebKey & { kid?: string; kty?: string; use?: string; alg?: string };

/** Signing keys by JWKS address, kept for an hour. An unknown key id fetches them again. */
const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();

export async function fetchJwks(url: string, opts: { fresh?: boolean; fetcher?: typeof fetch } = {}): Promise<Jwk[]> {
  const hit = jwksCache.get(url);
  if (hit && !opts.fresh && Date.now() - hit.at < 3_600_000) return hit.keys;
  const res = await (opts.fetcher ?? fetch)(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new OAuthError(`Couldn't load signing keys (${res.status})`);
  const json = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(json.keys) ? json.keys : [];
  jwksCache.set(url, { keys, at: Date.now() });
  return keys;
}

export type Identity = { provider: ProviderKey; subject: string; email: string; emailVerified: boolean; name: string };

const SKEW_SECONDS = 120;

/**
 * Checks an id_token: RS256 signature by one of the provider's keys, issuer, audience (our client
 * id), not expired, and the nonce we sent. Returns who it is and whether their email is confirmed.
 */
export async function verifyIdToken(
  provider: ProviderKey,
  idToken: string,
  opts: { clientId: string; nonce: string; now?: number; env?: Env; getKeys?: (fresh: boolean) => Promise<Jwk[]> },
): Promise<Identity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new OAuthError("Malformed id_token");
  const [h, p, s] = parts;
  let header: { alg?: string; kid?: string };
  let claims: Claims;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    throw new OAuthError("Malformed id_token");
  }
  // Only RS256: never "none", and never an HMAC algorithm that would use a public key as a secret.
  if (header.alg !== "RS256") throw new OAuthError(`Unexpected signing algorithm ${header.alg}`);

  const ep = endpoints(provider, opts.env);
  const getKeys = opts.getKeys ?? ((fresh: boolean) => fetchJwks(ep.jwks, { fresh }));
  const pick = (keys: Jwk[]) => keys.find((k) => k.kty === "RSA" && (!header.kid || k.kid === header.kid) && (!k.use || k.use === "sig"));
  let jwk = pick(await getKeys(false));
  if (!jwk) jwk = pick(await getKeys(true)); // keys are rotated now and then
  if (!jwk) throw new OAuthError("No matching signing key");
  const key = createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e } as JsonWebKey, format: "jwk" });
  if (!verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"))) throw new OAuthError("Bad id_token signature");

  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (!ep.issuerOk(claims)) throw new OAuthError(`Unexpected issuer ${claims.iss}`);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.clientId)) throw new OAuthError("id_token is for another app");
  if (aud.length > 1 && claims.azp !== opts.clientId) throw new OAuthError("id_token is for another app");
  if (typeof claims.exp !== "number" || claims.exp + SKEW_SECONDS < now) throw new OAuthError("id_token has expired");
  if (typeof claims.iat === "number" && claims.iat - SKEW_SECONDS > now) throw new OAuthError("id_token issued in the future");
  if (typeof claims.nonce !== "string" || !sameString(claims.nonce, opts.nonce)) throw new OAuthError("id_token nonce doesn't match");
  if (typeof claims.sub !== "string" || !claims.sub) throw new OAuthError("id_token has no subject");

  return identityFromClaims(provider, claims);
}

const yes = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";

/**
 * Who the token is for. The email only counts as confirmed when the provider says so:
 * Google sets email_verified. Microsoft's "email" claim can be typed in by a tenant admin, so it's
 * only trusted for personal accounts (checked by Microsoft) or when the tenant has proved it owns
 * the domain (the optional xms_edov claim), or when it's listed in verified_primary_email.
 */
export function identityFromClaims(provider: ProviderKey, c: Claims): Identity {
  const email = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
  let emailVerified = false;
  if (email && provider === "google") emailVerified = yes(c.email_verified);
  if (email && provider === "microsoft") {
    const listed = Array.isArray(c.verified_primary_email) ? c.verified_primary_email.map((e) => String(e).toLowerCase()) : [];
    emailVerified = c.tid === MICROSOFT_CONSUMER_TENANT || yes(c.xms_edov) || listed.includes(email);
  }
  const name = typeof c.name === "string" && c.name.trim() ? c.name.trim() : [c.given_name, c.family_name].filter((x) => typeof x === "string" && x).join(" ");
  return { provider, subject: String(c.sub), email, emailVerified, name };
}

// ---------------------------------------------------------------------------------------------
// Messages shown back on the login, sign-up and profile pages (?oauth=<code>).

export function oauthMessage(code: string | undefined, provider: ProviderKey | null, email?: string): { tone: "error" | "ok"; text: string } | null {
  const who = provider ? PROVIDERS[provider].label : "that account";
  switch (code) {
    case "no_account":
      return {
        tone: "error",
        text: `No Gigsaw account for ${email || "that email"}. Ask your admin to invite you, or sign up to start a new business on Gigsaw.`,
      };
    case "unverified":
      return {
        tone: "error",
        text: `${who} didn't confirm that email address, so we can't match it to a Gigsaw login. Sign in with your password, then connect ${who} from your Profile.`,
      };
    case "cancelled":
      return { tone: "error", text: "Sign in was cancelled." };
    case "expired":
    case "state":
      return { tone: "error", text: "That sign in took too long or was started in another tab. Please try again." };
    case "taken":
      return { tone: "error", text: `That ${who} account is already connected to another Gigsaw login.` };
    case "off":
      return { tone: "error", text: `Signing in with ${who} isn't set up on this site.` };
    case "failed":
      return { tone: "error", text: `We couldn't sign you in with ${who}. Please try again.` };
    case "last":
      return { tone: "error", text: `${who} is your only way to sign in. Set a password or connect another account first.` };
    case "connected":
      return { tone: "ok", text: `${who} is connected. You can now sign in with it.` };
    case "disconnected":
      return { tone: "ok", text: `${who} is no longer connected.` };
    default:
      return null;
  }
}
