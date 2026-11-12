import "server-only";
import { runJobs, type JobRun } from "@/lib/cron";
import { prisma } from "@/lib/db";
import { log } from "./log";

// Railway may run more than one copy of the server, and each starts the built-in scheduler. The
// background jobs (late-arrival alerts, reminders, event emails, and any added later) must not run
// on two of them at once: the messages are claimed before sending, but two runs side by side do all
// the work twice and race each other, and a job that doesn't claim would act twice. So every run
// first takes a Postgres advisory lock with a fixed key; a server that doesn't get it skips quietly.
//
// Why pg_try_advisory_xact_lock inside a transaction, and not pg_try_advisory_lock held on a
// connection for good: Prisma hands out pooled connections and reconnects on its own, so a session
// lock could be taken on one connection and released (or checked) on another, be lost without
// notice when Prisma reconnects, or be left held by a dead connection until Postgres notices,
// stopping every server's jobs. Holding it for good would also need a second client just for the
// lock. A transaction lock lives exactly as long as the run's transaction: Prisma keeps that on one
// connection, Postgres releases it when the run commits, fails or the server dies, and it works
// through a transaction-mode pooler too.
//
// The cost: one pooled connection sits in the open transaction while the jobs run on the others
// (so the pool needs at least two connections, which Prisma's default does), and a run longer than
// RUN_TIMEOUT_MS is reported as failed. Each server still ticks every minute, so with two servers
// the jobs may run twice a minute one after the other; they claim what they send, so a second run
// straight after finds nothing left to do.

/** The fixed lock key: "gigsaw" in ASCII. Any server running the scheduled jobs uses this one. */
export const SCHEDULER_LOCK_KEY = 0x6769_6773_6177n;

/** How long a run may hold the lock. A run normally takes a second or two. */
const RUN_TIMEOUT_MS = 10 * 60_000;

export type LockedRun<T> = { ran: true; result: T } | { ran: false };

/** The part of a Prisma client this needs: the app's own, or in tests a second one standing in for another server. */
type LockDb = {
  $transaction<R>(
    fn: (tx: { $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T> }) => Promise<R>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<R>;
};

/**
 * Run `job` while holding the scheduler lock, unless another run (on this server or another) holds
 * it, in which case nothing runs and `{ ran: false }` comes back. A job's error is passed on after
 * the lock is let go. `db` is for tests that act as a second server.
 */
export async function withSchedulerLock<T>(job: () => Promise<T>, db: LockDb = prisma): Promise<LockedRun<T>> {
  return db.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${SCHEDULER_LOCK_KEY}) AS locked`;
      if (!locked) return { ran: false } as const;
      return { ran: true, result: await job() } as const;
    },
    // Waiting for a free connection is fine; the run itself goes on outside the transaction.
    { maxWait: 10_000, timeout: RUN_TIMEOUT_MS },
  );
}

/**
 * The built-in scheduler's tick: runs the jobs if this server gets the lock, otherwise skips (a
 * debug line only, as it's expected every minute when more than one server is up). Never throws.
 */
export async function runAsLeader(run: () => Promise<void>) {
  try {
    const r = await withSchedulerLock(run);
    if (!r.ran) log.debug("Scheduled jobs skipped: another server is running them");
  } catch (e) {
    log.error("Scheduled jobs couldn't run", { err: e });
  }
}

/** runJobs (src/lib/cron.ts) for /api/cron, under the same lock. A skipped run is ok, with no jobs listed. */
export async function runJobsAsLeader(jobs: Record<string, () => Promise<unknown>>): Promise<JobRun & { skipped?: true }> {
  const r = await withSchedulerLock(() => runJobs(jobs));
  if (r.ran) return r.result;
  log.debug("Cron run skipped: another server is running the jobs");
  return { ok: true, skipped: true, jobs: {} };
}
