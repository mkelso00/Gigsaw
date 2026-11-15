import "server-only";
import type { Booking, Prisma } from "@prisma/client";
import type { AgencyUser } from "./auth";
import type { parseBookingForm } from "./bookings";
import { saveAndTell } from "./bulk";
import { getSettings, logActivity, prisma } from "./db";
import { dealBreakdown } from "./money";
import { buildSchedule } from "./schedule";
import { localDateKey, localTime } from "./time";

// Editing one booking and copying the changes to the venue's other bookings, e.g. new parking notes or a
// later start for every upcoming Wednesday at The Swan. Only what was changed in that save is copied, and
// only things that make sense on another booking: times (as clock times on each booking's own date),
// itinerary notes, money notes, and the sale and cost where that's safe (see moneyFits). The act, date,
// status and venue of the other bookings never change.

export const VENUE_SCOPES = ["ONE", "ALL", "WEEKDAY"] as const;
export type VenueScope = (typeof VENUE_SCOPES)[number];

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The day of the week of a gig (0 = Sunday), on its own date in its own time zone. */
function weekdayOf(b: { arriveBy: Date; timezone: string }) {
  return new Date(`${localDateKey(b.arriveBy, b.timezone)}T12:00:00Z`).getUTCDay();
}

/** "Wednesday", for the panel and the confirmation. */
export function weekdayName(b: { arriveBy: Date; timezone: string }) {
  return WEEKDAY_NAMES[weekdayOf(b)];
}

/** Itinerary and note fields copied as they are, with how they're named to the user. */
const TEXT_FIELDS = [
  ["travel", "travel"],
  ["accommodation", "accommodation"],
  ["dayContact", "day of show contact"],
  ["hospitality", "hospitality"],
  ["notes", "internal notes"],
  ["dealNotes", "money notes"],
] as const;
type TextField = (typeof TEXT_FIELDS)[number][0];

const TIME_FIELDS = [
  ["arrive", "arrive by"],
  ["soundcheck", "soundcheck"],
  ["setStart", "start time"],
  ["setEnd", "finish time"],
] as const;
type TimeField = (typeof TIME_FIELDS)[number][0];

type Parsed = Awaited<ReturnType<typeof parseBookingForm>>;

/** What this save changed that can go to other bookings. A time of null means it was cleared. */
export type VenueChange = {
  times: Partial<Record<TimeField, string | null>>;
  text: Partial<Record<TextField, string>>;
  sale?: number;
  cost?: number | null;
  currency: string;
  /** Changed, but can't be copied: the currency changed too, so the amounts mean something else elsewhere. */
  moneyHeldBack: boolean;
  /** In words, in form order: "start time", "travel". */
  labels: string[];
};

// Browsers send a textarea's new lines as \r\n; a booking saved some other way may have \n.
const same = (a: string, b: string) => a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");

/** Compare the booking as stored with what the form now holds. */
export function changedForVenue(old: Booking, data: Parsed): VenueChange {
  const clock = (d: Date | null, tz: string) => (d ? localTime(d, tz) : null);
  const before: Record<TimeField, string | null> = {
    arrive: clock(old.arriveBy, old.timezone),
    soundcheck: clock(old.soundcheckAt, old.timezone),
    setStart: clock(old.setStart, old.timezone),
    setEnd: clock(old.setEnd, old.timezone),
  };
  const after: Record<TimeField, string | null> = {
    arrive: clock(data.arriveBy, data.timezone),
    soundcheck: clock(data.soundcheckAt, data.timezone),
    setStart: clock(data.setStart, data.timezone),
    setEnd: clock(data.setEnd, data.timezone),
  };
  const change: VenueChange = { times: {}, text: {}, currency: data.currency, moneyHeldBack: false, labels: [] };
  for (const [k, label] of TIME_FIELDS) {
    if (before[k] === after[k]) continue;
    change.times[k] = after[k];
    change.labels.push(label);
  }
  // The form always saves a sale and cost deal and shows other deals' cost as what the act is paid, so compare with that.
  const oldCost = old.dealType === "BUY_SELL" ? old.artistFeeMinor : dealBreakdown(old).artistMinor;
  const saleChanged = data.feeMinor !== old.feeMinor;
  const costChanged = (data.artistFeeMinor ?? 0) !== (oldCost ?? 0);
  if ((saleChanged || costChanged) && data.currency !== old.currency) change.moneyHeldBack = true;
  else {
    if (saleChanged) {
      change.sale = data.feeMinor;
      change.labels.push("sale");
    }
    if (costChanged) {
      change.cost = data.artistFeeMinor;
      change.labels.push("cost");
    }
  }
  for (const [k, label] of TEXT_FIELDS) {
    if (same(old[k], data[k])) continue;
    change.text[k] = data[k];
    change.labels.push(label);
  }
  return change;
}

