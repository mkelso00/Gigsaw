import "server-only";
import { after } from "next/server";
import { log } from "@/server/log";
import { syncBookingToCalendars } from "./index";

// How the rest of the app asks for a booking's calendars to be brought up to date: call
// queueCalendarSync(ids) straight after the database write has committed (after a transaction
// returns, never inside one). It returns at once.
//
// Why not await the sync: Google and Microsoft can take seconds, or time out, and a booking save
// must never wait for them or fail because of them. The ids go into one queue in this process,
// worked through one at a time, so a bulk edit of 500 gigs doesn't fire 500 syncs at once, and
// the same gig saved twice in quick succession is synced once. The worker is started with Next's
// after() inside a request or server action, so it starts once the response has gone; outside a
// request (the scheduler, webhooks, tests) after() isn't available and the worker just starts.
// This relies on Gigsaw running as one long-lived Node server (`next start`, where the built-in
// scheduler also lives), not on serverless functions that freeze after replying. Anything lost to
// a restart is put right by the scheduler's daily top-up (job.ts).

const pending = new Set<string>();
let working = false;

async function work() {
  if (working) return;
  working = true;
  try {
    while (pending.size) {
      const [id] = pending;
      pending.delete(id);
      // Never throws, but be certain one bad gig can't stop the queue.
      await syncBookingToCalendars(id).catch((e) => log.error("Calendar sync failed", { bookingId: id, err: e }));
    }
  } finally {
    working = false;
  }
}

/** Bring these bookings' connected calendars in line, soon, without waiting. Safe to call with ids of deleted bookings. */
export function queueCalendarSync(ids: string | readonly (string | null | undefined)[]) {
  for (const id of typeof ids === "string" ? [ids] : ids) if (id) pending.add(id);
  if (!pending.size || working) return;
  const start = () => work().catch((e) => log.error("Calendar sync queue failed", { err: e }));
  try {
    after(start);
  } catch {
    void start();
  }
}

/** For tests: wait until the queue is empty. */
export async function calendarQueueIdle() {
  while (working || pending.size) {
    if (!working && pending.size) await work();
    else await new Promise((r) => setTimeout(r, 5));
  }
}
