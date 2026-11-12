import { log } from "@/server/log";
import { withHeartbeat } from "@/server/scheduler-health";
import { runAsLeader } from "@/server/scheduler-lock";
import { runOverdueCheck } from "./alerts";
import { runCalendarSync } from "./calendar-sync/job";
import { runEventMessages } from "./events";
import { runReminders } from "./reminders";

const EVERY_MS = 60_000;
let started = false;
let running = false;

/**
 * Check for overdue arrivals, due gig reminders and wedding/event emails every minute, and catch up
 * connected calendars. Overlapping
 * runs are skipped. Each job's last success is recorded for the health check (schedulerHealth).
 */
export function startScheduler() {
  if (started) return;
  started = true;
  // With more than one server up, only the one holding the scheduler lock runs the jobs each time (src/server/scheduler-lock.ts).
  const tick = () => runAsLeader(runAll);
  const runAll = async () => {
    if (running) return;
    running = true;
    try {
      const r = await withHeartbeat("overdue", runOverdueCheck);
      if (r.alerted) log.info("Overdue alerts sent", { job: "overdue", bookings: r.alerted });
    } catch (e) {
      log.error("Overdue check failed", { job: "overdue", err: e });
    }
    try {
      const r = await withHeartbeat("reminders", runReminders);
      if (r.weekly || r.daily) log.info("Reminders sent", { job: "reminders", weekly: r.weekly, daily: r.daily });
    } catch (e) {
      log.error("Reminders failed", { job: "reminders", err: e });
    }
    try {
      const n = await withHeartbeat("event-emails", runEventMessages);
      if (n) log.info("Wedding and event emails sent", { job: "event-emails", sent: n });
    } catch (e) {
      log.error("Event emails failed", { job: "event-emails", err: e });
    }
    // Last, and time-boxed inside, so slow calendar providers never delay the jobs above.
    try {
      const r = await withHeartbeat("calendar-sync", runCalendarSync);
      if (r.retried || r.toppedUp) log.info("Connected calendars synced", { job: "calendar-sync", retried: r.retried, toppedUp: r.toppedUp });
    } catch (e) {
      log.error("Calendar sync job failed", { job: "calendar-sync", err: e });
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, EVERY_MS).unref?.();
}
