import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const {
  authorizeUrl,
  checkCallback,
  configuredProviders,
  endpoints,
  identityFromClaims,
  MICROSOFT_CONSUMER_TENANT,
  newFlow,
  oauthMessage,
  pkceChallenge,
  readSigned,
  redirectUri,
  signValue,
  verifyIdToken,
} = await import("@/lib/oauth");
const { calendarLinks } = await import("@/lib/calendar-links");

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const CLIENT = "client-123.apps.example";
const NONCE = "nonce-abc";
const TENANT = "72f988bf-86f1-41af-91ab-2d7cd011db47";

function keyPair(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" } };
}

function jwt(claims: Record<string, unknown>, key: KeyObject, header: Record<string, unknown> = { alg: "RS256", kid: "k1", typ: "JWT" }) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${enc(header)}.${enc(claims)}`;
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), key).toString("base64url")}`;
}

const k1 = keyPair("k1");
const k2 = keyPair("k2");
const s = Math.floor(NOW / 1000);
const googleClaims = (over: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  aud: CLIENT,
  sub: "1100223344",
  email: "Jo.Rivers@Example.com",
  email_verified: true,
  name: "Jo Rivers",
  nonce: NONCE,
  iat: s - 10,
  exp: s + 3600,
  ...over,
});
const keysOf =
  (...jwks: object[]) =>
  async () =>
    jwks as never[];
const check = (token: string, over: Partial<Parameters<typeof verifyIdToken>[2]> = {}, provider: "google" | "microsoft" = "google") =>
  verifyIdToken(provider, token, { clientId: CLIENT, nonce: NONCE, now: NOW, env: {}, getKeys: keysOf(k1.jwk), ...over });

