import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { isMonthKey } from "@/lib/billing";
import { csvResponse, toCsv } from "@/lib/csv";
import { prisma } from "@/lib/db";
import { fromMinor } from "@/lib/money";
import { internalUserCounts } from "@/lib/seat-counts";
import { userCharge } from "@/lib/seats";
import { usageForMonth } from "@/lib/usage";

// Owner only: one row per business for a month, with live usage and any issued statement.
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user?.isOwner) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const month = req.nextUrl.searchParams.get("month");
  if (!isMonthKey(month)) return NextResponse.json({ error: "Give a month like 2026-10" }, { status: 400 });

  const [agencies, usage, statements, users] = await Promise.all([
    prisma.agency.findMany({ orderBy: { name: "asc" } }),
    usageForMonth(month),
    prisma.billingStatement.findMany({ where: { month } }),
    internalUserCounts(),
  ]);
  const byAgency = new Map(statements.map((s) => [s.agencyId, s]));
  const money = (minor: number, cur: string) => fromMinor(minor, cur).toFixed(cur === "JPY" ? 0 : 2);
  const rows = agencies
    .map((a) => {
      const u = usage.get(a.id);
      const s = byAgency.get(a.id);
      const seats = userCharge(a, users.get(a.id) ?? 0);
      if (!u && !s && !seats.monthlyMinor) return null;
      return [
        a.name,
        a.billingEmail,
        month,
        a.billingCurrency,
        money(a.pricePerGigMinor, a.billingCurrency),
        u?.count ?? 0,
        seats.users,
        seats.extra,
        money(seats.monthlyMinor, a.billingCurrency),
        money((u?.count ?? 0) * a.pricePerGigMinor + seats.monthlyMinor, a.billingCurrency),
        s ? (s.status === "PAID" ? "Paid" : "Unpaid") : "Not issued",
        s?.gigCount ?? "",
        s ? money(s.amountMinor, s.currency) : "",
        s?.references ?? u?.references.join(", ") ?? "",
      ];
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const csv = toCsv(
    [
      "Business",
      "Billing email",
      "Month",
      "Currency",
      "Price per booking",
      "Bookings now",
      "Internal users",
      "Extra users",
      "Extra users charge",
      "Amount now",
      "Statement",
      "Statement bookings",
      "Statement amount",
      "Booking references",
    ],
    rows,
  );
  return csvResponse(`gigsaw-billing-${month}.csv`, csv);
}
