import { NextResponse, type NextRequest } from "next/server";
import { runOverdueCheck } from "@/lib/alerts";
import { runCalendarSync } from "@/lib/calendar-sync/job";
import { cronSecretMatches } from "@/lib/cron";
import { runEventMessages } from "@/lib/events";
import { runReminders } from "@/lib/reminders";
import { env } from "@/server/env";
import { withHeartbeat } from "@/server/scheduler-health";
import { runJobsAsLeader } from "@/server/scheduler-lock";

// Optional: let an external scheduler run the overdue check, booking reminders, wedding/event emails and
// the connected-calendar catch-up (set DISABLE_SCHEDULER=1 to turn the built-in one off). Needs
// CRON_SECRET to be set, passed as "Authorization: Bearer <secret>". Runs count towards the scheduler heartbeat.
//
// Each job runs on its own, so one failing doesn't stop the rest. The reply lists every job:
//   { ok, jobs: { overdue: { ok, ms, result }, reminders: { ok, ms, result }, eventEmails: { ok, ms, error }, calendarSync: { ok, ms, result } } }
// with status 200 when all of them worked and 500 when any failed (so the scheduler can alert on it).
// They share the built-in scheduler's lock (src/server/scheduler-lock.ts): if a server is running
// them right now, nothing runs and the reply is { ok: true, skipped: true, jobs: {} }.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!cronSecretMatches(req.headers.get("authorization"), env().cronSecret)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const run = await runJobsAsLeader({
    overdue: () => withHeartbeat("overdue", runOverdueCheck),
    reminders: () => withHeartbeat("reminders", runReminders),
    eventEmails: () => withHeartbeat("event-emails", runEventMessages),
    calendarSync: () => withHeartbeat("calendar-sync", runCalendarSync),
  });
  return NextResponse.json(run, { status: run.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
