import { BOOKING_STATUSES } from "@/lib/constants";
import { isDateKey } from "@/lib/rota";

/*
 * The staff calendar remembers where you were (view, dates and filters) in a cookie, so the menu
 * link, the dashboard and "back to calendar" all land where you left off. It's a cookie rather than
 * localStorage so the server can send the right month straight away, with no flash of today first.
 * The dates are only kept for a working day: open the calendar tomorrow and it starts from today
 * again, but still in your view with your filters.
 */

export const CALENDAR_COOKIE = "gigsaw_calendar";
export const CALENDAR_COOKIE_DAYS = 180;
const DATE_KEPT_MS = 12 * 3600 * 1000;

const KEYS = ["view", "date", "town", "venue", "artist", "status", "colour"] as const;
type Saved = Partial<Record<(typeof KEYS)[number], string>>;

/** Only well-formed values come back, whatever the cookie says. */
function clean(input: Record<string, string | undefined>): Saved {
  const out: Saved = {};
  if (input.view === "month" || input.view === "week" || input.view === "day") out.view = input.view;
  if (isDateKey(input.date)) out.date = input.date;
  if (input.status && (BOOKING_STATUSES as readonly string[]).includes(input.status)) out.status = input.status;
  if (input.colour === "artist") out.colour = input.colour;
  for (const k of ["town", "venue", "artist"] as const) {
    const v = input[k]?.trim();
    // Venue can be several, comma separated (up to about 30 picked at once).
    if (v && v.length <= (k === "venue" ? 800 : 120)) out[k] = v;
  }
  return out;
}

/** The cookie value for where this person is on the calendar now. */
export function rememberCalendar(userId: string, params: Record<string, string | undefined>, now: number) {
  return `${userId}|${now}|${new URLSearchParams(clean(params) as Record<string, string>).toString()}`;
}

/** The query string to take this person back to, or null to start afresh (no cookie, someone else's, or nothing worth keeping). */
export function recallCalendar(value: string | undefined, userId: string, now: number): string | null {
  if (!value) return null;
  const [who, at, query = ""] = value.split("|");
  if (who !== userId) return null;
  const saved = clean(Object.fromEntries(new URLSearchParams(query)));
  if (!(now - Number(at) < DATE_KEPT_MS)) delete saved.date;
  const qs = new URLSearchParams(saved as Record<string, string>).toString();
  return qs || null;
}
