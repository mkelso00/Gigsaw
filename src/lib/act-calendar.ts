import type { Prisma } from "@prisma/client";
import { ACT_VISIBLE, actName, BOOKING_STATUS_LABELS, type BookingStatus } from "./constants";
import type { PlanExtraField } from "./event-plan";
import { changedAt, detailLine, detailText, EVENT_PLAN_SELECT, eventPlanLines, timeLines, venueText } from "./gig-details";
import type { IcsEvent } from "./ics";
import { dealBreakdown, formatMoney } from "./money";

// An act's gigs as calendar events: the one source for both the act's subscribe feed
// (/api/calendar/[token]) and the events Gigsaw puts in a connected Google or Outlook calendar
// (src/lib/calendar-sync). Keeping both on this file means a connected calendar can never say
// more than the feed does.
//
// Money: the only amount an act's event ever shows is that act's own pay ("Your fee: £350.00"),
// worked out by actPayMinor below, and only on gigs for an act the login is directly in (not a band
// they're part of, whose fee isn't theirs). Never the sale price, booking fee, VAT, deposit, what
// the venue or customer pays, or another act's fee: these events end up on servers we don't control.

/** How far back the act's feed goes, so calendars keep recent gigs without the whole history. */
export const ACT_FEED_DAYS_BACK = 90;

/** The gigs an act's feed lists: anything offered to them or booked, cancelled ones included (marked cancelled). */
export function actFeedWhere(agencyId: string, actIds: string[], now = new Date()): Prisma.BookingWhereInput {
  return { agencyId, artistId: { in: actIds }, setStart: { gte: new Date(now.getTime() - ACT_FEED_DAYS_BACK * 86_400_000) }, status: { in: ACT_VISIBLE } };
}

/**
 * Exactly what the act's events read from a booking: what the act's gig page shows them. The deal fields
 * (dealType, feeMinor, artistFeeMinor, commissionPct) are here only to work out the act's own pay, and are
 * read by actPayMinor alone. Not the booking fee, VAT, deposit, money notes or the agency's internal notes.
 */
export const ACT_FEED_SELECT = {
  id: true,
  artistId: true,
  status: true,
  eventName: true,
  timezone: true,
  arriveBy: true,
  soundcheckAt: true,
  setStart: true,
  setEnd: true,
  dayContact: true,
  travel: true,
  accommodation: true,
  hospitality: true,
  currency: true,
  dealType: true,
  feeMinor: true,
  artistFeeMinor: true,
  commissionPct: true,
  updatedAt: true,
  artist: { select: { name: true } },
  venue: { select: { name: true, address: true, city: true, country: true, notes: true } },
  promoter: { select: { name: true, phone: true } },
  agent: { select: { name: true, email: true } },
  event: { select: EVENT_PLAN_SELECT },
} satisfies Prisma.BookingSelect;

export type ActFeedBooking = Prisma.BookingGetPayload<{ select: typeof ACT_FEED_SELECT }>;

/** Who's looking, for the one amount an act sees: their own pay. */
export type ActViewer = {
  /** The acts the login is directly in (ownActIds): the fee shows on these acts' gigs only. */
  ownActIds: string[];
  /** A person's login (they may be in several acts): "Fee for <act>" rather than "Your fee". */
  person: boolean;
};

export type ActFeedOptions = { baseUrl: string; viewer: ActViewer; planExtras: PlanExtraField[] };

/** The act's pay for a gig, as their gig page shows it: after commission, or the agreed cost on a sale and cost deal. */
export function actPayMinor(b: Pick<ActFeedBooking, "dealType" | "feeMinor" | "artistFeeMinor" | "commissionPct">) {
  // VAT and the booking fee don't change the act's share, so they aren't read at all.
  return dealBreakdown({ dealType: b.dealType, feeMinor: b.feeMinor, artistFeeMinor: b.artistFeeMinor, commissionPct: b.commissionPct, vatPct: 0 }).artistMinor;
}

/** The fee line for this viewer, or "" when the gig isn't for one of their own acts or no fee is set. */
function feeLine(b: ActFeedBooking, viewer: ActViewer) {
  if (!b.artistId || !viewer.ownActIds.includes(b.artistId)) return "";
  const pay = actPayMinor(b);
  if (pay <= 0) return "";
  return detailLine(viewer.person ? `Fee for ${actName(b)}` : "Your fee", formatMoney(pay, b.currency));
}

/** The words of one gig's event, in the order an act wants them on the day. Only filled-in fields. */
export function actFeedDescription(b: ActFeedBooking, opts: ActFeedOptions) {
  const status = BOOKING_STATUS_LABELS[b.status as BookingStatus] ?? b.status;
  const venue = venueText(b.venue) || b.event?.venueText || "";
  return detailText([
    [
      detailLine("Act", actName(b)),
      detailLine("Venue", venue),
      detailLine("Status", status),
      b.eventName && b.eventName !== b.event?.name ? detailLine("Event", b.eventName) : "",
    ],
    timeLines(b),
    [feeLine(b, opts.viewer)],
    [
      detailLine("Day contact", b.dayContact),
      detailLine("Travel", b.travel),
      detailLine("Accommodation", b.accommodation),
      detailLine("Hospitality", b.hospitality),
      detailLine("Venue notes", b.venue?.notes),
      b.promoter ? detailLine("Promoter", [b.promoter.name, b.promoter.phone].filter(Boolean).join(", ")) : "",
      b.agent ? detailLine("Your agent", [b.agent.name, b.agent.email].filter(Boolean).join(", ")) : "",
    ],
    eventPlanLines(b.event, opts.planExtras),
    [detailLine("Details", actGigUrl(b, opts.baseUrl))],
  ]);
}

const actGigUrl = (b: { id: string }, baseUrl: string) => `${baseUrl.replace(/\/$/, "")}/app/gigs/${b.id}`;

/** One gig as the act sees it: "Act @ Venue", from the call time to the end of the set. */
export function actFeedEvent(b: ActFeedBooking, opts: ActFeedOptions): IcsEvent {
  return {
    uid: `${b.id}@gigsaw`,
    start: b.arriveBy,
    end: b.setEnd ?? new Date(b.setStart.getTime() + 2 * 3_600_000),
    summary: `${b.status === "HOLD" ? "[HOLD] " : ""}${actName(b)}${b.venue ? ` @ ${b.venue.name}` : ""}`,
    location: venueText(b.venue) || b.event?.venueText || "",
    description: actFeedDescription(b, opts),
    url: actGigUrl(b, opts.baseUrl),
    updated: changedAt(b),
    cancelled: b.status === "CANCELLED",
  };
}
