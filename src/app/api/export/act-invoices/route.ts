import { NextResponse, type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { owedOnInvoice } from "@/lib/act-invoice-rules";
import { currentUser } from "@/lib/auth";
import { isLocked, lockedPath } from "@/lib/billing-lock";
import { csvResponse, toCsv } from "@/lib/csv";
import { getSettings, prisma } from "@/lib/db";
import { fromMinor } from "@/lib/money";
import { localDateKey } from "@/lib/time";

// The acts' unpaid invoices as one CSV, one row per invoice, for a bank's bulk payment upload: payee,
// sort code and account number as digits only, amount in pounds, and the invoice number as the payment
// reference (short enough for Bacs). Banks' upload layouts differ, so the columns may need reordering
// in a spreadsheet first. Admins only: it has whole account numbers.
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user || user.role !== "ADMIN" || !user.agencyId || user.agency?.status !== "ACTIVE") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  if (isLocked(user)) redirect(lockedPath(user));
  const act = req.nextUrl.searchParams.get("act") ?? "";
  const settings = await getSettings(user.agencyId);
  const invoices = await prisma.actInvoice.findMany({
    where: { agencyId: user.agencyId, status: "ISSUED", ...(act ? { artistId: act } : {}) },
    include: { booking: { select: { payments: { select: { direction: true, amountMinor: true } } } } },
    orderBy: [{ actName: "asc" }, { seq: "asc" }],
  });
  const rows = invoices.flatMap((inv) => {
    const owed = owedOnInvoice(inv, inv.booking?.payments ?? []);
    if (owed <= 0) return [];
    return [
      [
        inv.bankAccountName || inv.actName,
        inv.bankSortCode.replace(/\D/g, ""),
        inv.bankAccountNumber.replace(/\D/g, ""),
        fromMinor(owed, inv.currency).toFixed(2),
        inv.number,
        inv.actName,
        localDateKey(inv.gigDate, settings.defaultTimezone),
        inv.currency,
      ],
    ];
  });
  const csv = toCsv(["Payee name", "Sort code", "Account number", "Amount", "Reference", "Act", "Gig date", "Currency"], rows);
  return csvResponse(`act-payments-${localDateKey(new Date(), settings.defaultTimezone)}.csv`, csv);
}
