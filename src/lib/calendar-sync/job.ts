import "server-only";
import { prisma } from "@/lib/db";
import { env } from "@/server/env";
import { resyncConnection } from "./index";

// The scheduler's calendar job (src/lib/scheduler.ts and /api/cron/overdue), run every minute.
// Two gentle catch-ups, a few connections at a time:
//   - retry: a connection whose last sync failed (lastError) gets a full resync, at most every
//     RETRY_AFTER_MS, until it works. Connections waiting for the act to reconnect are left alone.
//   - top-up: every connection is resynced about once a day (lastSyncedAt), which also catches
//     changes made outside the booking hooks (a venue's address, a band's line-up, a lost queue).
// A resync only calls the provider for gigs whose content changed, so a top-up of a calendar
// that's already right costs a few database reads. Each run stops starting new work after
// BUDGET_MS so the time-critical jobs that share the minute (late arrivals) aren't held up.

const RETRY_AFTER_MS = 15 * 60_000;
const TOP_UP_EVERY_MS = 24 * 3_600_000;
const BUDGET_MS = 20_000;
const RETRIES_PER_RUN = 5;
const TOP_UPS_PER_RUN = 3;

let busy = false;

export async function runCalendarSync(opts: { now?: Date; budgetMs?: number } = {}) {
  // Nothing can be connected without the key: skip the queries.
  if (!env().calendarTokenKey || busy) return { retried: 0, toppedUp: 0 };
  busy = true;
  try {
    const now = opts.now ?? new Date();
    const deadline = Date.now() + (opts.budgetMs ?? BUDGET_MS);
    const retry = await prisma.calendarConnection.findMany({
      // updatedAt moves on with every attempt (a failure rewrites lastError), so this spaces the tries out.
      where: { status: "ACTIVE", lastError: { not: "" }, updatedAt: { lt: new Date(now.getTime() - RETRY_AFTER_MS) } },
      orderBy: { updatedAt: "asc" },
      take: RETRIES_PER_RUN,
      select: { id: true },
    });
    const topUp = await prisma.calendarConnection.findMany({
      where: {
        status: "ACTIVE",
        // Failing ones wait for their retry slot above, rather than being tried every minute here.
        lastError: "",
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(now.getTime() - TOP_UP_EVERY_MS) } }],
      },
      orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
      take: TOP_UPS_PER_RUN,
      select: { id: true },
    });
    let retried = 0;
    let toppedUp = 0;
    for (const c of retry) {
      if (Date.now() > deadline) break;
      await resyncConnection(c.id, { deadline });
      retried++;
    }
    for (const c of topUp) {
      if (Date.now() > deadline) break;
      await resyncConnection(c.id, { deadline });
      toppedUp++;
    }
    return { retried, toppedUp };
  } finally {
    busy = false;
  }
}
