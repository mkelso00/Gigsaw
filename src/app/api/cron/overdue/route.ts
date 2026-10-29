import { NextResponse, type NextRequest } from "next/server";
import { runOverdueCheck } from "@/lib/alerts";

// Optional: let an external scheduler run the overdue check. Needs CRON_SECRET to be set,
// passed as "Authorization: Bearer <secret>".
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  return NextResponse.json(await runOverdueCheck());
}
