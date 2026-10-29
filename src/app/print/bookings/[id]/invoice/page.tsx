import type { Metadata } from "next";
import { DocumentShell } from "@/components/document";
import { dealBreakdown, formatMoney, paymentTotals } from "@/lib/money";
import { loadPrintable } from "@/lib/print";
import { formatDate } from "@/lib/time";
import { actName } from "@/lib/constants";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { booking: b, settings } = await loadPrintable(id);
  const d = dealBreakdown(b);
  const paid = paymentTotals(b.payments).receivedMinor;
  const money = (m: number) => formatMoney(m, b.currency);

  return (
    <DocumentShell title="Invoice" reference={`INV-${b.reference}`} settings={settings}>
      <div className="mb-8 grid grid-cols-2 gap-6 text-sm">
        <div>
          <div className="font-medium text-slate-500">Bill to</div>
          <div className="font-semibold">{b.promoter?.company || b.promoter?.name || "Promoter"}</div>
          {b.promoter?.company && <div>{b.promoter.name}</div>}
          <div className="whitespace-pre-line">{b.promoter?.address}</div>
          <div>{b.promoter?.email}</div>
        </div>
        <div className="text-right">
          <div>
            <span className="text-slate-500">Invoice date</span> {formatDate(new Date(), settings.defaultTimezone)}
          </div>
          <div>
            <span className="text-slate-500">Booking</span> {b.reference}
          </div>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-slate-300 text-left">
            <th className="py-2">Description</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-100">
            <td className="py-3">
              Performance by {actName(b)}
              {b.venue ? ` at ${b.venue.name}${b.venue.city ? `, ${b.venue.city}` : ""}` : ""} on {formatDate(b.arriveBy, b.timezone)}
              {b.eventName ? ` (${b.eventName})` : ""}
            </td>
            <td className="py-3 text-right">{money(d.grossMinor)}</td>
          </tr>
          {d.vatMinor > 0 && (
            <tr className="border-b border-slate-100">
              <td className="py-2 text-right text-slate-500">VAT at {b.vatPct}%</td>
              <td className="py-2 text-right">{money(d.vatMinor)}</td>
            </tr>
          )}
          <tr>
            <td className="py-2 text-right font-semibold">Total</td>
            <td className="py-2 text-right font-semibold">{money(d.totalDueMinor)}</td>
          </tr>
          {paid > 0 && (
            <tr>
              <td className="py-1 text-right text-slate-500">Paid so far</td>
              <td className="py-1 text-right">−{money(paid)}</td>
            </tr>
          )}
          <tr className="border-t-2 border-slate-300">
            <td className="py-3 text-right text-lg font-bold">Balance due</td>
            <td className="py-3 text-right text-lg font-bold">{money(Math.max(0, d.totalDueMinor - paid))}</td>
          </tr>
        </tbody>
      </table>
      {settings.invoiceTerms && <p className="mt-8 text-sm whitespace-pre-line text-slate-600">{settings.invoiceTerms}</p>}
    </DocumentShell>
  );
}
