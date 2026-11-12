import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "./helpers/db";

// The scheduler lock (src/server/scheduler-lock.ts): when two servers start a run at the same
// time, only one runs the jobs. A second Prisma client, with its own connections, stands in for
// the other server. Runs against the test database only (see tests/helpers/db.ts):
//   TEST_DATABASE_URL=postgresql://…/gigsaw_test npx vitest run tests/scheduler-lock-db.test.ts

type Lock = typeof import("@/server/scheduler-lock");

describeDb("scheduler lock (database)", () => {
  let lock: Lock;
  let otherServer: import("@prisma/client").PrismaClient;

  beforeAll(async () => {
    lock = await import("@/server/scheduler-lock");
    const { PrismaClient } = await import("@prisma/client");
    otherServer = new PrismaClient();
  });

  afterAll(async () => {
    await otherServer?.$disconnect();
  });

  /** A job that counts its runs and keeps going until let go, so the two runs truly overlap. */
  function heldJob() {
    let letGo = () => {};
    const gate = new Promise<void>((r) => (letGo = r));
    const job = { runs: 0, letGo: () => letGo(), run: async () => (job.runs++, await gate, "done") };
    return job;
  }

  it("runs the job once when two servers start a run together", async () => {
    const job = heldJob();
    const here = lock.withSchedulerLock(job.run);
    const there = lock.withSchedulerLock(job.run, otherServer);
    // The run holding the lock waits for letGo, so whichever settles first is the one that skipped.
    await expect(Promise.race([here, there])).resolves.toEqual({ ran: false });
    job.letGo();
    const results = await Promise.all([here, there]);
    expect(job.runs).toBe(1);
    expect(results.filter((r) => r.ran)).toEqual([{ ran: true, result: "done" }]);
  });

  it("skips a second run on the same server while the first is still going", async () => {
    const job = heldJob();
    const first = lock.withSchedulerLock(job.run);
    // Let the first take the lock before the second asks.
    while (job.runs === 0) await new Promise((r) => setTimeout(r, 5));
    await expect(lock.withSchedulerLock(job.run)).resolves.toEqual({ ran: false });
    job.letGo();
    await expect(first).resolves.toEqual({ ran: true, result: "done" });
    expect(job.runs).toBe(1);
  });

  it("lets go of the lock when a run ends, even when the job fails", async () => {
    await expect(lock.withSchedulerLock(async () => 1)).resolves.toEqual({ ran: true, result: 1 });
    await expect(lock.withSchedulerLock(async () => 2, otherServer)).resolves.toEqual({ ran: true, result: 2 });
    await expect(lock.withSchedulerLock(() => Promise.reject(new Error("job broke")))).rejects.toThrow("job broke");
    await expect(lock.withSchedulerLock(async () => 3, otherServer)).resolves.toEqual({ ran: true, result: 3 });
  });

  it("runs the scheduler's jobs once across many ticks at once", async () => {
    // Five ticks together, as five servers' timers firing in the same moment.
    let runs = 0;
    const tick = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 300));
    };
    await Promise.all([...Array(5)].map(() => lock.runAsLeader(tick)));
    expect(runs).toBe(1);
  });

  it("answers a cron call that finds the jobs running with a skipped, ok reply", async () => {
    const job = heldJob();
    const scheduler = lock.withSchedulerLock(job.run, otherServer);
    while (job.runs === 0) await new Promise((r) => setTimeout(r, 5));
    let cronRuns = 0;
    const skipped = await lock.runJobsAsLeader({ overdue: async () => cronRuns++ });
    expect(skipped).toEqual({ ok: true, skipped: true, jobs: {} });
    job.letGo();
    await scheduler;
    const ran = await lock.runJobsAsLeader({ overdue: async () => ++cronRuns });
    expect(ran.ok).toBe(true);
    expect(ran.skipped).toBeUndefined();
    expect(ran.jobs.overdue).toMatchObject({ ok: true, result: 1 });
    expect(cronRuns).toBe(1);
  });
});
