import Link from "next/link";
import { PageHeader, Stat } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { quoteRef } from "@/lib/quotes";
import { formatDateTime } from "@/lib/time";
import type { EventPageData, EventView } from "../_data";
import { dayLabel } from "./day-label";

const TYPE: Record<string, string> = { WEDDING: "Wedding", PRIVATE_PARTY: "Private party", CORPORATE: "Corporate event", OTHER: "Event" };

export function EventHeader({ event: e, daysLeft }: { event: EventView; daysLeft: number }) {
  const where = e.venue ? `${e.venue.name}${e.venue.city ? `, ${e.venue.city}` : ""}` : e.venueText;
  return (
    <PageHeader
      eyebrow={`${TYPE[e.type] ?? "Event"}${daysLeft > 0 ? ` · in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : daysLeft === 0 ? " · today" : ""}`}
      title={e.name}
      subtitle={[dayLabel(e.date), where, e.customer?.name].filter(Boolean).join(" · ")}
      actions={
        <>
          {e.bookings.length > 0 && (
            <>
              <Link href={`/print/events/${e.id}/contract`} className="btn" target="_blank">
                Contract
              </Link>
              <Link href={`/print/events/${e.id}/invoice`} className="btn" target="_blank">
                Invoice
              </Link>
            </>
          )}
          {e.customer && (
            <Link href={`/contacts/${e.customer.id}`} className="btn">
              Customer
            </Link>
          )}
        </>
      }
    />
  );
}

/** Shown when the customer booked by signing a proposal, which stands in for the contract. */
export function ProposalBanner({ proposal, timeZone }: { proposal: NonNullable<EventPageData["proposal"]>; timeZone: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
      <span className="min-w-0 flex-1">
        Booked from{" "}
        <Link href={`/quotes/${proposal.id}`} className="font-medium underline-offset-2 hover:underline">
          proposal {quoteRef(proposal)}
        </Link>
        , signed and approved by {proposal.answerName}
        {proposal.answeredAt ? ` on ${formatDateTime(proposal.answeredAt, timeZone)}` : ""}. It&apos;s locked in: no separate contract needed.
      </span>
    </div>
  );
}

export function EventStats({ totals: t, daysLeft }: { totals: EventPageData["totals"]; daysLeft: number }) {
  const m = (x: number) => formatMoney(x, t.currency);
  return (
    <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <Stat
        label="Customer pays"
        value={t.total ? m(t.total) : "–"}
        hint={[t.fees ? `incl. ${m(t.fees)} booking fee` : "", t.vat ? `VAT ${m(t.vat)}` : "", `${t.acts} act${t.acts === 1 ? "" : "s"}`]
          .filter(Boolean)
          .join(" · ")}
      />
      <Stat label="Received" value={m(t.received)} hint={t.deposits ? `Deposits ${m(t.deposits)}` : "No payments yet"} />
      <Stat
        tone={t.outstanding && daysLeft <= 14 ? "alert" : "default"}
        label="Left to pay"
        value={m(t.outstanding)}
        hint={t.total && !t.outstanding ? "Paid in full" : undefined}
      />
      <Stat tone="dark" label="We make" value={m(t.margin)} hint={`Acts are paid ${m(t.cost)}${t.fees ? ` · booking fee ${m(t.fees)}` : ""}`} />
    </div>
  );
}