type Source = Pick<Booking, "id" | "agencyId" | "venueId" | "arriveBy" | "timezone">;

/**
 * The venue's other bookings a change would reach: upcoming (not started yet), not archived, cancelled
 * or settled, and for WEEKDAY only those on the same day of the week as this one.
 */
export async function venueTargets(source: Source, scope: VenueScope, now = new Date()) {
  if (scope === "ONE" || !source.venueId) return [];
  const all = await prisma.booking.findMany({
    where: {
      agencyId: source.agencyId,
      venueId: source.venueId,
      id: { not: source.id },
      archivedAt: null,
      status: { notIn: ["CANCELLED", "SETTLED"] },
      setStart: { gt: now },
    },
    include: { venue: { select: { name: true } }, _count: { select: { payments: true } } },
    orderBy: { arriveBy: "asc" },
  });
  if (scope === "ALL") return all;
  const day = weekdayOf(source);
  return all.filter((b) => weekdayOf(b) === day);
}

/** How many bookings each choice in the edit form would change, for the panel's labels. */
export async function venueScopeCounts(source: Source, now = new Date()) {
  const all = await venueTargets(source, "ALL", now);
  const day = weekdayOf(source);
  return { all: all.length, weekday: all.filter((b) => weekdayOf(b) === day).length, weekdayName: WEEKDAY_NAMES[day] };
}

type Target = Awaited<ReturnType<typeof venueTargets>>[number];

/**
 * Sale and cost only go to a booking in the same currency (the amount was typed in it), with no payments
 * logged yet (money has already moved, so its price is changed by hand), and whose deposit still fits
 * within the new sale.
 */
function moneyFits(b: Target, change: VenueChange) {
  if (b.currency !== change.currency || b._count.payments > 0) return false;
  if (change.sale !== undefined && change.sale > 0 && b.depositMinor > change.sale + b.bookingFeeMinor) return false;
  return true;
}

/** A gig that starts more than 12 hours after its call time, or ends more than 12 hours after it starts. */
const lopsided = (s: { arriveBy: Date; setStart: Date; setEnd: Date | null }) =>
  s.setStart.getTime() - s.arriveBy.getTime() > 12 * 3_600_000 || (!!s.setEnd && s.setEnd.getTime() - s.setStart.getTime() > 12 * 3_600_000);

/** The new fields for one of the other bookings, and what had to be left as it was. */
function updateFor(b: Target, change: VenueChange) {
  const data: Prisma.BookingUncheckedUpdateInput = { ...change.text };
  let schedule: ReturnType<typeof buildSchedule> | undefined;
  let timesKept = false;
  let moneyKept = false;
  if (Object.keys(change.times).length) {
    const tz = b.timezone;
    const own = (k: TimeField, d: Date | null) => (k in change.times ? change.times[k] : d ? localTime(d, tz) : null);
    const next = buildSchedule(
      localDateKey(b.arriveBy, tz),
      {
        arrive: own("arrive", b.arriveBy)!,
        soundcheck: own("soundcheck", b.soundcheckAt),
        setStart: own("setStart", b.setStart)!,
        setEnd: own("setEnd", b.setEnd),
      },
      tz,
    );
    // A new start before this booking's own (unchanged) arrive by would roll the gig into the next day: keep its times.
    if (lopsided(next) && !lopsided(b)) timesKept = true;
    else {
      schedule = next;
      Object.assign(data, next);
    }
  }
  if (change.sale !== undefined || change.cost !== undefined) {
    if (!moneyFits(b, change)) moneyKept = true;
    else {
      if (change.sale !== undefined) data.feeMinor = change.sale;
      // As the form and bulk edit do: a cost makes it a sale and cost deal.
      if (change.cost !== undefined) Object.assign(data, { dealType: "BUY_SELL", artistFeeMinor: change.cost });
    }
  }
  return { data, schedule, timesKept, moneyKept };
}

