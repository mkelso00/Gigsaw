import type { Prisma } from "@prisma/client";
import { actName, BOOKING_STATUS_LABELS, BOOKING_STATUSES, type BookingStatus } from "./constants";
import type { IcsEvent } from "./ics";
import { localTime } from "./time";

// Calendar sync for agency staff: a private feed of bookings for Google Calendar, Outlook or Apple.
// Either the bookings they're lead agent on, or every booking. Never archived or cancelled gigs,
// and never any money: the feed is read by calendar apps on servers we don't control.

export type TeamScope = "MINE" | "ALL";

/** Statuses a staff feed can include. Cancelled gigs never go in. */
export const TEAM_FEED_STATUSES: BookingStatus[] = BOOKING_STATUSES.filter((s) => s !== "CANCELLED");

/** How far back the feed goes, so calendars keep recent gigs without the whole history. */
export const FEED_DAYS_BACK = 90;

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

/** Exactly what the feed reads from a booking. No money fields, so none can leak into a calendar. */
export const TEAM_FEED_SELECT = {
  id: true,
  reference: true,
  status: true,
  eventName: true,
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

export type TeamFeedBooking = Prisma.BookingGetPayload<{ select: typeof TEAM_FEED_SELECT }>;

/** One booking as a calendar event: "Act @ Venue", from the call time to the end of the set. */
export function teamFeedEvent(b: TeamFeedBooking, opts: { baseUrl: string; agencyTimezone: string }): IcsEvent {
  const status = b.status as BookingStatus;
  const where = b.venue?.name ?? (b.eventName || "venue to be confirmed");
  // Gigs that aren't on yet say so in the title, so they stand out in a busy calendar.
  const tag = status === "CONFIRMED" || status === "SETTLED" ? "" : ` (${BOOKING_STATUS_LABELS[status] ?? status})`;
  // Times in the description are the venue's; say so when that isn't the agency's time zone.
  const zoneNote = b.timezone !== opts.agencyTimezone ? ` (${b.timezone.replace(/_/g, " ")} time)` : "";
  const link = `${opts.baseUrl.replace(/\/$/, "")}/bookings/${b.id}`;
  const start = b.arriveBy;
  const end = b.setEnd ?? new Date(b.setStart.getTime() + 2 * 3_600_000);
  return {
    uid: `${b.id}@gigsaw-team`,
    start,
    // A calendar event needs an end after its start, even if the times were entered oddly.
    end: end > start ? end : new Date(start.getTime() + 2 * 3_600_000),
    summary: `${actName(b)} @ ${where}${tag}`,
    location: b.venue ? [b.venue.name, b.venue.address, b.venue.city, b.venue.country].filter(Boolean).join(", ") : "",
    description: [
      `Booking ${b.reference}`,
      `Status: ${BOOKING_STATUS_LABELS[status] ?? status}`,
      b.eventName ? `Event: ${b.eventName}` : "",
      `Arrive by ${localTime(b.arriveBy, b.timezone)}${zoneNote}`,
      b.soundcheckAt ? `Soundcheck ${localTime(b.soundcheckAt, b.timezone)}` : "",
      `On stage ${localTime(b.setStart, b.timezone)}${b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}`,
      b.dayContact ? `Contact on the day: ${b.dayContact}` : "",
      `Open in Gigsaw: ${link}`,
    ]
      .filter(Boolean)
      .join("\n"),
    url: link,
    updated: b.updatedAt,
  };
}
