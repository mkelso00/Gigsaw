import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocumentShell } from "@/components/document";
import { requireStaff } from "@/lib/auth";
import { actName } from "@/lib/constants";
import { getSettings } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { isDateKey } from "@/lib/rota";
import { formatDate, localTime } from "@/lib/time";
import { venueStatement } from "@/lib/venue-statement";

export const metadata: Metadata = { title: "Venue invoice" };

const valid = (s?: string) => (isDateKey(s) ? s : undefined);

/** One invoice for a venue covering every gig in the dates. Agency staff only; never shows what the acts are paid. */
export default async function VenueInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; customers?: string }>;
}) {
  const user = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const from = valid(sp.from);
  const to = valid(sp.to);
  if (!from || !to) notFound();
  const [s, settings] = await Promise.all([venueStatement(user.agencyId, id, from, to, sp.customers === "on", true), getSettings(user.agencyId)]);
  if (!s) notFound();
  const m = (x: number) => formatMoney(x, s.currency);
  const period = `${formatDate(new Date(`${from}T12:00:00Z`), "UTC")} to ${formatDate(new Date(`${to}T12:00:00Z`), "UTC")}`;
  const billName = s.billTo ? s.billTo.company || s.billTo.name : s.venue.name;
  const billAddress = s.billTo?.address || [s.venue.address, s.venue.city].filter(Boolean).join("\n");

  return (
    <DocumentShell
      title="Invoice"
      reference={`INV-${s.venue.name
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, 6)
        .toUpperCase()}-${from.slice(0, 7).replace("-", "")}`}
      settings={settings}
    >
      <div className="mb-8 grid grid-cols-2 gap-6 text-sm">
        <div>
          <div className="font-medium text-slate-500">Bill to</div>
          <div className="font-semibold">{billName}</div>
          {s.billTo?.company && <div>{s.billTo.name}</div>}
          <div className="whitespace-pre-line">{billAddress}</div>
          <div>{s.billTo?.email}</div>
        </div>
        <div className="text-right">
          <div>
            <span className="text-slate-500">Invoice date</span> {formatDate(new Date(), settings.defaultTimezone)}
          </div>
          <div>
            <span className="text-slate-500">Venue</span> {s.venue.name}
          </div>
          <div>
            <span className="text-slate-500">Period</span> {period}
          </div>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-slate-300 text-left">
            <th className="py-2">Date</th>
            <th className="py-2">Performance</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map(({ b, sale }) => (
            <tr key={b.id} className="border-b border-slate-100">
              <td className="py-2.5 whitespace-nowrap">{formatDate(b.arriveBy, b.timezone)}</td>
              <td className="py-2.5">
                {actName(b)}, {localTime(b.setStart, b.timezone)}
                {b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}
                <span className="ml-2 text-xs text-slate-500">{b.reference}</span>
              </td>
              <td className="py-2.5 text-right">{m(sale)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2} className="py-2 text-right text-slate-500">
              Subtotal ({s.totals.gigs} gig{s.totals.gigs === 1 ? "" : "s"})
            </td>
            <td className="py-2 text-right">{m(s.totals.sale)}</td>
          </tr>
          {s.totals.vat > 0 && (
            <tr>
              <td colSpan={2} className="py-2 text-right text-slate-500">
                VAT
              </td>
              <td className="py-2 text-right">{m(s.totals.vat)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={2} className="py-2 text-right font-semibold">
              Total
            </td>
            <td className="py-2 text-right font-semibold">{m(s.totals.due)}</td>
          </tr>
          {s.totals.received > 0 && (
            <tr>
              <td colSpan={2} className="py-1 text-right text-slate-500">
                Paid so far
              </td>
              <td className="py-1 text-right">−{m(s.totals.received)}</td>
            </tr>
          )}
          <tr className="border-t-2 border-slate-300">
            <td colSpan={2} className="py-3 text-right text-lg font-bold">
              Balance due
            </td>
            <td className="py-3 text-right text-lg font-bold">{m(s.totals.owed)}</td>
          </tr>
        </tbody>
      </table>
      {settings.invoiceTerms && <p className="mt-8 text-sm whitespace-pre-line text-slate-600">{settings.invoiceTerms}</p>}
    </DocumentShell>
  );
}
