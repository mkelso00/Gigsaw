import { NextResponse, type NextRequest } from "next/server";
import { runOverdueCheck } from "@/lib/alerts";
import { runEventMessages } from "@/lib/events";
import { runReminders } from "@/lib/reminders";
import { env } from "@/server/env";
import { withHeartbeat } from "@/server/scheduler-health";

// Optional: let an external scheduler run the overdue check and gig reminders. Needs CRON_SECRET to be set,
// passed as "Authorization: Bearer <secret>". Runs count towards the scheduler heartbeat.
export async function POST(req: NextRequest) {
  const secret = env().cronSecret;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  return NextResponse.json({
    ...(await withHeartbeat("overdue", runOverdueCheck)),
    reminders: await withHeartbeat("reminders", runReminders),
    eventEmails: await withHeartbeat("event-emails", runEventMessages),
  });
}
