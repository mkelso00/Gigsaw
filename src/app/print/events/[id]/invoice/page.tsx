import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Invoice } from "@/components/invoice";
import { requireStaff } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { eventTotals } from "@/lib/events";
import { cardPaymentsReady } from "@/lib/card-payments";
import { receivedOnInvoice } from "@/lib/pay-links";
import { dealBreakdown } from "@/lib/money";
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
        bookings: {
          where: { archivedAt: null, status: { not: "CANCELLED" } },
          include: { artist: { select: { name: true } }, payments: true },
          orderBy: { setStart: "asc" },
        },
      },
    }),
    getSettings(user.agencyId),
  ]);
  if (!e) notFound();
  const t = eventTotals(e.bookings);
  // The card payment link, if one's been made and there's something to pay.
  const payLink =
    t.outstanding > 0 && (await cardPaymentsReady(user.agency!))
      ? await prisma.payLink.findFirst({ where: { eventId: e.id, kind: "BALANCE", agencyId: user.agencyId } })
      : null;
  const day = formatDate(new Date(`${e.date}T12:00:00Z`), "UTC");
  const ref = e.bookings[0]?.reference ?? e.id.slice(-6).toUpperCase();

  return (
    <Invoice
      reference={`INV-${ref}`}
      settings={settings}
      currency={t.currency}
      timeZone={e.timezone}
      billTo={
        <>
          <div className="font-semibold">
            {e.customer?.company && e.customer.company !== "Private client" ? e.customer.company : e.customer?.name || "Customer"}
          </div>
          <div className="whitespace-pre-line">{e.customer?.address}</div>
          <div>{e.customer?.email}</div>
        </>
      }
      details={
        <>
          <div>
            <span className="text-slate-500">Event</span> {e.name}, {day}
          </div>
          {(e.venue || e.venueText) && (
            <div className="text-slate-500">{e.venue ? `${e.venue.name}${e.venue.city ? `, ${e.venue.city}` : ""}` : e.venueText}</div>
          )}
        </>
      }
      lines={e.bookings.map((b) => ({
        key: b.id,
        description: (
          <>
            {actName(b)}, {localTime(b.setStart, b.timezone)}
            {b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}
            <span className="block text-xs text-slate-500">{b.reference}</span>
          </>
        ),
        amountMinor: dealBreakdown(b).grossMinor,
      }))}
      bookingFeeMinor={t.fees}
      subtotalMinor={t.sale + t.fees}
      vat={{ label: "VAT", amountMinor: t.vat }}
      totalMinor={t.total}
      received={receivedOnInvoice(e.bookings.flatMap((b) => b.payments))}
      balanceMinor={t.outstanding}
      payLinkToken={payLink?.token}
    />
  );
}
