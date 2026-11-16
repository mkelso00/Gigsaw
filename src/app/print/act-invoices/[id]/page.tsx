import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Invoice } from "@/components/invoice";
import { formatSortCode, maskAccount } from "@/lib/act-invoice-rules";
import { invoiceForViewer } from "@/lib/act-invoices";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Self-billing invoice" };

// A self-billing invoice: the agency makes it out on the payee's behalf (a band's lead, the one person in
// a solo act, or the act), so it's headed with their name and address (they're the supplier) and the
// agency is the customer. Staff and the login it's made out to can open it (invoiceForViewer: never the
// rest of a band). Only admins see the whole bank account number.
export default async function ActInvoicePrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [inv, settings] = await Promise.all([invoiceForViewer(user, id), getSettings(user.agencyId)]);
  if (!inv) notFound();
  const tz = settings.defaultTimezone;
  const hasVat = inv.vatMinor > 0;
  const account = user.role === "ADMIN" ? inv.bankAccountNumber : maskAccount(inv.bankAccountNumber);
  // Made out to the payee (a band's lead, the one person in a solo act, or the act itself): they're the supplier.
  const payee = inv.payeeName || inv.actName;
  const bank = [inv.bankAccountName, inv.bankSortCode && `Sort code ${formatSortCode(inv.bankSortCode)}`, account && `Account ${account}`].filter(Boolean);

  return (
    <Invoice
      title="Self-billing invoice"
      letterhead={{ agencyName: payee, agencyAddress: inv.actAddress, agencyEmail: inv.actVatNumber ? `VAT number ${inv.actVatNumber}` : "" }}
      billToLabel="Customer"
      date={inv.issuedAt}
      reference={inv.number}
      settings={settings}
      currency={inv.currency}
      timeZone={tz}
      billTo={
        <>
          <div className="font-semibold">{settings.agencyName}</div>
          <div className="whitespace-pre-line">{settings.agencyAddress}</div>
        </>
      }
      details={
        <>
          <div>
            <span className="text-slate-500">Date of performance</span> {formatDate(inv.gigDate, tz)}
          </div>
          <div>
            <span className="text-slate-500">Booking</span> {inv.bookingRef}
          </div>
          {payee !== inv.actName && (
            <div>
              <span className="text-slate-500">Act</span> {inv.actName}
            </div>
          )}
        </>
      }
      lines={[{ key: inv.id, description: inv.description, amountMinor: inv.netMinor }]}
      subtotalMinor={hasVat ? inv.netMinor : undefined}
      vat={{ label: <>VAT at {inv.vatPct}%</>, amountMinor: inv.vatMinor }}
      totalMinor={inv.totalMinor}
      notes={
        <div className="mt-8 space-y-4 text-sm text-slate-600">
          {inv.status === "VOID" && (
            <p className="rounded-lg border-2 border-rose-300 bg-rose-50 px-4 py-3 font-semibold text-rose-800">
              Void{inv.voidedAt ? ` since ${formatDate(inv.voidedAt, tz)}` : ""}. Nothing is owed on this invoice.{inv.note ? ` ${inv.note}.` : ""}
            </p>
          )}
          {inv.status === "PAID" && inv.paidAt && <p className="font-semibold text-emerald-700">Paid {formatDate(inv.paidAt, tz)}.</p>}
          {inv.status !== "VOID" && inv.note && <p>{inv.note}.</p>}
          {bank.length > 0 && (
            <div>
              <div className="font-medium text-slate-500">Paid to</div>
              {bank.map((line) => (
                <div key={line} className="text-slate-800 tabular-nums">
                  {line}
                </div>
              ))}
            </div>
          )}
          <p>
            Self-billing invoice, made out by {settings.agencyName} on behalf of {payee}.
            {hasVat ? " The VAT shown is your output tax due to HMRC." : ` No VAT is charged: ${payee} isn't registered for VAT.`}
          </p>
        </div>
      }
    />
  );
}
