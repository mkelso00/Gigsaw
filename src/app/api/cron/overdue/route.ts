import { NextResponse, type NextRequest } from "next/server";
import { runOverdueCheck } from "@/lib/alerts";
import { cronSecretMatches, runJobs } from "@/lib/cron";
import { runEventMessages } from "@/lib/events";
import { runReminders } from "@/lib/reminders";

// Optional: let an external scheduler run the overdue check, gig reminders and wedding/event emails
// (set DISABLE_SCHEDULER=1 to turn the built-in one off). Needs CRON_SECRET to be set, passed as
// "Authorization: Bearer <secret>".
//
// Each job runs on its own, so one failing doesn't stop the rest. The reply lists every job:
//   { ok, jobs: { overdue: { ok, ms, result }, reminders: { ok, ms, result }, eventEmails: { ok, ms, error } } }
// with status 200 when all of them worked and 500 when any failed (so the scheduler can alert on it).
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!cronSecretMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const run = await runJobs({
    overdue: () => runOverdueCheck(),
    reminders: () => runReminders(),
    eventEmails: () => runEventMessages(),
  });
  return NextResponse.json(run, { status: run.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
