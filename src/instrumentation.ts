import type { Instrumentation } from "next";

// Runs once when the server starts: checks the settings (src/server/env.ts; in production a
// missing essential stops the server with a clear message), then starts the background checker
// (overdue arrivals and gig reminders). Set DISABLE_SCHEDULER=1 to turn the checker off (for
// example if an external cron calls /api/cron/overdue).
export async function register() {
  // Written as a positive check so the edge build leaves the Node-only parts out.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // `next build` loads this file too; the settings are checked when the server really starts.
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const { bootCheck } = await import("./server/boot");
    bootCheck();
    const { env } = await import("./server/env");
    if (env().disableScheduler) return;
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}

// Every error thrown while handling a request: logged as one JSON line with its digest (the
// "Reference" on the error page), route, method and request id, and sent to Sentry if SENTRY_DSN
// is set.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportRequestError } = await import("./server/report-error");
    await reportRequestError(err, request, context);
  } else {
    // Middleware (edge): no Node modules here, so a plain JSON line.
    const digest = (err as { digest?: string } | null)?.digest;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ level: "error", time: new Date().toISOString(), msg, message: msg, digest, route: context.routePath, method: request.method }),
    );
  }
};
