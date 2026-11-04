import { describe, expect, it } from "vitest";
import { checkEnvAtBoot, EnvError, normaliseAppUrl, parseEnv, parseSentryDsn } from "@/server/env";

const DB = "postgresql://postgres:secret-password@db:5432/gigsaw";
const prod = (more: Record<string, string> = {}) => ({ NODE_ENV: "production", DATABASE_URL: DB, APP_URL: "https://gigsaw.live", ...more });

describe("the public address", () => {
  it("prefers APP_URL, then Railway's domain, then localhost on PORT", () => {
    expect(parseEnv({ APP_URL: "https://gigsaw.live/", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }).env.appUrl).toBe("https://gigsaw.live");
    expect(parseEnv({ RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }).env.appUrl).toBe("https://x.up.railway.app");
    expect(parseEnv({ PORT: "3151" }).env.appUrl).toBe("http://localhost:3151");
    expect(parseEnv({}).env.appUrl).toBe("http://localhost:3000");
  });

  it("takes a bare domain as https and refuses things that aren't addresses", () => {
    expect(normaliseAppUrl("gigsaw.live")).toBe("https://gigsaw.live");
    expect(normaliseAppUrl("https://gigsaw.live/app/")).toBe("https://gigsaw.live/app");
    expect(normaliseAppUrl("ftp://gigsaw.live")).toBeNull();
    expect(normaliseAppUrl("https://gigsaw.live/?x=1")).toBeNull();
    expect(normaliseAppUrl("https://")).toBeNull();
  });

  it("treats blank values as not set", () => {
    expect(parseEnv({ APP_URL: "  ", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }).env.appUrl).toBe("https://x.up.railway.app");
  });
});

