import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocumentShell } from "@/components/document";
import { requireStaff } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { eventTotals } from "@/lib/events";
import { dealBreakdown, formatMoney } from "@/lib/money";
import { formatDate, localTime } from "@/lib/time";
import { actName } from "@/lib/constants";

export const metadata: Metadata = { title: "Invoice" };

/** One invoice for the customer covering every act at their wedding or event. Agency staff only. */
export default async function EventInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [e, settings] = await Promise.all([
    prisma.event.findFirst({
      where: { id, agencyId: user.agencyId },
      include: {
        customer: true,
        venue: true,
        bookings: { where: { status: { not: "CANCELLED" } }, include: { artist: { select: { name: true } }, payments: true }, orderBy: { setStart: "asc" } },
      },
    }),
    getSettings(user.agencyId),
  ]);
  if (!e) notFound();
  const t = eventTotals(e.bookings);
  const money = (m: number) => formatMoney(m, t.currency);
  const day = formatDate(new Date(`${e.date}T12:00:00Z`), "UTC");
  const ref = e.bookings[0]?.reference ?? e.id.slice(-6).toUpperCase();

  return (
    <DocumentShell title="Invoice" reference={`INV-${ref}`} settings={settings}>
      <div className="mb-8 grid grid-cols-2 gap-6 text-sm">
        <div>
          <div className="font-medium text-slate-500">Bill to</div>
          <div className="font-semibold">
            {e.customer?.company && e.customer.company !== "Private client" ? e.customer.company : e.customer?.name || "Customer"}
          </div>
          <div className="whitespace-pre-line">{e.customer?.address}</div>
          <div>{e.customer?.email}</div>
        </div>
        <div className="text-right">
          <div>
            <span className="text-slate-500">Invoice date</span> {formatDate(new Date(), settings.defaultTimezone)}
          </div>
          <div>
            <span className="text-slate-500">Event</span> {e.name}, {day}
          </div>
          {(e.venue || e.venueText) && (
            <div className="text-slate-500">{e.venue ? `${e.venue.name}${e.venue.city ? `, ${e.venue.city}` : ""}` : e.venueText}</div>
          )}
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
          {e.bookings.map((b) => (
            <tr key={b.id} className="border-b border-slate-100">
              <td className="py-3">
                {actName(b)}, {localTime(b.setStart, b.timezone)}
                {b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}
                <span className="block text-xs text-slate-500">{b.reference}</span>
              </td>
              <td className="py-3 text-right">{money(dealBreakdown(b).grossMinor)}</td>
            </tr>
          ))}
          {t.fees > 0 && (
            <tr className="border-b border-slate-100">
              <td className="py-3">Booking fee</td>
              <td className="py-3 text-right">{money(t.fees)}</td>
            </tr>
          )}
          <tr>
            <td className="py-2 text-right text-slate-500">Subtotal</td>
            <td className="py-2 text-right">{money(t.sale + t.fees)}</td>
          </tr>
          {t.vat > 0 && (
            <tr>
              <td className="py-2 text-right text-slate-500">VAT</td>
              <td className="py-2 text-right">{money(t.vat)}</td>
            </tr>
          )}
          <tr>
            <td className="py-2 text-right font-semibold">Total</td>
            <td className="py-2 text-right font-semibold">{money(t.total)}</td>
          </tr>
          {t.received > 0 && (
            <tr>
              <td className="py-1 text-right text-slate-500">Paid so far</td>
              <td className="py-1 text-right">−{money(t.received)}</td>
            </tr>
          )}
          <tr className="border-t-2 border-slate-300">
            <td className="py-3 text-right text-lg font-bold">Balance due</td>
            <td className="py-3 text-right text-lg font-bold">{money(t.outstanding)}</td>
          </tr>
        </tbody>
      </table>
      {settings.invoiceTerms && <p className="mt-8 text-sm whitespace-pre-line text-slate-600">{settings.invoiceTerms}</p>}
    </DocumentShell>
  );
}
