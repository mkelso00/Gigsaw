import { runOverdueCheck } from "./alerts";

const EVERY_MS = 60_000;
let started = false;
let running = false;

/** Check for overdue arrivals every minute. Overlapping runs are skipped. */
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
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, EVERY_MS).unref?.();
}