describe("in production", () => {
  it("is happy with the essentials set", () => {
    const r = parseEnv(prod());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.env.isProduction).toBe(true);
  });

  it("refuses to start with no public address", () => {
    const r = parseEnv({ NODE_ENV: "production", DATABASE_URL: DB });
    expect(r.errors.join(" ")).toMatch(/APP_URL/);
    expect(r.errors.join(" ")).toMatch(/RAILWAY_PUBLIC_DOMAIN/);
    expect(() => checkEnvAtBoot({ NODE_ENV: "production", DATABASE_URL: DB })).toThrow(EnvError);
    // Railway's own domain is enough.
    expect(parseEnv({ NODE_ENV: "production", DATABASE_URL: DB, RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }).errors).toEqual([]);
  });

  it("refuses to start without a Postgres DATABASE_URL", () => {
    expect(parseEnv(prod({ DATABASE_URL: "" })).errors.join(" ")).toMatch(/DATABASE_URL is not set/);
    expect(parseEnv(prod({ DATABASE_URL: "mysql://x" })).errors.join(" ")).toMatch(/postgresql:\/\//);
  });

  it("refuses an APP_URL that isn't an address, even with Railway's domain set", () => {
    expect(parseEnv(prod({ APP_URL: "https://", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" })).errors.join(" ")).toMatch(/APP_URL isn't a web address/);
  });

  it("ignores the test-only stand-ins and says so", () => {
    const r = parseEnv(prod({ STRIPE_API_BASE: "http://localhost:4242", OAUTH_TEST_BASE: "http://localhost:4245" }));
    expect(r.env.stripeApiBase).toBe("https://api.stripe.com");
    expect(r.env.oauthTestBase).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/STRIPE_API_BASE is only for testing/);
    expect(r.warnings.join(" ")).toMatch(/OAUTH_TEST_BASE is only for testing/);
  });

  it("warns about local or http addresses", () => {
    expect(parseEnv(prod({ APP_URL: "http://localhost:3000" })).warnings.join(" ")).toMatch(/local one/);
    expect(parseEnv(prod({ APP_URL: "http://gigsaw.live" })).warnings.join(" ")).toMatch(/https:\/\//);
  });
});

describe("outside production", () => {
  it("only warns about missing essentials, and uses the test stand-ins", () => {
    const warned: string[] = [];
    expect(checkEnvAtBoot({ NODE_ENV: "development", STRIPE_API_BASE: "http://localhost:4242/" }, (m) => warned.push(m)).length).toBe(1);
    expect(warned[0]).toMatch(/DATABASE_URL/);
    expect(parseEnv({ STRIPE_API_BASE: "http://localhost:4242/" }).env.stripeApiBase).toBe("http://localhost:4242");
    expect(parseEnv({ OAUTH_TEST_BASE: "http://localhost:4245/" }).env.oauthTestBase).toBe("http://localhost:4245");
  });
});

describe("providers", () => {
  it("turns each one on only when all its settings are there", () => {
    const e = parseEnv({
      RESEND_API_KEY: "re_1",
      MAIL_FROM: "Gigsaw <bookings@send.gigsaw.live>",
      TWILIO_ACCOUNT_SID: "AC1",
      TWILIO_AUTH_TOKEN: "t",
      TWILIO_FROM: "+447700900000",
      VAPID_PUBLIC_KEY: "pub",
      VAPID_PRIVATE_KEY: "priv",
      GOOGLE_CLIENT_ID: "g",
      GOOGLE_CLIENT_SECRET: "gs",
    }).env;
    expect(e.email).toEqual({ apiKey: "re_1", from: "Gigsaw <bookings@send.gigsaw.live>" });
    expect(e.mailFromAddress).toBe("bookings@send.gigsaw.live");
    expect(e.sms?.from).toBe("+447700900000");
    expect(e.vapid).toEqual({ publicKey: "pub", privateKey: "priv" });
    expect(e.oauth.google).toEqual({ clientId: "g", clientSecret: "gs" });
    expect(e.oauth.microsoft).toBeNull();
  });

  it("warns about half-set providers by name, never by value", () => {
    const secrets = {
      RESEND_API_KEY: "re_secret_value",
      TWILIO_AUTH_TOKEN: "twilio-secret-value",
      MICROSOFT_CLIENT_SECRET: "ms-secret-value",
      STRIPE_SECRET_KEY: "sk_live_secretvalue123",
    };
    const r = parseEnv(prod(secrets));
    const text = r.warnings.join("\n");
    expect(r.env.email).toBeNull();
    expect(r.env.sms).toBeNull();
    expect(r.env.oauth.microsoft).toBeNull();
    expect(text).toMatch(/RESEND_API_KEY is set but MAIL_FROM is not/);
    expect(text).toMatch(/Texting \(Twilio\) is half set up: TWILIO_AUTH_TOKEN is set but TWILIO_ACCOUNT_SID, TWILIO_FROM are not/);
    expect(text).toMatch(/Sign in with Microsoft is half set up/);
    expect(text).toMatch(/STRIPE_WEBHOOK_SECRET is not/);
    for (const v of Object.values(secrets)) expect(text).not.toContain(v);
    expect(JSON.stringify(parseEnv(prod({ DATABASE_URL: "" })).errors)).not.toContain("secret-password");
  });

  it("keeps Stripe keys as given, for the Owner area's keys to override", () => {
    const e = parseEnv({ STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: "whsec_abc" }).env;
    expect(e.stripe).toEqual({ secretKey: "sk_test_abc", webhookSecret: "whsec_abc", connectWebhookSecret: "" });
    expect(parseEnv({}).env.stripe.secretKey).toBe("");
  });

  it("warns when the scheduler is off with nothing to call it", () => {
    expect(parseEnv(prod({ DISABLE_SCHEDULER: "1" })).warnings.join(" ")).toMatch(/CRON_SECRET isn't set/);
    expect(parseEnv(prod({ DISABLE_SCHEDULER: "1", CRON_SECRET: "a-long-enough-secret" })).warnings).toEqual([]);
  });
});

describe("other settings", () => {
  it("reads PORT and LOG_LEVEL, falling back with a warning", () => {
    expect(parseEnv({ PORT: "8080" }).env.port).toBe(8080);
    const bad = parseEnv({ PORT: "eighty", LOG_LEVEL: "loud" });
    expect(bad.env.port).toBe(3000);
    expect(bad.env.logLevel).toBe("info");
    expect(bad.warnings).toHaveLength(2);
    expect(parseEnv({ LOG_LEVEL: "DEBUG" }).env.logLevel).toBe("debug");
  });

  it("understands a Sentry DSN", () => {
    expect(parseSentryDsn("https://abc123@o42.ingest.sentry.io/4507")).toEqual({
      key: "abc123",
      envelopeUrl: "https://o42.ingest.sentry.io/api/4507/envelope/",
    });
    expect(parseSentryDsn("https://abc@sentry.example.com/prefix/7")?.envelopeUrl).toBe("https://sentry.example.com/prefix/api/7/envelope/");
    expect(parseSentryDsn("https://o42.ingest.sentry.io/4507")).toBeNull();
    const r = parseEnv({ SENTRY_DSN: "not a dsn" });
    expect(r.env.sentryDsn).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/SENTRY_DSN/);
  });
});