describe("PKCE, state and the authorisation request", () => {
  it("makes the S256 challenge from RFC 7636's example", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("starts each flow with fresh, long, URL-safe secrets", () => {
    const a = newFlow("google", "login", NOW);
    const b = newFlow("google", "login", NOW);
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.nonce).not.toBe(b.nonce);
    // RFC 7636: a verifier is 43 to 128 unreserved characters.
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(a.state.length).toBeGreaterThanOrEqual(43);
    expect(a.exp).toBe(NOW + 10 * 60_000);
  });

  it("sends state, nonce and the code challenge, never the verifier", () => {
    const flow = newFlow("google", "login", NOW);
    const url = new URL(authorizeUrl(flow, { clientId: CLIENT, redirectUri: redirectUri("google", "https://app.gigsaw.live/"), env: {} }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({
      client_id: CLIENT,
      response_type: "code",
      redirect_uri: "https://app.gigsaw.live/api/auth/google/callback",
      scope: "openid email profile",
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: pkceChallenge(flow.verifier),
      code_challenge_method: "S256",
    });
    expect(url.toString()).not.toContain(flow.verifier);
  });

  it("uses Microsoft's common tenant with the code in the query string", () => {
    const url = new URL(authorizeUrl(newFlow("microsoft", "login", NOW), { clientId: CLIENT, redirectUri: "https://x/cb", env: {} }));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("response_mode")).toBe("query");
  });

  it("only uses a test provider outside production", () => {
    expect(endpoints("google", { OAUTH_TEST_BASE: "http://localhost:4245", NODE_ENV: "development" }).token).toBe("http://localhost:4245/google/token");
    expect(endpoints("google", { OAUTH_TEST_BASE: "http://localhost:4245", NODE_ENV: "production" }).token).toBe("https://oauth2.googleapis.com/token");
    expect(endpoints("microsoft", { OAUTH_TEST_BASE: "http://evil", NODE_ENV: "production" }).jwks).toBe(
      "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    );
  });

  it("shows a provider only when both its id and secret are set", () => {
    expect(configuredProviders({})).toEqual([]);
    expect(configuredProviders({ GOOGLE_CLIENT_ID: "a" })).toEqual([]);
    expect(configuredProviders({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", MICROSOFT_CLIENT_ID: "c" })).toEqual(["google"]);
    expect(configuredProviders({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", MICROSOFT_CLIENT_ID: "c", MICROSOFT_CLIENT_SECRET: "d" })).toEqual([
      "google",
      "microsoft",
    ]);
  });
});

describe("signed flow cookie", () => {
  const key = "k".repeat(48);
  const flow = newFlow("google", "signup", NOW);

  it("reads back what it wrote", () => {
    expect(readSigned(signValue(flow, key), key, NOW)).toEqual(flow);
  });

  it("refuses a changed, re-keyed, expired or malformed cookie", () => {
    const token = signValue(flow, key);
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...flow, intent: "link" })).toString("base64url");
    expect(readSigned(`${forged}.${mac}`, key, NOW)).toBeNull();
    expect(readSigned(token, "another-key", NOW)).toBeNull();
    expect(readSigned(token, key, flow.exp + 1)).toBeNull();
    expect(readSigned(`${body}.${mac}.x`, key, NOW)).toBeNull();
    expect(readSigned(body, key, NOW)).toBeNull();
    expect(readSigned("", key, NOW)).toBeNull();
    expect(readSigned(undefined, key, NOW)).toBeNull();
  });
});

describe("callback checks", () => {
  const flow = newFlow("google", "login", NOW);

  it("accepts the matching state and a code", () => {
    expect(checkCallback(flow, "google", { code: "abc", state: flow.state })).toEqual({ ok: true, code: "abc", flow });
  });

  it("refuses a state that doesn't match (login CSRF)", () => {
    expect(checkCallback(flow, "google", { code: "abc", state: "attacker" })).toEqual({ ok: false, problem: "state" });
    expect(checkCallback(flow, "google", { code: "abc", state: null })).toEqual({ ok: false, problem: "state" });
  });

  it("refuses when no flow was started here, or it was for the other provider", () => {
    expect(checkCallback(null, "google", { code: "abc", state: flow.state })).toEqual({ ok: false, problem: "expired" });
    expect(checkCallback(flow, "microsoft", { code: "abc", state: flow.state })).toEqual({ ok: false, problem: "expired" });
  });

  it("tells a cancel from other errors, and needs a code", () => {
    expect(checkCallback(flow, "google", { error: "access_denied", state: flow.state })).toEqual({ ok: false, problem: "cancelled" });
    expect(checkCallback(flow, "google", { error: "server_error", state: flow.state })).toEqual({ ok: false, problem: "failed" });
    expect(checkCallback(flow, "google", { state: flow.state })).toEqual({ ok: false, problem: "failed" });
  });
});

describe("id_token checks", () => {
  it("accepts a good Google token and lower-cases the email", async () => {
    const id = await check(jwt(googleClaims(), k1.privateKey));
    expect(id).toEqual({ provider: "google", subject: "1100223344", email: "jo.rivers@example.com", emailVerified: true, name: "Jo Rivers" });
  });

  it("refuses a bad signature, or a token signed by a key that isn't the provider's", async () => {
    const good = jwt(googleClaims(), k1.privateKey);
    const [h, , sig] = good.split(".");
    const tampered = `${h}.${Buffer.from(JSON.stringify(googleClaims({ sub: "someone-else" }))).toString("base64url")}.${sig}`;
    await expect(check(tampered)).rejects.toThrow(/signature/);
    await expect(check(jwt(googleClaims(), k2.privateKey))).rejects.toThrow(/signature/);
  });

  it("only allows RS256", async () => {
    await expect(check(jwt(googleClaims(), k1.privateKey, { alg: "none", kid: "k1" }))).rejects.toThrow(/algorithm/);
    await expect(check(jwt(googleClaims(), k1.privateKey, { alg: "HS256", kid: "k1" }))).rejects.toThrow(/algorithm/);
  });

  it("checks issuer, audience, expiry and nonce", async () => {
    await expect(check(jwt(googleClaims({ iss: "https://evil.example" }), k1.privateKey))).rejects.toThrow(/issuer/);
    await expect(check(jwt(googleClaims({ aud: "someone-elses-app" }), k1.privateKey))).rejects.toThrow(/another app/);
    await expect(check(jwt(googleClaims({ aud: [CLIENT, "other"], azp: "other" }), k1.privateKey))).rejects.toThrow(/another app/);
    await expect(check(jwt(googleClaims({ exp: s - 600 }), k1.privateKey))).rejects.toThrow(/expired/);
    await expect(check(jwt(googleClaims({ iat: s + 3600 }), k1.privateKey))).rejects.toThrow(/future/);
    await expect(check(jwt(googleClaims({ nonce: "replayed" }), k1.privateKey))).rejects.toThrow(/nonce/);
    await expect(check(jwt(googleClaims({ nonce: undefined }), k1.privateKey))).rejects.toThrow(/nonce/);
    await expect(check("not.a.jwt.at-all")).rejects.toThrow(/Malformed/);
  });

  it("fetches the keys again when the key id is new (key rotation)", async () => {
    const calls: boolean[] = [];
    const getKeys = async (fresh: boolean) => {
      calls.push(fresh);
      return (fresh ? [k1.jwk, k2.jwk] : [k1.jwk]) as never[];
    };
    const id = await check(jwt(googleClaims(), k2.privateKey, { alg: "RS256", kid: "k2" }), { getKeys });
    expect(id.subject).toBe("1100223344");
    expect(calls).toEqual([false, true]);
  });

  it("reports an unconfirmed Google email as such", async () => {
    const id = await check(jwt(googleClaims({ email_verified: false }), k1.privateKey));
    expect(id.emailVerified).toBe(false);
  });

  it("needs a Microsoft issuer that names the token's own tenant", async () => {
    const ms = (over: Record<string, unknown>) => googleClaims({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, ...over });
    await expect(check(jwt(ms({}), k1.privateKey), {}, "microsoft")).resolves.toMatchObject({ provider: "microsoft" });
    await expect(check(jwt(ms({ tid: MICROSOFT_CONSUMER_TENANT }), k1.privateKey), {}, "microsoft")).rejects.toThrow(/issuer/);
    await expect(check(jwt(ms({ iss: "https://login.microsoftonline.com/common/v2.0" }), k1.privateKey), {}, "microsoft")).rejects.toThrow(/issuer/);
  });

  it("only trusts a Microsoft email when Microsoft has confirmed it", () => {
    const base = { sub: "x", email: "Jo@Contoso.com", name: "Jo" };
    expect(identityFromClaims("microsoft", { ...base, tid: MICROSOFT_CONSUMER_TENANT }).emailVerified).toBe(true);
    expect(identityFromClaims("microsoft", { ...base, tid: TENANT }).emailVerified).toBe(false);
    expect(identityFromClaims("microsoft", { ...base, tid: TENANT, xms_edov: true }).emailVerified).toBe(true);
    expect(identityFromClaims("microsoft", { ...base, tid: TENANT, verified_primary_email: ["jo@contoso.com"] }).emailVerified).toBe(true);
    // email_verified means nothing coming from Microsoft.
    expect(identityFromClaims("microsoft", { ...base, tid: TENANT, email_verified: true }).emailVerified).toBe(false);
    expect(identityFromClaims("microsoft", { sub: "x", tid: MICROSOFT_CONSUMER_TENANT }).emailVerified).toBe(false);
  });
});

describe("messages and calendar links", () => {
  it("explains a missing account kindly, naming the email", () => {
    expect(oauthMessage("no_account", "google", "jo@example.com")?.text).toBe(
      "No Gigsaw account for jo@example.com. Ask your admin to invite you, or sign up to start a new business on Gigsaw.",
    );
    expect(oauthMessage("nonsense", "google")).toBeNull();
    for (const code of ["no_account", "unverified", "cancelled", "expired", "taken", "failed", "connected", "last"]) {
      expect(oauthMessage(code, "microsoft")?.text).not.toContain("—");
    }
  });

  it("builds one-click subscribe links for Google, Outlook and Apple", () => {
    const l = calendarLinks("https://app.gigsaw.live/api/calendar/team/abc.ics", "Gigsaw: my bookings");
    expect(l.webcal).toBe("webcal://app.gigsaw.live/api/calendar/team/abc.ics");
    expect(l.google).toBe("https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fapp.gigsaw.live%2Fapi%2Fcalendar%2Fteam%2Fabc.ics");
    expect(l.outlook).toBe(
      "https://outlook.live.com/calendar/0/addfromweb?url=https%3A%2F%2Fapp.gigsaw.live%2Fapi%2Fcalendar%2Fteam%2Fabc.ics&name=Gigsaw%3A%20my%20bookings",
    );
    expect(l.outlook365).toMatch(/^https:\/\/outlook\.office\.com\/calendar\/0\/addfromweb\?url=https%3A/);
  });
});
