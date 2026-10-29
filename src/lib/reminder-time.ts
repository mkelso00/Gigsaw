// When gig reminders go out (pure, so it can be unit tested).
//
// Weekly: on the agency's chosen day and time, each artist gets their gigs for the coming
// week (Monday to Sunday). Sent on a Monday, it covers that same week.
// On the day: at the chosen time on the day of the gig, or 3 hours before the call time if
// that's earlier (for afternoon gigs), but never before 07:00.

import { weekdayOf } from "./rota";
import { addDaysToKey, localDateKey, localTime, zonedToUtc } from "./time";

const HOUR = 3_600_000;

export function isHhmm(s: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** The Monday of the week a weekly reminder sent now should cover, or null if it isn't time yet. */
export function weeklyReminderWeek(now: Date, timeZone: string, day: number, time: string): string | null {
  const today = localDateKey(now, timeZone);
  const weekday = weekdayOf(today);
  if (weekday !== day || localTime(now, timeZone) < time) return null;
  return weekday === 1 ? today : addDaysToKey(today, 8 - weekday);
}

/** When to send the on-the-day reminder for a gig with this call time. */
export function dayReminderAt(arriveBy: Date, timeZone: string, time: string): Date {
  const date = localDateKey(arriveBy, timeZone);
  const usual = zonedToUtc(date, time, timeZone);
  const latest = new Date(arriveBy.getTime() - 3 * HOUR);
  if (usual <= latest) return usual;
  const earliest = zonedToUtc(date, "07:00", timeZone);
  return latest > earliest ? latest : earliest;
}

/** "this morning", "this afternoon" or "this evening" for a time on the day. */
export function partOfDay(date: Date, timeZone: string) {
  const t = localTime(date, timeZone);
  return t < "12:00" ? "this morning" : t < "17:00" ? "this afternoon" : "this evening";
}
