import "server-only";

// The server's settings, all read here and nowhere else. Every variable is listed, grouped and
// explained in .env.example.
//
// `env()` reads the environment each time it's called (it's cheap), so a value changed while the
// server runs, as tests do, is picked up straight away. `parseEnv()` is the same check on any set
// of values, for tests. `checkEnvAtBoot()` runs once when the server starts (src/instrumentation.ts):
// in production it stops the server with a clear message if something it can't run without is
// missing, and it warns once about providers that are only half set up. Secret values are never
// logged or put in messages, only the names of the variables.

export type RawEnv = Record<string, string | undefined>;

export type LogLevel = "debug" | "info" | "warn" | "error";
export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export type ServerEnv = {
  nodeEnv: "development" | "production" | "test";
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  /** The site's public address for links in emails and texts, with no trailing slash. */
  appUrl: string;
  /** MAIL_FROM as set, like "Gigsaw <bookings@send.gigsaw.live>", and just its address. */
  mailFrom: string;
  mailFromAddress: string | null;
  /** Resend, when both its key and a sending address are set. */
  email: { apiKey: string; from: string } | null;
  /** Twilio, when all three are set. */
  sms: { accountSid: string; authToken: string; from: string } | null;
  /** Keys that sign phone notifications, when both are set (otherwise a pair is kept in the database). */
  vapid: { publicKey: string; privateKey: string } | null;
  oauth: {
    google: { clientId: string; clientSecret: string } | null;
    microsoft: { clientId: string; clientSecret: string } | null;
  };
  /**
   * Key that encrypts connected calendars' tokens (CALENDAR_TOKEN_KEY: 32 random bytes, base64). Calendar
   * connect is offered only when this and the provider's GOOGLE_ or MICROSOFT_ settings are set.
   */
  calendarTokenKey: Buffer | null;
  /** A stand-in sign-in server for testing. Always null in production. */
  oauthTestBase: string | null;
  /** Gigsaw's own Stripe keys from the environment ("" when not set). Keys saved in the Owner area take priority. */
  stripe: { secretKey: string; webhookSecret: string; connectWebhookSecret: string };
  /** Where Stripe's API is. STRIPE_API_BASE (a stand-in for testing) is ignored in production. */
  stripeApiBase: string;
  cronSecret: string | null;
  enquirySecret: string | null;
  disableScheduler: boolean;
  sentryDsn: string | null;
  logLevel: LogLevel;
};

export type EnvCheck = {
  env: ServerEnv;
  /** Things the server can't run without. Fatal in production; reported as warnings otherwise. */
  errors: string[];
  /** Settings that look half done or wrong. */
  warnings: string[];
};

const STRIPE_API = "https://api.stripe.com";

/** Blank and whitespace-only values count as not set. */
function read(raw: RawEnv, name: string) {
  const v = raw[name]?.trim();
  return v ? v : "";
}

/** An address from APP_URL: "https://gigsaw.live/" or a bare "gigsaw.live" (taken as https). Null if it isn't one. */
export function normaliseAppUrl(value: string): string | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!u.hostname || u.search || u.hash || u.username || u.password) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

/** Railway's own domain, like "gigsaw-production.up.railway.app". Null if it isn't a plain host name. */
function railwayUrl(domain: string): string | null {
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(domain)) return null;
  return `https://${domain}`;
}

function isLocal(url: string) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]";
  } catch {
    return false;
  }
}

/** Some of a provider's variables set but not all: name the missing ones. */
function halfSet(raw: RawEnv, what: string, names: string[], warnings: string[]) {
  const set = names.filter((n) => read(raw, n));
  if (set.length && set.length < names.length) {
    const missing = names.filter((n) => !read(raw, n));
    warnings.push(
      `${what} is half set up: ${set.join(", ")} ${set.length === 1 ? "is" : "are"} set but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not, so it's off.`,
    );
  }
  return set.length === names.length;
}

