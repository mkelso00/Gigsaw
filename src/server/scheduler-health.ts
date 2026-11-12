import "server-only";
import { prisma } from "@/lib/db";
import { env } from "./env";
import { log } from "./log";

// A heartbeat for the background jobs: each run records when it last worked (and when it last
// failed, and why), so a health check can tell when late-arrival alerts or reminders have quietly
// stopped. Runs from the built-in scheduler and from /api/cron/overdue both count.

const SCHEDULER_JOBS = ["overdue", "reminders", "event-emails", "calendar-sync"] as const;
export type SchedulerJob = (typeof SCHEDULER_JOBS)[number];

/** The scheduler runs every minute; a job with no success for this long is treated as stuck. */
const DEFAULT_MAX_AGE_MS = 5 * 60_000;

/** Note a job's run. Never throws: a heartbeat that can't be saved mustn't stop the job itself. */
export async function recordRun(job: SchedulerJob, outcome: { ok: true } | { ok: false; error: unknown }, now = new Date()) {
  const data = outcome.ok
    ? { lastSuccessAt: now }
    : { lastFailureAt: now, lastError: (outcome.error instanceof Error ? outcome.error.message : String(outcome.error)).slice(0, 500) };
  try {
    await prisma.schedulerHeartbeat.upsert({ where: { job }, create: { job, ...data }, update: data });
  } catch (e) {
    log.warn("Couldn't save the scheduler heartbeat", { job, err: e });
  }
}

/** Run a job and record how it went. Rethrows the job's error after recording it. */
export async function withHeartbeat<T>(job: SchedulerJob, run: () => Promise<T>): Promise<T> {
  try {
    const result = await run();
    await recordRun(job, { ok: true });
    return result;
  } catch (e) {
    await recordRun(job, { ok: false, error: e });
    throw e;
  }
}

export type JobHealth = {
  job: SchedulerJob;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string;
  /** Milliseconds since the last success, or null if it has never worked. */
  ageMs: number | null;
  ok: boolean;
};

export type SchedulerHealth = {
  /** Every job has worked within `maxAgeMs`. */
  ok: boolean;
  /** DISABLE_SCHEDULER is on: the jobs only run when an outside scheduler calls /api/cron/overdue. */
  builtInSchedulerOff: boolean;
  maxAgeMs: number;
  jobs: JobHealth[];
};

/**
 * How the background jobs are doing, for a health check. A job is ok if it last worked within
 * `maxAgeMs` (five minutes by default; pass more if an outside scheduler calls less often). Just
 * after the first start on a new database the jobs haven't run yet (the first run is 15 seconds
 * after boot), so they show as not ok until then.
 */
export async function schedulerHealth(opts: { maxAgeMs?: number; now?: Date } = {}): Promise<SchedulerHealth> {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = (opts.now ?? new Date()).getTime();
  const rows = await prisma.schedulerHeartbeat.findMany({ where: { job: { in: [...SCHEDULER_JOBS] } } });
  const byJob = new Map(rows.map((r) => [r.job, r]));
  const jobs = SCHEDULER_JOBS.map((job): JobHealth => {
    const r = byJob.get(job);
    const ageMs = r?.lastSuccessAt ? Math.max(0, now - r.lastSuccessAt.getTime()) : null;
    return {
      job,
      lastSuccessAt: r?.lastSuccessAt ?? null,
      lastFailureAt: r?.lastFailureAt ?? null,
      lastError: r?.lastError ?? "",
      ageMs,
      ok: ageMs !== null && ageMs <= maxAgeMs,
    };
  });
  return { ok: jobs.every((j) => j.ok), builtInSchedulerOff: env().disableScheduler, maxAgeMs, jobs };
}
