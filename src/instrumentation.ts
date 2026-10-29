// Runs once when the server starts. Starts the overdue-arrival checker in the background.
// Set DISABLE_SCHEDULER=1 to turn it off (for example if an external cron calls /api/cron/overdue).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DISABLE_SCHEDULER === "1") return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
}
