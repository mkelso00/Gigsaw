import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkHealth } from "@/lib/health";

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
  // TODO(2C scheduler heartbeat): include the scheduler heartbeat here (see HealthReport in lib/health.ts).
  return NextResponse.json(report, { status: report.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
