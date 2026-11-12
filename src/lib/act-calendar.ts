import type { Prisma } from "@prisma/client";
import { ACT_VISIBLE, actName, BOOKING_STATUS_LABELS, type BookingStatus } from "./constants";
import type { IcsEvent } from "./ics";
import { localTime } from "./time";

// An act's gigs as calendar events: the one source for both the act's subscribe feed
// (/api/calendar/[token]) and the events Gigsaw puts in a connected Google or Outlook calendar
// (src/lib/calendar-sync). Keeping both on this file means a connected calendar can never say
// more than the feed does. Never any money: acts don't see the sale price, booking fee, deposit or
// other acts' fees, and these events end up on servers we don't control.

/** How far back the act's feed goes, so calendars keep recent gigs without the whole history. */
export const ACT_FEED_DAYS_BACK = 90;

/** The gigs an act's feed lists: anything offered to them or booked, cancelled ones included (marked cancelled). */
export function actFeedWhere(agencyId: string, actIds: string[], now = new Date()): Prisma.BookingWhereInput {
  return { agencyId, artistId: { in: actIds }, setStart: { gte: new Date(now.getTime() - ACT_FEED_DAYS_BACK * 86_400_000) }, status: { in: ACT_VISIBLE } };
}

/** Exactly what the act's events read from a booking. No money fields, so none can leak into a calendar. */
export const ACT_FEED_SELECT = {
  id: true,
  status: true,
  timezone: true,
  arriveBy: true,
  soundcheckAt: true,
  setStart: true,
  setEnd: true,
  dayContact: true,
  updatedAt: true,
  artist: { select: { name: true } },
  venue: { select: { name: true, address: true, city: true, country: true } },
} satisfies Prisma.BookingSelect;

export type ActFeedBooking = Prisma.BookingGetPayload<{ select: typeof ACT_FEED_SELECT }>;

/** One gig as the act sees it: "Act @ Venue", from the call time to the end of the set. */
export function actFeedEvent(b: ActFeedBooking, opts: { baseUrl: string }): IcsEvent {
  const base = opts.baseUrl.replace(/\/$/, "");
  const status = BOOKING_STATUS_LABELS[b.status as BookingStatus] ?? b.status;
  const where = b.venue ? [b.venue.name, b.venue.address, b.venue.city, b.venue.country].filter(Boolean).join(", ") : "";
  return {
    uid: `${b.id}@gigsaw`,
    start: b.arriveBy,
    end: b.setEnd ?? new Date(b.setStart.getTime() + 2 * 3_600_000),
    summary: `${b.status === "HOLD" ? "[HOLD] " : ""}${actName(b)}${b.venue ? ` @ ${b.venue.name}` : ""}`,
    location: where,
    description: [
      `Status: ${status}`,
      `Arrive by ${localTime(b.arriveBy, b.timezone)}`,
      b.soundcheckAt ? `Soundcheck ${localTime(b.soundcheckAt, b.timezone)}` : "",
      `On stage ${localTime(b.setStart, b.timezone)}`,
      b.dayContact ? `Contact: ${b.dayContact}` : "",
      `Details: ${base}/app/gigs/${b.id}`,
    ]
      .filter(Boolean)
      .join("\n"),
    url: `${base}/app/gigs/${b.id}`,
    updated: b.updatedAt,
    cancelled: b.status === "CANCELLED",
  };
}
