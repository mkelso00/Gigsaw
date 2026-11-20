import { NextResponse, type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { SAMPLE_PAYMENTS, bankFile, readBankFile, templateOf } from "@/lib/bank-file";
import { isLocked, lockedPath } from "@/lib/billing-lock";
import { csvResponse, toCsv } from "@/lib/csv";
import { getSettings } from "@/lib/db";
import { RECORDS_HEADER, lastWeekStart, readWeek, recordsRows } from "@/lib/pay-run";
import { invoicesPdf } from "@/lib/pay-run-pdf";
import { payRunWeek } from "@/lib/pay-run-server";
import { localDateKey } from "@/lib/time";

// The weekly pay run's files, for one week (?week=YYYY-MM-DD, any day in it; last week when left out):
//  - the payment list (the default): one row per payee still to pay, laid out for the business's bank (Settings
//    .bankFile: a preset or their own layout, src/lib/bank-file.ts). Payees with a bad sort code or account number
//    are left out (the page lists them to fix). No byte-order mark, as some bank uploads refuse one.
//  - file=sample: the same layout with two made-up payments, to try in the bank first.
//  - file=records: the week's invoices as a spreadsheet, one row per invoice (no bank details).
//  - file=invoices: every invoice in the week in one PDF.
// Admins only: the payment list has whole account numbers.
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user || user.role !== "ADMIN" || !user.agencyId || user.agency?.status !== "ACTIVE") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  if (isLocked(user)) redirect(lockedPath(user));
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const file = req.nextUrl.searchParams.get("file") ?? "payments";
  const template = templateOf(readBankFile(settings.bankFile));
  const plain = (name: string, text: string) =>
    new Response(text, {
      headers: { "Cache-Control": "no-store", "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
    });
  if (file === "sample") return plain(`payments-sample.${template.extension}`, bankFile(template, SAMPLE_PAYMENTS, localDateKey(new Date(), tz)).text);

  const week = readWeek(req.nextUrl.searchParams.get("week")) ?? lastWeekStart(new Date(), tz);
  const v = await payRunWeek(user.agencyId, week, { timeZone: tz, business: settings.agencyName, bankFile: settings.bankFile });
  if (file === "records") return csvResponse(`act-invoices-w-c-${week}.csv`, toCsv(RECORDS_HEADER, recordsRows(v.invoices, tz)));
  if (file === "invoices") {
    const pdf = await invoicesPdf(v.invoices, { agencyName: settings.agencyName, agencyAddress: settings.agencyAddress, defaultTimezone: tz });
    return new Response(Buffer.from(pdf), {
      headers: { "Cache-Control": "no-store", "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="act-invoices-w-c-${week}.pdf"` },
    });
  }
  return plain(`payments-w-c-${week}.${template.extension}`, v.bank.text);
}