/** Check a set of environment values and work out the server's settings from them. Pure: never logs. */
export function parseEnv(raw: RawEnv): EnvCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rawNodeEnv = read(raw, "NODE_ENV");
  const nodeEnv = rawNodeEnv === "production" || rawNodeEnv === "test" ? rawNodeEnv : "development";
  const isProduction = nodeEnv === "production";

  let port = 3000;
  const rawPort = read(raw, "PORT");
  if (rawPort) {
    const n = Number(rawPort);
    if (Number.isInteger(n) && n > 0 && n < 65536) port = n;
    else warnings.push(`PORT must be a number between 1 and 65535; using ${port}.`);
  }

  const databaseUrl = read(raw, "DATABASE_URL");
  if (!databaseUrl) errors.push("DATABASE_URL is not set. Point it at the Postgres database (on Railway: ${{Postgres.DATABASE_URL}}).");
  else if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) errors.push("DATABASE_URL must be a Postgres connection address starting with postgresql://.");

  // The public address, for links in emails, texts and sign-in redirects.
  const rawAppUrl = read(raw, "APP_URL");
  const rawRailway = read(raw, "RAILWAY_PUBLIC_DOMAIN");
  let appUrl: string | null = null;
  if (rawAppUrl) {
    appUrl = normaliseAppUrl(rawAppUrl);
    if (!appUrl) (isProduction ? errors : warnings).push("APP_URL isn't a web address. Set it like https://gigsaw.live (no path after the domain is needed).");
  }
  if (!appUrl && rawRailway) {
    appUrl = railwayUrl(rawRailway);
    if (!appUrl) warnings.push("RAILWAY_PUBLIC_DOMAIN isn't a plain domain name, so it can't be used for links.");
  }
  if (!appUrl) {
    if (isProduction && !rawAppUrl)
      errors.push(
        "There's no public address for links in emails and texts. Set APP_URL (like https://gigsaw.live), or generate a domain in Railway (Settings, Networking) so RAILWAY_PUBLIC_DOMAIN is set.",
      );
    appUrl = `http://localhost:${port}`;
  } else if (isProduction) {
    if (isLocal(appUrl)) warnings.push(`The public address (${appUrl}) is a local one, so links in emails won't open for anyone else.`);
    else if (appUrl.startsWith("http://")) warnings.push("APP_URL starts with http://. Phones need https:// to share their location for check-ins.");
  }

  // Email (Resend)
  const resendKey = read(raw, "RESEND_API_KEY");
  const mailFrom = read(raw, "MAIL_FROM");
  const mailFromAddress = mailFrom.match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/)?.[0] ?? null;
  if (resendKey && !mailFrom) warnings.push("Email is half set up: RESEND_API_KEY is set but MAIL_FROM is not, so emails stay in the Outbox.");
  if (mailFrom && !mailFromAddress) warnings.push('MAIL_FROM has no email address in it. Set it like "Gigsaw <bookings@send.gigsaw.live>".');
  if (mailFrom && !resendKey && isProduction) warnings.push("MAIL_FROM is set but RESEND_API_KEY is not, so emails stay in the Outbox.");
  const email = resendKey && mailFrom ? { apiKey: resendKey, from: mailFrom } : null;

  // Texts (Twilio)
  const sms = halfSet(raw, "Texting (Twilio)", ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"], warnings)
    ? { accountSid: read(raw, "TWILIO_ACCOUNT_SID"), authToken: read(raw, "TWILIO_AUTH_TOKEN"), from: read(raw, "TWILIO_FROM") }
    : null;

  // Phone notifications
  const vapid = halfSet(raw, "Phone notification keys", ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"], warnings)
    ? { publicKey: read(raw, "VAPID_PUBLIC_KEY"), privateKey: read(raw, "VAPID_PRIVATE_KEY") }
    : null;

  // Sign in with Google or Microsoft
  const google = halfSet(raw, "Sign in with Google", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], warnings)
    ? { clientId: read(raw, "GOOGLE_CLIENT_ID"), clientSecret: read(raw, "GOOGLE_CLIENT_SECRET") }
    : null;
  const microsoft = halfSet(raw, "Sign in with Microsoft", ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"], warnings)
    ? { clientId: read(raw, "MICROSOFT_CLIENT_ID"), clientSecret: read(raw, "MICROSOFT_CLIENT_SECRET") }
    : null;

  // Calendar connect: the same Google and Microsoft apps as sign-in, plus a key for the stored tokens.
  const rawCalendarKey = read(raw, "CALENDAR_TOKEN_KEY");
  let calendarTokenKey: Buffer | null = null;
  if (rawCalendarKey) {
    const k = Buffer.from(rawCalendarKey, "base64");
    if (k.length === 32) calendarTokenKey = k;
    else warnings.push("CALENDAR_TOKEN_KEY must be 32 random bytes in base64 (openssl rand -base64 32), so calendar connect is off.");
  }
  if (calendarTokenKey && !google && !microsoft)
    warnings.push("CALENDAR_TOKEN_KEY is set but neither Google nor Microsoft sign-in is, so there's no calendar to connect.");

  // Stripe. Keys saved in the Owner area take priority, so these are only warnings.
  const stripe = {
    secretKey: read(raw, "STRIPE_SECRET_KEY"),
    webhookSecret: read(raw, "STRIPE_WEBHOOK_SECRET"),
    connectWebhookSecret: read(raw, "STRIPE_CONNECT_WEBHOOK_SECRET"),
  };
  const ownerNote = "unless it's saved in the Owner area (Owner, Stripe)";
  if (stripe.secretKey && !stripe.webhookSecret)
    warnings.push(
      `Stripe is half set up: STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not, so subscription changes from Stripe won't be accepted ${ownerNote}.`,
    );
  if (!stripe.secretKey && (stripe.webhookSecret || stripe.connectWebhookSecret))
    warnings.push(`Stripe is half set up: a webhook secret is set but STRIPE_SECRET_KEY is not, so Stripe is off ${ownerNote}.`);
  if (stripe.secretKey && !/^(sk|rk)_(live|test)_/.test(stripe.secretKey))
    warnings.push("STRIPE_SECRET_KEY doesn't look like a Stripe secret key (sk_live_, sk_test_ or rk_).");
  for (const name of ["STRIPE_WEBHOOK_SECRET", "STRIPE_CONNECT_WEBHOOK_SECRET"])
    if (read(raw, name) && !read(raw, name).startsWith("whsec_")) warnings.push(`${name} doesn't look like a webhook signing secret (they start with whsec_).`);
  if (isProduction && stripe.secretKey.startsWith("sk_test_")) warnings.push("STRIPE_SECRET_KEY is a test key, so no real money will be taken.");

  // Test-only stand-ins: never in production, so a stray setting can't send real traffic elsewhere.
  const rawStripeBase = read(raw, "STRIPE_API_BASE");
  const rawOauthBase = read(raw, "OAUTH_TEST_BASE");
  if (isProduction && rawStripeBase) warnings.push("STRIPE_API_BASE is only for testing and is ignored in production. Remove it.");
  if (isProduction && rawOauthBase) warnings.push("OAUTH_TEST_BASE is only for testing and is ignored in production. Remove it.");
  const stripeApiBase = !isProduction && rawStripeBase ? rawStripeBase.replace(/\/+$/, "") : STRIPE_API;
  const oauthTestBase = !isProduction && rawOauthBase ? rawOauthBase.replace(/\/+$/, "") : null;

  // Scheduler and secrets
  const cronSecret = read(raw, "CRON_SECRET") || null;
  const disableScheduler = read(raw, "DISABLE_SCHEDULER") === "1";
  if (cronSecret && cronSecret.length < 16) warnings.push("CRON_SECRET is short. Use at least 16 random characters.");
  if (disableScheduler && !cronSecret)
    warnings.push("DISABLE_SCHEDULER is on but CRON_SECRET isn't set, so nothing can run the late-arrival checks and reminders.");
  const enquirySecret = read(raw, "ENQUIRY_SECRET") || null;
  if (enquirySecret && enquirySecret.length < 16)
    warnings.push("ENQUIRY_SECRET is short. Use at least 16 random characters, or leave it out and Gigsaw makes one.");

  // Error reporting and logs
  const rawDsn = read(raw, "SENTRY_DSN");
  const sentryDsn = rawDsn && parseSentryDsn(rawDsn) ? rawDsn : null;
  if (rawDsn && !sentryDsn) warnings.push("SENTRY_DSN isn't a Sentry DSN (like https://<key>@o0.ingest.sentry.io/<project>), so errors aren't sent to Sentry.");
  const rawLevel = read(raw, "LOG_LEVEL").toLowerCase();
  const logLevel = (LOG_LEVELS as readonly string[]).includes(rawLevel) ? (rawLevel as LogLevel) : "info";
  if (rawLevel && logLevel !== rawLevel) warnings.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}; using info.`);

  return {
    env: {
      nodeEnv,
      isProduction,
      port,
      databaseUrl,
      appUrl,
      mailFrom,
      mailFromAddress,
      email,
      sms,
      vapid,
      oauth: { google, microsoft },
      calendarTokenKey,
      oauthTestBase,
      stripe,
      stripeApiBase,
      cronSecret,
      enquirySecret,
      disableScheduler,
      sentryDsn,
      logLevel,
    },
    errors,
    warnings,
  };
}

/** The parts of a Sentry DSN needed to send it an event. Null if it isn't one. */
export function parseSentryDsn(dsn: string): { key: string; envelopeUrl: string } | null {
  let u: URL;
  try {
    u = new URL(dsn);
  } catch {
    return null;
  }
  const parts = u.pathname.split("/").filter(Boolean);
  const project = parts.pop();
  if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.username || !project || !/^\d+$/.test(project)) return null;
  const prefix = parts.length ? `/${parts.join("/")}` : "";
  return { key: decodeURIComponent(u.username), envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/` };
}

/** The server's settings, from the environment as it is now. */
export function env(): ServerEnv {
  return parseEnv(process.env).env;
}

/** Thrown at boot in production when a setting the server can't run without is missing. */
export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Gigsaw can't start: ${problems.join(" ")}`);
    this.name = "EnvError";
  }
}

/**
 * Check the settings once at boot. Warnings are logged through `warn`; in production a missing
 * essential throws an EnvError (the caller logs it and stops). Returns the warnings, for tests.
 */
export function checkEnvAtBoot(raw: RawEnv = process.env, warn: (msg: string) => void = () => {}): string[] {
  const { env: e, errors, warnings } = parseEnv(raw);
  if (errors.length && e.isProduction) throw new EnvError(errors);
  const all = [...errors, ...warnings];
  for (const w of all) warn(w);
  return all;
}
