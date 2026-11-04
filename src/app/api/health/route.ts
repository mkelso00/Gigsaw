import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkHealth } from "@/lib/health";
import { schedulerHealth } from "@/server/scheduler-health";

// Health check for Railway (railway.json → deploy.healthcheckPath) and uptime monitors. Public, no secrets:
// 200 when the database answers `SELECT 1` within 2 seconds, 503 when it doesn't.
// Kept cheap: one trivial query, nothing cached, no session lookup (middleware lets /api/health through).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const report = await checkHealth({
    ping: () => prisma.$queryRaw`SELECT 1`,
    timeoutMs: 2000,
    version: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
  });
  // The scheduler heartbeat is reported but never fails the check: a late job shouldn't make Railway
  // restart the app or refuse a deploy. Uptime monitors can alert on scheduler.ok instead.
  const scheduler = report.db === "ok" ? await schedulerHealth().catch(() => null) : null;
  return NextResponse.json({ ...report, scheduler }, { status: report.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
