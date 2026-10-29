// Per-gig billing: agencies pay the platform owner for each billable gig in a month.
// A gig is billable when its booking is confirmed or settled and isn't demo data.
// It's counted in the month of the gig (the call time's date in the venue's time zone).

import { addDaysToKey, localDateKey } from "./time";

export const BILLABLE_STATUSES = ["CONFIRMED", "SETTLED"];

export type BillableLike = { status: string; demo: boolean; arriveBy: Date; timezone: string; reference: string };

export function isBillable(b: { status: string; demo: boolean }) {
  return BILLABLE_STATUSES.includes(b.status) && !b.demo;
}

/** "YYYY-MM" of the gig in the venue's time zone. */
export function gigMonth(b: { arriveBy: Date; timezone: string }) {
  return localDateKey(b.arriveBy, b.timezone).slice(0, 7);
}

/** The billable gigs in a month, sorted by reference. */
export function billableGigs<T extends BillableLike>(bookings: T[], month: string): T[] {
  return bookings.filter((b) => isBillable(b) && gigMonth(b) === month).sort((a, b) => a.reference.localeCompare(b.reference));
}

export function isMonthKey(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/**
 * A UTC window that safely contains every gig whose local date falls in the month,
 * whatever the time zone (padded by two days each side). Filter with gigMonth afterwards.
 */
export function monthSearchWindow(month: string) {
  const first = `${month}-01`;
  const next = `${shiftMonth(month, 1)}-01`;
  return { gte: new Date(`${addDaysToKey(first, -2)}T00:00:00Z`), lt: new Date(`${addDaysToKey(next, 2)}T00:00:00Z`) };
}

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Statements can only be issued once a month is over. */
export function monthIsOver(month: string, now = new Date()) {
  return month < now.toISOString().slice(0, 7);
}
