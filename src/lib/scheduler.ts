import { log } from "@/server/log";
import { withHeartbeat } from "@/server/scheduler-health";
import { runOverdueCheck } from "./alerts";
import { runEventMessages } from "./events";
import { runReminders } from "./reminders";

const EVERY_MS = 60_000;
let started = false;
let running = false;

/**
 * Check for overdue arrivals, due gig reminders and wedding/event emails every minute. Overlapping
 * runs are skipped. Each job's last success is recorded for the health check (schedulerHealth).
 */
export function startScheduler() {
  if (started) return;
  started = true;
  const tick = async () => {
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
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, EVERY_MS).unref?.();
}
