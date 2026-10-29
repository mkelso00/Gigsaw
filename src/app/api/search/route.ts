import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth";
import { globalSearch } from "@/lib/search";

// Live results for the search box at the top of every agency page.
export async function GET(req: NextRequest) {
  const user = await requireStaff();
  const hits = await globalSearch(user.agencyId, req.nextUrl.searchParams.get("q") ?? "", { isOwner: user.isOwner });
  return NextResponse.json({ hits }, { headers: { "Cache-Control": "no-store" } });
}
