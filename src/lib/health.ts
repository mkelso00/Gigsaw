// The health check behind /api/health. Pure (the database ping is passed in), so it's unit tested in
// tests/health.test.ts without a database.

export type HealthReport = {
  status: "ok" | "error";
  db: "ok" | "down" | "timeout";
  time: string;
  version: string | null;
  // TODO(2C scheduler heartbeat): add `scheduler: { lastTickAt, ok }` here once the heartbeat helper
  // lands. Report it, but don't fail the check on it: a stale scheduler shouldn't make Railway restart
  // or refuse a deploy (and it's switched off on purpose with DISABLE_SCHEDULER=1).
};

/** Resolve `"timeout"` if the promise hasn't settled within `ms`. The timer never keeps the process alive. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Ping the database (allowing `timeoutMs`) and build the report. Healthy means the database answered in
 * time. The error itself is passed to `log` and never put in the report, which is public.
 */
export async function checkHealth(opts: {
  ping: () => Promise<unknown>;
  timeoutMs?: number;
  version?: string | null;
  now?: () => Date;
  log?: (message: string, error: unknown) => void;
}): Promise<HealthReport> {
  const { ping, timeoutMs = 2000, version = null, now = () => new Date(), log = (m, e) => console.error(m, e) } = opts;
  let db: HealthReport["db"];
  try {
    db = (await withTimeout(ping(), timeoutMs)) === "timeout" ? "timeout" : "ok";
    if (db === "timeout") log(`[gigsaw] health check: database did not answer within ${timeoutMs}ms`, null);
  } catch (e) {
    db = "down";
    log("[gigsaw] health check: database ping failed", e instanceof Error ? e.message : e);
  }
  return { status: db === "ok" ? "ok" : "error", db, time: now().toISOString(), version: version || null };
}
