import { runOverdueCheck } from "./alerts";
import { runEventMessages } from "./events";
import { runReminders } from "./reminders";

const EVERY_MS = 60_000;
let started = false;
let running = false;

/** Check for overdue arrivals, due gig reminders and wedding/event emails every minute. Overlapping runs are skipped. */
export function startScheduler() {
  if (started) return;
  started = true;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runOverdueCheck();
      if (r.alerted) console.log(`[gigsaw] overdue alerts sent for ${r.alerted} gig(s)`);
    } catch (e) {
      console.error("[gigsaw] overdue check failed", e);
    }
    try {
      const r = await runReminders();
      if (r.weekly || r.daily) console.log(`[gigsaw] reminders sent: ${r.weekly} weekly, ${r.daily} on the day`);
    } catch (e) {
      console.error("[gigsaw] reminders failed", e);
    }
    try {
      const n = await runEventMessages();
      if (n) console.log(`[gigsaw] wedding and event emails sent: ${n}`);
    } catch (e) {
      console.error("[gigsaw] event emails failed", e);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, EVERY_MS).unref?.();
}
