import { createHash, timingSafeEqual } from "node:crypto";

// Helpers for /api/cron routes: a constant-time secret check and a runner that keeps one failing job
// from stopping the others. Pure (no database), so they're unit tested in tests/cron.test.ts.

/**
 * True when the Authorization header is exactly `Bearer <secret>`. Both sides are hashed first so the
 * compare always runs on two equal-length buffers: it takes the same time whatever the header holds and
 * doesn't give away the secret's length. An unset or empty secret never matches.
 */
export function cronSecretMatches(authorization: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret) return false;
  const given = createHash("sha256")
    .update(authorization ?? "")
    .digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(given, expected);
}

export type JobResult = { ok: true; ms: number; result: unknown } | { ok: false; ms: number; error: string };

export type JobRun = { ok: boolean; jobs: Record<string, JobResult> };

/**
 * Run each job in turn, each in its own try/catch, and report how every one went. Jobs run one after
 * another (not all at once) so they don't compete for database connections, as in the built-in scheduler.
 */
export async function runJobs(
  jobs: Record<string, () => Promise<unknown>>,
  log: (message: string, error: unknown) => void = (m, e) => console.error(m, e),
  clock: () => number = Date.now,
): Promise<JobRun> {
  const results: Record<string, JobResult> = {};
  for (const [name, job] of Object.entries(jobs)) {
    const started = clock();
    try {
      const result = await job();
      results[name] = { ok: true, ms: clock() - started, result };
    } catch (e) {
      log(`[gigsaw] cron job "${name}" failed`, e);
      results[name] = { ok: false, ms: clock() - started, error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300) };
    }
  }
  return { ok: Object.values(results).every((r) => r.ok), jobs: results };
}
