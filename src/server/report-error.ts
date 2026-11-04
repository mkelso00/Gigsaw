import "server-only";
import { env, parseSentryDsn } from "./env";
import { log } from "./log";

// Errors thrown while handling a request (pages, route handlers, server actions, middleware), as
// passed to onRequestError in src/instrumentation.ts. Each becomes one "error" log line with the
// digest that the error page shows as "Reference: …", so a reference someone reads out can be
// searched for in Railway's logs. With SENTRY_DSN set, it's also sent to Sentry: a single fetch of
// Sentry's envelope format, no SDK.

export type RequestInfo = { path: string; method: string; headers: Record<string, string | string[] | undefined> };
export type RequestContext = { routePath: string; routeType: string; routerKind?: string; renderSource?: string };

function header(h: RequestInfo["headers"], name: string) {
  const v = h[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() || "";
}

/** The request id from the proxy (x-request-id, or Railway's own), or a new one. */
export function requestId(h: RequestInfo["headers"]) {
  const given = header(h, "x-request-id") || header(h, "x-railway-request-id");
  return /^[\w.:-]{1,128}$/.test(given) ? given : crypto.randomUUID();
}

/**
 * The path with no query string and with secret parts hidden: wherever the route has a [token]
 * (offer, contract, payment, calendar feed links and so on), that part becomes "…".
 */
export function safePath(path: string, routePath: string) {
  const parts = path.split(/[?#]/)[0].split("/");
  const route = routePath.split("/");
  return parts.map((p, i) => (/^\[+\.{0,3}token\]+$/.test(route[i] ?? "") ? "…" : p)).join("/");
}

const SSR_REPEAT = "An error occurred in the Server Components render.";

export async function reportRequestError(err: unknown, request: RequestInfo, context: RequestContext) {
  const digest = (err as { digest?: unknown } | null)?.digest;
  const fields = {
    digest: typeof digest === "string" ? digest : undefined,
    route: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    method: request.method,
    path: safePath(request.path, context.routePath),
    requestId: requestId(request.headers),
  };
  const message = err instanceof Error && err.message ? err.message : "Request failed";
  // When a server component fails, Next reports it (with the digest the error page shows), then
  // may report a second, generic error with another digest as the page render picks it up. Keep
  // that one as a warning so each failure is one error line, and don't send it to Sentry.
  if (message.startsWith(SSR_REPEAT)) {
    log.warn("A server component error reached the page render (the error just before has the page's reference)", fields);
    return;
  }
  log.error(message, { ...fields, err });
  await sendToSentry(err, fields);
}

/** Send one error to Sentry if SENTRY_DSN is set. Never throws. */
async function sendToSentry(err: unknown, tags: Record<string, string | undefined>) {
  const e = env();
  const dsn = e.sentryDsn ? parseSentryDsn(e.sentryDsn) : null;
  if (!dsn || !e.sentryDsn) return;
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const ex = err instanceof Error ? err : new Error(String(err));
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: e.nodeEnv,
    server_name: "gigsaw",
    transaction: tags.route,
    exception: { values: [{ type: ex.name, value: ex.message }] },
    tags: Object.fromEntries(Object.entries(tags).filter(([, v]) => v)),
    request: { method: tags.method, url: `${e.appUrl}${tags.path ?? ""}` },
    extra: { stack: ex.stack },
  };
  const body = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: e.sentryDsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
  try {
    const res = await fetch(dsn.envelopeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=gigsaw/1.0`,
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) log.warn("Sentry didn't accept an error report", { status: res.status, digest: tags.digest });
  } catch (x) {
    log.warn("Couldn't reach Sentry to report an error", { digest: tags.digest, reason: x instanceof Error ? x.message : String(x) });
  }
}
