import { createHash } from "node:crypto";
import { actFeedEvent, ACT_FEED_DAYS_BACK, type ActFeedBooking } from "@/lib/act-calendar";
import { ACT_VISIBLE, type BookingStatus } from "@/lib/constants";
import { isValidTimeZone, zonedParts } from "@/lib/time";

// What goes in a connected calendar, and whether a gig belongs there at all. Pure functions, so
// the rules can be tested without a database or a provider.
//
// The words come from actFeedEvent, the same builder as the act's subscribe feed, so a connected
// calendar never says more than the feed: no sale price, booking fee, deposit or anything else
// about money. Times are sent as the venue's wall-clock time with its time zone, so the event
// sits at the right moment wherever the act's calendar is set, and shows the venue's zone.

export type Provider = "GOOGLE" | "MICROSOFT";

/** Statuses that go in a connected calendar: the feed's, less Cancelled (a cancelled gig is removed, not kept as a cancelled event). */
export const CALENDAR_STATUSES: BookingStatus[] = ACT_VISIBLE.filter((s) => s !== "CANCELLED");

export { ACT_FEED_DAYS_BACK };

export type CalendarEventContent = {
  summary: string;
  location: string;
  description: string;
  url: string;
  start: Date;
  end: Date;
  /** An IANA zone, the venue's ("Europe/London"); "UTC" if the booking's zone isn't a real one. */
  timeZone: string;
};

/** The event for one gig, from the act's feed. */
export function calendarContent(b: ActFeedBooking, opts: { baseUrl: string }): CalendarEventContent {
  // Zones are checked when a booking is saved; one that slipped through gives UTC times rather than no event.
  const timeZone = b.timezone && isValidTimeZone(b.timezone) ? b.timezone : "UTC";
  const e = actFeedEvent(timeZone === b.timezone ? b : { ...b, timezone: timeZone }, opts);
  // Both providers refuse an event that ends before it starts, which odd times could give.
  const end = e.end > e.start ? e.end : new Date(e.start.getTime() + 2 * 3_600_000);
  return { summary: e.summary, location: e.location ?? "", description: e.description ?? "", url: e.url ?? "", start: e.start, end, timeZone };
}

/** Bump to send every event again after changing what's sent (the payloads below or the feed's words). */
const CONTENT_VERSION = 1;

/**
 * A fingerprint of what's sent, so an unchanged gig isn't sent again. Leaves out updatedAt: a save
 * that changes nothing the act sees (a payment, a note for the agency) costs no calls.
 */
export function contentHash(c: CalendarEventContent, provider: Provider) {
  const parts = [CONTENT_VERSION, provider, c.summary, c.location, c.description, c.url, c.start.toISOString(), c.end.toISOString(), c.timeZone];
  return createHash("sha256").update(JSON.stringify(parts)).digest("base64url");
}

/** The wall-clock time in a zone, as both APIs want it with a separate time zone: "2026-11-21T19:00:00". */
export function wallClock(d: Date, timeZone: string) {
  const p = zonedParts(d, timeZone);
  const two = (n: number) => String(n).padStart(2, "0");
  // Intl can give hour 24 for midnight in some runtimes.
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour % 24)}:${two(p.minute)}:${two(p.second)}`;
}

/** Google Calendar v3 event body. */
export function googleEventBody(c: CalendarEventContent, bookingId: string) {
  return {
    summary: c.summary,
    location: c.location,
    description: c.description,
    start: { dateTime: wallClock(c.start, c.timeZone), timeZone: c.timeZone },
    end: { dateTime: wallClock(c.end, c.timeZone), timeZone: c.timeZone },
    // Brings back an event the act deleted by hand, when the gig changes: the calendar follows Gigsaw.
    status: "confirmed",
    ...(c.url ? { source: { title: "Gigsaw", url: c.url } } : {}),
    // Lets anyone tidying a calendar tell Gigsaw's events apart. Not a secret: the booking id is in the link too.
    extendedProperties: { private: { gigsawBookingId: bookingId } },
  };
}

/** Microsoft Graph event body. Graph takes IANA zone names as well as Windows ones. */
export function microsoftEventBody(c: CalendarEventContent) {
  return {
    subject: c.summary,
    body: { contentType: "text", content: c.description },
    start: { dateTime: wallClock(c.start, c.timeZone), timeZone: c.timeZone },
    end: { dateTime: wallClock(c.end, c.timeZone), timeZone: c.timeZone },
    location: { displayName: c.location },
    showAs: "busy",
  };
}

export type GigForRules = { status: string; archivedAt: Date | null; artistId: string | null; setStart: Date };

/**
 * Does this gig belong in a calendar for a login that sees these acts? The act feed's rule (the
 * login's acts and the bands they're in, statuses an act sees, not archived, back to 90 days ago),
 * less cancelled gigs. `ignoreAge` keeps a gig that's already in the calendar from being taken out
 * just because it's now in the past.
 */
export function belongsInCalendar(b: GigForRules, actIds: Iterable<string>, opts: { now?: Date; ignoreAge?: boolean } = {}) {
  if (!b.artistId || b.archivedAt) return false;
  if (!CALENDAR_STATUSES.includes(b.status as BookingStatus)) return false;
  if (![...actIds].includes(b.artistId)) return false;
  if (opts.ignoreAge) return true;
  const now = (opts.now ?? new Date()).getTime();
  return b.setStart.getTime() >= now - ACT_FEED_DAYS_BACK * 86_400_000;
}

export type SyncPlan = "create" | "update" | "delete" | "skip";

/** What to do with one gig in one calendar, given whether it belongs there and what was last sent. */
export function planSync(wanted: boolean, link: { contentHash: string } | null, hash: string | null): SyncPlan {
  if (!wanted) return link ? "delete" : "skip";
  if (!link) return "create";
  return link.contentHash === hash ? "skip" : "update";
}
