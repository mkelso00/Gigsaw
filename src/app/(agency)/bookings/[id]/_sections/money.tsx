import { DEAL_TYPE_LABELS, type DealType } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/time";
import type { BookingPageData, BookingView } from "../_data";

export function MoneySection({ booking, deal, totals }: { booking: BookingView; deal: BookingPageData["deal"]; totals: BookingPageData["totals"] }) {
  const tz = booking.timezone;
  const money = (m: number) => formatMoney(m, booking.currency);
  // Bar gigs are paid by the venue; weddings and parties by the client.
  const payerShort = booking.eventType === "GIG" && booking.venue ? "Venue" : "Client";
  const payerLabel = `${payerShort} pays`;
  return (
    <section className="card card-pad">
      <h2 className="section-title mb-3">Money</h2>
      <dl className="space-y-2 text-sm">
        {booking.dealType !== "BUY_SELL" && <Row label="Deal">{DEAL_TYPE_LABELS[booking.dealType as DealType] ?? booking.dealType}</Row>}
        <Row label={payerLabel}>
          {money(deal.grossMinor)}
          {deal.vatMinor > 0 && (
            <span className="block text-xs text-slate-500">
              + {money(deal.vatMinor)} VAT ({booking.vatPct}%)
            </span>
          )}
        </Row>
        {deal.bookingFeeMinor > 0 && (
          <Row label="Booking fee">
            {money(deal.bookingFeeMinor)}
            <span className="block text-xs text-slate-500">on top, all ours</span>
          </Row>
        )}
        <Row label="Act is paid">
          {booking.dealType === "BUY_SELL" && booking.artistFeeMinor === null ? <span className="text-amber-500">Not set</span> : money(deal.artistMinor)}
        </Row>
        <Row label="We make">
          <strong className={deal.agencyMinor < 0 ? "text-rose-500" : "text-emerald-500"}>{money(deal.agencyMinor)}</strong>
        </Row>
        <hr className="border-slate-100" />
        {booking.depositMinor > 0 && (
          <Row label="Deposit">
            {money(totals.depositReceivedMinor)} of {money(booking.depositMinor)}
            {booking.depositDueDate && <span className="block text-xs text-slate-500">due {formatDate(booking.depositDueDate, tz)}</span>}
          </Row>
        )}
        <Row label={`${payerShort} has paid`}>
          {money(totals.receivedMinor)} of {money(deal.totalDueMinor)}
        </Row>
        <Row label={`${payerShort} still owes`}>
          <strong>{money(Math.max(0, deal.totalDueMinor - totals.receivedMinor))}</strong>
        </Row>
        <Row label="Paid to act">
          {money(totals.paidOutMinor)} of {money(deal.artistMinor)}
        </Row>
        <Row label="Still to pay act">
          <strong>{money(Math.max(0, deal.artistMinor - totals.paidOutMinor))}</strong>
        </Row>
      </dl>
      {booking.dealNotes && <p className="mt-3 text-xs whitespace-pre-line text-slate-500">{booking.dealNotes}</p>}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
