// Week maths for the rota, and automatic venue colours.
import { addDaysToKey } from "./time";

export const WEEKDAYS = [
  [1, "Mon", "Monday"],
  [2, "Tue", "Tuesday"],
  [3, "Wed", "Wednesday"],
  [4, "Thu", "Thursday"],
  [5, "Fri", "Friday"],
  [6, "Sat", "Saturday"],
  [7, "Sun", "Sunday"],
] as const;

/** 1 = Monday ... 7 = Sunday, for a "YYYY-MM-DD" date. */
export function weekdayOf(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** The Monday of the week a date falls in. */
export function weekStartOf(dateKey: string) {
  return addDaysToKey(dateKey, 1 - weekdayOf(dateKey));
}

/** The date of a weekday (1-7) in the week starting on `weekStart` (a Monday). */
export function dateInWeek(weekStart: string, weekday: number) {
  return addDaysToKey(weekStart, weekday - 1);
}

export function isDateKey(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

// Twelve colours that are easy to tell apart on a white calendar.
export const VENUE_PALETTE = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626", "#0d9488", "#9333ea", "#65a30d", "#c2410c"];

/** The first palette colour no existing venue uses (or the least used one), for a new venue. */
export function suggestVenueColour(existing: { id: string; colour?: string | null }[]) {
  const counts = new Map(VENUE_PALETTE.map((c) => [c, 0]));
  for (const v of existing) {
    const c = venueColour(v);
    if (counts.has(c)) counts.set(c, counts.get(c)! + 1);
  }
  return [...counts].sort((a, b) => a[1] - b[1])[0][0];
}

/** A venue's calendar colour: the one chosen for it, or a stable automatic one. */
export function venueColour(v: { id: string; colour?: string | null }) {
  if (v.colour && /^#[0-9a-f]{6}$/i.test(v.colour)) return v.colour;
  let h = 0;
  for (const ch of v.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return VENUE_PALETTE[h % VENUE_PALETTE.length];
}

/**
 * The dates of a booking repeated every week: from `from`, for `weeks` weeks, stopping after
 * `until` when that's given. Never more than `max`; `more` says some were left off for that.
 */
export function weeklyDates(from: string, o: { weeks?: number | null; until?: string | null; max: number }) {
  const weeks = o.weeks && o.weeks > 0 ? Math.floor(o.weeks) : o.until ? Infinity : 1;
  const dates: string[] = [];
  for (let d = from; dates.length < weeks && (!o.until || d <= o.until); d = addDaysToKey(d, 7)) {
    if (dates.length === o.max) return { dates, more: true };
    dates.push(d);
  }
  return { dates, more: false };
}

/** Whether a weekly slot runs on this date: on or after its first date and on or before its last (each if it has one). */
export function slotRunsOn(slot: { startsOn?: string | null; endsOn?: string | null }, date: string) {
  return (!slot.startsOn || date >= slot.startsOn) && (!slot.endsOn || date <= slot.endsOn);
}

/** The first date on or after `from` that falls on this weekday (1 = Monday). */
export function nextWeekday(from: string, weekday: number) {
  return addDaysToKey(from, (weekday - weekdayOf(from) + 7) % 7);
}
