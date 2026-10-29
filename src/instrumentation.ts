// Runs once when the server starts. Starts the background checker (overdue arrivals and gig
// reminders). Set DISABLE_SCHEDULER=1 to turn it off (for example if an external cron calls
// /api/cron/overdue).
export async function register() {
  // Written as a positive check so the edge build leaves the Node-only scheduler out.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.DISABLE_SCHEDULER === "1") return;
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
