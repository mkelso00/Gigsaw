import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth";
import { isLocked } from "@/lib/billing-lock";
import { globalSearch } from "@/lib/search";

// Live results for the search box at the top of every agency page.
export async function GET(req: NextRequest) {
  // The search box shows on Plan and Profile too, so a business that needs a plan gets no results rather than a redirect.
  const user = await requireStaff({ allowLocked: true });
  const hits = isLocked(user) ? [] : await globalSearch(user.agencyId, req.nextUrl.searchParams.get("q") ?? "", { isOwner: user.isOwner });
  return NextResponse.json({ hits }, { headers: { "Cache-Control": "no-store" } });
}
