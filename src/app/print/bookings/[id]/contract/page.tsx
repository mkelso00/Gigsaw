import type { Metadata } from "next";
import { DocTable, DocumentShell } from "@/components/document";
import { DEAL_TYPE_LABELS, eventTypeLabel, type DealType, actName } from "@/lib/constants";
import { dealBreakdown, formatMoney } from "@/lib/money";
import { loadPrintable } from "@/lib/print";
import { formatDate, formatDateTime, localTime, zoneLabel } from "@/lib/time";

export const metadata: Metadata = { title: "Contract" };

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { booking: b, settings } = await loadPrintable(id);
  const tz = b.timezone;
  const d = dealBreakdown(b);
  const money = (m: number) => formatMoney(m, b.currency);
  const venue = b.venue ? [b.venue.name, b.venue.address, b.venue.city, b.venue.country].filter(Boolean).join(", ") : "To be confirmed";

  return (
    <DocumentShell title="Performance contract" reference={b.reference} settings={settings}>
      <p className="mb-6">
        This agreement is made between{" "}
        <strong>{b.promoter ? `${b.promoter.name}${b.promoter.company ? ` of ${b.promoter.company}` : ""}` : "the Client"}</strong> (&ldquo;the Client&rdquo;)
        and <strong>{settings.agencyName}</strong> acting as agent for <strong>{actName(b)}</strong> (&ldquo;the Artist&rdquo;).
      </p>
      <h2 className="mb-2 font-semibold">1. Engagement</h2>
      <DocTable
        rows={[
          ["Artist", actName(b)],
          ["Type of engagement", eventTypeLabel(b.eventType)],
          ["Event", b.eventName],
          ["Venue", venue],
          ["Date", formatDate(b.arriveBy, tz)],
          ["Arrival / load-in", `${localTime(b.arriveBy, tz)} ${zoneLabel(b.arriveBy, tz)}`],
          ["Soundcheck", b.soundcheckAt ? localTime(b.soundcheckAt, tz) : ""],
          ["Performance", `${localTime(b.setStart, tz)}${b.setEnd ? ` to ${localTime(b.setEnd, tz)}` : ""}`],
          ["Client address", b.promoter?.address ?? ""],
        ]}
      />
      <h2 className="mt-6 mb-2 font-semibold">2. Fee</h2>
      <DocTable
        rows={[
          ["Deal", b.dealType === "BUY_SELL" ? "" : (DEAL_TYPE_LABELS[b.dealType as DealType] ?? b.dealType)],
          ["Fee", money(d.grossMinor)],
          ["Booking fee", d.bookingFeeMinor ? money(d.bookingFeeMinor) : ""],
          ["VAT", d.vatMinor ? `${money(d.vatMinor)} (${b.vatPct}%)` : ""],
          ["Total payable", money(d.totalDueMinor)],
          ["Deposit", b.depositMinor ? `${money(b.depositMinor)}${b.depositDueDate ? `, due by ${formatDate(b.depositDueDate, tz)}` : ""}` : ""],
          ["Balance", b.depositMinor ? money(d.totalDueMinor - b.depositMinor) : ""],
          ["Deal terms", b.dealNotes],
          [
            "Radius clause",
            b.radiusKm !== null
              ? `The Client agrees the Artist may not perform within ${b.radiusKm} km for ${b.radiusDays} days either side of the engagement without consent.`
              : "",
          ],
        ]}
      />
      <h2 className="mt-6 mb-2 font-semibold">3. Hospitality and production</h2>
      <DocTable
        rows={[
          ["Hospitality", b.hospitality || "As per the Artist's rider."],
          ["Day of show contact", b.dayContact],
        ]}
      />
      {settings.contractTerms && (
        <>
          <h2 className="mt-6 mb-2 font-semibold">4. Terms</h2>
          <p className="text-sm whitespace-pre-line">{settings.contractTerms}</p>
        </>
      )}
      <div className="mt-12 grid grid-cols-2 gap-10 text-sm">
        {["For the Client", `For ${settings.agencyName}, on behalf of the Artist`].map((who) => (
          <div key={who}>
            <div className="h-16 border-b border-slate-400" />
            <div className="mt-2">{who}</div>
            <div className="mt-6 h-px border-b border-slate-300" />
            <div className="mt-1 text-slate-500">Date</div>
          </div>
        ))}
      </div>
      <p className="mt-8 text-xs text-slate-400">Issued {formatDateTime(new Date(), settings.defaultTimezone)}</p>
    </DocumentShell>
  );
}