export type VenuePlan = ReturnType<typeof planFor>;

function planFor(change: VenueChange, targets: Target[]) {
  const rows = targets.map((b) => ({ booking: b, ...updateFor(b, change) }));
  return { change, rows, timesKept: rows.filter((r) => r.timesKept).map((r) => r.booking.reference), moneyKept: rows.filter((r) => r.moneyKept).length };
}

/** Work out what copying this save to the venue's other bookings would do, without changing anything. */
export async function planVenueChange(old: Booking, data: Parsed, scope: VenueScope, now = new Date()) {
  return planFor(changedForVenue(old, data), await venueTargets(old, scope, now));
}

/** "a", "a and b", "a, b and c". */
export function joinWords(words: string[]) {
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "47 upcoming bookings at The Swan" or "12 upcoming Wednesdays at The Swan". */
export function scopeWords(n: number, scope: VenueScope, venueName: string, weekday: string) {
  return `${n} upcoming ${scope === "WEEKDAY" ? weekday : "booking"}${n === 1 ? "" : "s"} at ${venueName}`;
}

/** The question asked before copying, in the app's confirm box ("Save anyway" style). */
export function venueConfirm(plan: VenuePlan, opts: { scope: VenueScope; venueName: string; weekday: string; notify: boolean }) {
  const n = plan.rows.length;
  const what = joinWords(plan.change.labels);
  const items = [`Each booking keeps its own date, act and status. This booking is saved too, so ${plural(n + 1, "booking")} change in all.`];
  if (Object.keys(plan.change.times).length) {
    items.push(
      opts.notify
        ? "Times are set on each booking's own date in the venue's time. Acts get a message about their new times."
        : "Times are set on each booking's own date in the venue's time. Acts won't be told, as you've unticked Let the artist know.",
    );
  }
  if (plan.timesKept.length) {
    const refs = plan.timesKept;
    items.push(
      `${joinWords(refs.slice(0, 5))}${refs.length > 5 ? ` and ${refs.length - 5} more` : ""} keep their times: the new times would move them into the next day.`,
    );
  }
  if (plan.moneyKept)
    items.push(`Sale and cost stay as they are on ${plural(plan.moneyKept, "booking")} with payments logged, another currency or a bigger deposit.`);
  return {
    title: `Change ${what} on ${n} other upcoming ${opts.scope === "WEEKDAY" ? opts.weekday : "booking"}${n === 1 ? "" : "s"} at ${opts.venueName}?`,
    items,
    button: `Change ${plural(n + 1, "booking")}`,
  };
}

/** Copy the change to the other bookings, telling acts as bulk edit does, and log it once on this booking. */
export async function applyVenuePlan(
  user: AgencyUser,
  sourceId: string,
  plan: VenuePlan,
  opts: { scope: VenueScope; venueName: string; weekday: string; notify: boolean },
) {
  const changeover = (await getSettings(user.agencyId)).changeoverMinutes;
  let notified = 0;
  const mayClash: string[] = [];
  for (const r of plan.rows) {
    if (!Object.keys(r.data).length) continue;
    const res = await saveAndTell(r.booking, r.data, { agencyId: user.agencyId, notify: opts.notify, changeover, schedule: r.schedule });
    if (res.told) notified++;
    if (res.mayClash) mayClash.push(r.booking.reference);
  }
  const n = plan.rows.length;
  await logActivity(
    user,
    "BOOKING",
    sourceId,
    "changed other bookings too",
    `${joinWords(plan.change.labels)} on ${scopeWords(n, opts.scope, opts.venueName, opts.weekday)}${plan.timesKept.length ? ` (times kept on ${plan.timesKept.join(", ")})` : ""}${
      plan.moneyKept ? ` (money kept on ${plural(plan.moneyKept, "booking")})` : ""
    }${mayClash.length ? `. May clash: ${mayClash.join(", ")}` : ""}`,
  );
  return { updated: n, notified, mayClash };
}
