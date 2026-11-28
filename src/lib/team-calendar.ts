import type { Prisma } from "@prisma/client";
import { actName, BOOKING_STATUS_LABELS, BOOKING_STATUSES, type BookingStatus } from "./constants";
import type { PlanExtraField } from "./event-plan";
import { changedAt, detailLine, detailText, EVENT_PLAN_SELECT, eventPlanLines, timeLines, venueText } from "./gig-details";
import type { IcsEvent } from "./ics";
import { dealBreakdown, formatMoney } from "./money";

// Calendar sync for agency staff: a private feed of bookings for Google Calendar, Outlook or Apple.
// Either the bookings they're lead agent on, or every booking. Never archived or cancelled gigs.
//
// Money: only admins and agents can have this feed (the route checks), and every one of them sees the
// booking's Money panel in the app, so the feed shows the same figures: what the venue or client pays,
// the booking fee, what the act is paid and what the business makes. Nothing else money-wise (no
// payments received, no deposit), since the link lives in a calendar app on a server we don't control.

export type TeamScope = "MINE" | "ALL";

/** Statuses a staff feed can include. Cancelled gigs never go in. */
export const TEAM_FEED_STATUSES: BookingStatus[] = BOOKING_STATUSES.filter((s) => s !== "CANCELLED");

/** How far back the feed goes, so calendars keep recent gigs without the whole history. */
const FEED_DAYS_BACK = 90;

/** The statuses chosen ("CONFIRMED,SETTLED"), or every status when none are. */
export function feedStatuses(raw: string): BookingStatus[] {
  const chosen = TEAM_FEED_STATUSES.filter((s) =>
    raw
      .split(",")
      .map((x) => x.trim())
      .includes(s),
  );
  return chosen.length ? chosen : TEAM_FEED_STATUSES;
}

export function teamFeedWhere(
  user: { id: string; agencyId: string; calendarScope: string; calendarStatuses: string },
  now = new Date(),
): Prisma.BookingWhereInput {
  return {
    agencyId: user.agencyId,
    archivedAt: null,
    status: { in: feedStatuses(user.calendarStatuses) },
    setStart: { gte: new Date(now.getTime() - FEED_DAYS_BACK * 86_400_000) },
    ...(user.calendarScope === "ALL" ? {} : { agentId: user.id }),
  };
}

/** Exactly what the feed reads from a booking: the booking page's details and its Money panel figures. */
export const TEAM_FEED_SELECT = {
  id: true,
  reference: true,
  status: true,
  eventName: true,
  eventType: true,
  timezone: true,
  arriveBy: true,
  soundcheckAt: true,
  setStart: true,
  setEnd: true,
  dayContact: true,
  travel: true,
  accommodation: true,
  hospitality: true,
  notes: true,
  currency: true,
  dealType: true,
  feeMinor: true,
  artistFeeMinor: true,
  commissionPct: true,
  vatPct: true,
  bookingFeeMinor: true,
  dealNotes: true,
  updatedAt: true,
  artist: { select: { name: true } },
  venue: { select: { name: true, address: true, city: true, country: true, notes: true } },
  promoter: { select: { name: true, phone: true } },
  agent: { select: { name: true } },
  event: { select: EVENT_PLAN_SELECT },
} satisfies Prisma.BookingSelect;

export type TeamFeedBooking = Prisma.BookingGetPayload<{ select: typeof TEAM_FEED_SELECT }>;

/** The Money panel's figures, with its labels: "Venue pays" (or "Client pays"), the booking fee, "Act is paid" and "We make". */
export function teamMoneyLines(b: TeamFeedBooking): string[] {
  const deal = dealBreakdown(b);
  const money = (m: number) => formatMoney(m, b.currency);
  // Bar gigs are paid by the venue; weddings and parties by the client, as on the booking page.
  const payer = b.eventType === "GIG" && b.venue ? "Venue" : "Client";
  // A sale and cost deal whose cost isn't set yet has no act's pay, so no margin to show either.
  const costSet = b.dealType !== "BUY_SELL" || b.artistFeeMinor !== null;
  return [
    deal.grossMinor > 0 ? detailLine(`${payer} pays`, `${money(deal.grossMinor)}${deal.vatMinor > 0 ? ` + ${money(deal.vatMinor)} VAT` : ""}`) : "",
    deal.bookingFeeMinor > 0 ? detailLine("Booking fee", money(deal.bookingFeeMinor)) : "",
    costSet && deal.artistMinor > 0 ? detailLine("Act is paid", money(deal.artistMinor)) : "",
    costSet && (deal.grossMinor > 0 || deal.bookingFeeMinor > 0) ? detailLine("We make", money(deal.agencyMinor)) : "",
    detailLine("Money notes", b.dealNotes),
  ];
}

/** One booking as a calendar event: "Act @ Venue", from the call time to the end of the set. */
export function teamFeedEvent(b: TeamFeedBooking, opts: { baseUrl: string; agencyTimezone: string; planExtras: PlanExtraField[] }): IcsEvent {
  const status = b.status as BookingStatus;
  const where = b.venue?.name ?? (b.eventName || "venue to be confirmed");
  // Gigs that aren't on yet say so in the title, so they stand out in a busy calendar.
  const tag = status === "CONFIRMED" || status === "SETTLED" ? "" : ` (${BOOKING_STATUS_LABELS[status] ?? status})`;
  // Times in the description are the venue's; say so when that isn't the agency's time zone.
  const zoneNote = b.timezone !== opts.agencyTimezone ? ` (${b.timezone.replace(/_/g, " ")} time)` : "";
  const link = `${opts.baseUrl.replace(/\/$/, "")}/bookings/${b.id}`;
  const start = b.arriveBy;
  const end = b.setEnd ?? new Date(b.setStart.getTime() + 2 * 3_600_000);
  const venue = venueText(b.venue) || b.event?.venueText || "";
  return {
    uid: `${b.id}@gigsaw-team`,
    start,
    // A calendar event needs an end after its start, even if the times were entered oddly.
    end: end > start ? end : new Date(start.getTime() + 2 * 3_600_000),
    summary: `${actName(b)} @ ${where}${b.eventName?.trim() && b.eventName.trim() !== where ? ` · ${b.eventName.trim()}` : ""}${tag}`,
    location: venue,
    description: detailText([
      [
        detailLine("Booking", b.reference),
        detailLine("Status", BOOKING_STATUS_LABELS[status] ?? status),
        detailLine("Act", actName(b)),
        detailLine("Venue", venue),
        b.eventName && b.eventName !== b.event?.name ? detailLine("Event", b.eventName) : "",
        b.agent ? detailLine("Agent", b.agent.name) : "",
      ],
      timeLines(b, zoneNote),
      teamMoneyLines(b),
      [
        detailLine("Day contact", b.dayContact),
        detailLine("Travel", b.travel),
        detailLine("Accommodation", b.accommodation),
        detailLine("Hospitality", b.hospitality),
        detailLine("Venue notes", b.venue?.notes),
        b.promoter ? detailLine(b.eventType === "GIG" ? "Promoter" : "Client", [b.promoter.name, b.promoter.phone].filter(Boolean).join(", ")) : "",
        detailLine("Internal notes", b.notes),
      ],
      eventPlanLines(b.event, opts.planExtras),
      [detailLine("Open in Gigsaw", link)],
    ]),
    url: link,
    updated: changedAt(b),
  };
}
