import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocumentShell } from "@/components/document";
import { requireStaff } from "@/lib/auth";
import { monthLabel } from "@/lib/billing";
import { getSettings, prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { monthlyBill } from "@/lib/monthly-billing-server";
import { formatDate, localTime } from "@/lib/time";

export const metadata: Metadata = { title: "Monthly statement" };

/**
 * A month's bill to print or save as a PDF: every gig on it, grouped by venue (a company billed for all its
 * venues sees each venue's gigs together), with the PO and invoice numbers once they're in. Agency staff only;
 * never shows what the acts are paid.
 */
export default async function BillPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [v, settings] = await Promise.all([monthlyBill(user.agencyId, id), getSettings(user.agencyId)]);
  if (!v) notFound();
  const m = (x: number) => formatMoney(x, v.currency);
  const g = v.group;
  const payerId = g?.payer?.id ?? v.bill.contactId;
  const venueId = g?.venues.length === 1 ? g.venues[0].id : v.bill.venueId;
  const [payer, venue] = await Promise.all([
    payerId ? prisma.contact.findFirst({ where: { id: payerId, agencyId: user.agencyId } }) : null,
    venueId ? prisma.venue.findFirst({ where: { id: venueId, agencyId: user.agencyId } }) : null,
  ]);
  const billName = payer ? payer.company || payer.name : (venue?.name ?? v.name);
  const billAddress = payer?.address || (venue ? [venue.address, venue.city].filter(Boolean).join("\n") : "");
  const byVenue = (g?.venues ?? []).map((x) => {
    const lines = g!.lines.filter((l) => l.gig.venue.id === x.id);
    return { venue: x, lines, exVat: lines.reduce((t, l) => t + l.exVat, 0) };
  });
  const many = byVenue.length > 1;
  const totals = g?.totals ?? { gigs: 0, exVat: 0, vat: 0, total: 0 };

  return (
    <DocumentShell title={v.bill.invoiceNumber ? "Invoice" : "Statement"} reference={v.bill.invoiceNumber || monthLabel(v.month)} settings={settings}>
      <div className="mb-8 grid gap-6 text-sm sm:grid-cols-2">
        <div>
          <div className="font-medium text-slate-500">Bill to</div>
          <div className="font-semibold">{billName}</div>
          {payer?.company && payer.name !== payer.company && <div>{payer.name}</div>}
          <div className="whitespace-pre-line">{billAddress}</div>
          {payer?.email && <div>{payer.email}</div>}
        </div>
        <div className="sm:text-right">
          <div>
            <span className="text-slate-500">Date</span> {formatDate(v.bill.invoicedAt ?? new Date(), settings.defaultTimezone)}
          </div>
          <div>
            <span className="text-slate-500">Period</span> {monthLabel(v.month)}
          </div>
          {!many && byVenue[0] && (
            <div>
              <span className="text-slate-500">Venue</span> {byVenue[0].venue.name}
            </div>
          )}
          {v.bill.poNumber && (
            <div data-testid="print-po">
              <span className="text-slate-500">PO number</span> <strong>{v.bill.poNumber}</strong>
            </div>
          )}
          {v.bill.invoiceNumber && (
            <div data-testid="print-invoice">
              <span className="text-slate-500">Invoice number</span> <strong>{v.bill.invoiceNumber}</strong>
            </div>
          )}
        </div>
      </div>

      {totals.gigs === 0 ? (
        <p className="text-sm text-slate-500">No gigs on this bill.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-slate-300 text-left">
              <th className="py-2">Date</th>
              <th className="py-2">Performance</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          {byVenue.map(({ venue: x, lines, exVat }) => (
            <tbody key={x.id}>
              {many && (
                <tr>
                  <th colSpan={3} className="pt-4 pb-1 text-left font-semibold">
                    {x.name}
                  </th>
                </tr>
              )}
              {lines.map(({ gig, exVat: amount }) => (
                <tr key={gig.id} className="border-b border-slate-100">
                  <td className="py-2.5 whitespace-nowrap">{formatDate(gig.arriveBy, gig.timezone)}</td>
                  <td className="py-2.5">
                    {gig.artist?.name ?? "Live music"}, {localTime(gig.setStart, gig.timezone)}
                    {gig.setEnd ? `–${localTime(gig.setEnd, gig.timezone)}` : ""}
                    <span className="ml-2 text-xs text-slate-500">{gig.reference}</span>
                  </td>
                  <td className="py-2.5 text-right">{m(amount)}</td>
                </tr>
              ))}
              {many && (
                <tr>
                  <td colSpan={2} className="py-2 text-right text-slate-500">
                    {x.name}: {lines.length} booking{lines.length === 1 ? "" : "s"}
                  </td>
                  <td className="py-2 text-right">{m(exVat)}</td>
                </tr>
              )}
            </tbody>
          ))}
          <tbody>
            <tr>
              <td colSpan={2} className="py-2 text-right text-slate-500">
                Subtotal ({totals.gigs} booking{totals.gigs === 1 ? "" : "s"})
              </td>
              <td className="py-2 text-right">{m(totals.exVat)}</td>
            </tr>
            {totals.vat > 0 && (
              <tr>
                <td colSpan={2} className="py-2 text-right text-slate-500">
                  VAT
                </td>
                <td className="py-2 text-right">{m(totals.vat)}</td>
              </tr>
            )}
            <tr className="border-t-2 border-slate-300">
              <td colSpan={2} className="py-3 text-right text-lg font-bold">
                Total
              </td>
              <td className="py-3 text-right text-lg font-bold">{m(totals.total)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {settings.invoiceTerms && <p className="mt-8 text-sm whitespace-pre-line text-slate-600">{settings.invoiceTerms}</p>}
    </DocumentShell>
  );
}
