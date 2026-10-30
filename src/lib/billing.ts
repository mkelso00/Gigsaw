// Per-gig billing: agencies pay the platform owner for each billable gig in a month,
// counted in the month of the gig (the call time's date in the venue's time zone).
//
// A gig is billable when it isn't demo data or cancelled, and any of these is true:
//  - it's confirmed or settled
//  - the artist checked in as arrived (so it clearly happened)
//  - it was a hold or pending booking and its date has passed (left unconfirmed after the event)
// Enquiries that pass their date without an arrival aren't billed, but are flagged for tidying up.

import { addDaysToKey, localDateKey } from "./time";

export const CONFIRMED_STATUSES = ["CONFIRMED", "SETTLED"];
const UNRESOLVED_STATUSES = ["ENQUIRY", "HOLD", "PENDING", "AWAITING"];
const DAY = 86_400_000;

export type BillableLike = { status: string; demo: boolean; arriveBy: Date; timezone: string; reference: string; arrived: boolean; hasAct?: boolean };

export function isBillable(b: { status: string; demo: boolean; arriveBy: Date; arrived: boolean; hasAct?: boolean }, now = new Date()) {
  if (b.demo || b.status === "CANCELLED") return false;
  if (CONFIRMED_STATUSES.includes(b.status) || b.arrived) return true;
  if (b.hasAct === false) return false;
  return (b.status === "HOLD" || b.status === "PENDING" || b.status === "AWAITING") && b.arriveBy < now;
}

/** Why a booking isn't billed, in plain words, or null when it is. */
export function notBilledReason(b: { status: string; demo: boolean; arriveBy: Date; arrived: boolean; hasAct?: boolean }, now = new Date()): string | null {
  if (isBillable(b, now)) return null;
  if (b.demo) return "Demo data";
  if (b.status === "CANCELLED") return "Cancelled";
  if (b.status === "ENQUIRY") return "Still an enquiry";
  if (b.hasAct === false) return "No act yet";
  if (b.arriveBy >= now) return "Not confirmed yet";
  return "Not confirmed";
}

/** A gig more than a day in the past that was never confirmed or cancelled. */
export function isUnresolvedPast(b: { status: string; demo: boolean; arriveBy: Date }, now = new Date()) {
  return !b.demo && UNRESOLVED_STATUSES.includes(b.status) && b.arriveBy.getTime() < now.getTime() - DAY;
}

/** Prisma filter for the same thing, for counting in the database. */
export function unresolvedPastWhere(now = new Date()) {
  return { demo: false, status: { in: UNRESOLVED_STATUSES }, arriveBy: { lt: new Date(now.getTime() - DAY) } };
}

/** "YYYY-MM" of the gig in the venue's time zone. */
export function gigMonth(b: { arriveBy: Date; timezone: string }) {
  return localDateKey(b.arriveBy, b.timezone).slice(0, 7);
}

/** The billable gigs in a month, sorted by reference. */
export function billableGigs<T extends BillableLike>(bookings: T[], month: string, now = new Date()): T[] {
  return bookings.filter((b) => isBillable(b, now) && gigMonth(b) === month).sort((a, b) => a.reference.localeCompare(b.reference));
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
