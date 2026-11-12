import type { Metadata } from "next";
import { Invoice } from "@/components/invoice";
import { dealBreakdown, paymentTotals } from "@/lib/money";
import { loadPrintable } from "@/lib/print";
import { cardPaymentsReady } from "@/lib/card-payments";
import { prisma } from "@/lib/db";
import { receivedOnInvoice } from "@/lib/pay-links";
import { formatDate } from "@/lib/time";
import { actName } from "@/lib/constants";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { booking: b, settings, user } = await loadPrintable(id);
  const d = dealBreakdown(b);
  const paid = paymentTotals(b.payments).receivedMinor;
  const balance = Math.max(0, d.totalDueMinor - paid);
  // The card payment link, if one's been made and there's something to pay.
  const payLink =
    balance > 0 && (await cardPaymentsReady(user.agency!))
      ? await prisma.payLink.findFirst({ where: { bookingId: b.id, kind: "BALANCE", agencyId: b.agencyId } })
      : null;

  return (
    <Invoice
      reference={`INV-${b.reference}`}
      settings={settings}
      currency={b.currency}
      timeZone={b.timezone}
      billTo={
        <>
          <div className="font-semibold">{b.promoter?.company || b.promoter?.name || "Promoter"}</div>
          {b.promoter?.company && <div>{b.promoter.name}</div>}
          <div className="whitespace-pre-line">{b.promoter?.address}</div>
          <div>{b.promoter?.email}</div>
        </>
      }
      details={
        <div>
          <span className="text-slate-500">Booking</span> {b.reference}
        </div>
      }
      lines={[
        {
          key: b.id,
          description: (
            <>
              Performance by {actName(b)}
              {b.venue ? ` at ${b.venue.name}${b.venue.city ? `, ${b.venue.city}` : ""}` : ""} on {formatDate(b.arriveBy, b.timezone)}
              {b.eventName ? ` (${b.eventName})` : ""}
            </>
          ),
          amountMinor: d.grossMinor,
        },
      ]}
      bookingFeeMinor={d.bookingFeeMinor}
      vat={{ label: <>VAT at {b.vatPct}%</>, amountMinor: d.vatMinor }}
      totalMinor={d.totalDueMinor}
      received={receivedOnInvoice(b.payments)}
      balanceMinor={balance}
      payLinkToken={payLink?.token}
    />
  );
}
