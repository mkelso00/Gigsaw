import "server-only";
import type { Booking, Settings } from "@prisma/client";
import { createBookingsWithReferences } from "./bookings";
import { findClashes } from "./clash-check";
import { LIVE_STATUSES, MAX_COPY_DATES, type BookingStatus } from "./constants";
import { defaultVat } from "./money";
import { buildSchedule } from "./schedule";
import { formatDate, localTime } from "./time";

// Copying a booking to other dates, shared by "Copy" on a booking and "Repeat every week" on the
// quick booking form: the same venue, times (as clock times, so a clock change doesn't move them),
// money, act and details, as new bookings with no payments or check-ins.

/** The dates as a sorted list of real "YYYY-MM-DD" days, each once. */
export function cleanDates(dates: string[]) {
  return [...new Set(dates)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))).sort();
}

/** Clash checks run a few at a time: quick for 300 dates without flooding the database. */
const CHECKS_AT_ONCE = 10;

/**
 * Possible double bookings for the act on any of these dates, as "Sat 1 Feb 2027" style dates.
 * `times` are the booking's clock times, put on each date in its time zone.
 */
export async function clashDates(
  c: { agencyId: string; artistId: string; venueId: string | null; timezone: string },
  times: { arrive: string; soundcheck?: string | null; setStart: string; setEnd?: string | null },
  dates: string[],
  changeoverMinutes: number,
) {
  const found: string[] = [];
  for (let i = 0; i < dates.length; i += CHECKS_AT_ONCE) {
    const chunk = dates.slice(i, i + CHECKS_AT_ONCE);
    const results = await Promise.all(
      chunk.map(async (date) => {
        const schedule = buildSchedule(date, times, c.timezone);
        const w = await findClashes({ ...c, ...schedule }, changeoverMinutes);
        return w.length ? formatDate(schedule.arriveBy, c.timezone) : null;
      }),
    );
    found.push(...results.filter((d): d is string => !!d));
  }
  return found;
}

/**
 * Make the copies, all in one transaction (see createBookingsWithReferences). Returns the new ids
 * in date order and the dates the act may already be busy (checked, not refused: the person asked
 * for these dates). Messages to the act are the caller's job, so they go out once for everything.
 */
export async function copyBookingToDates(
  user: { id: string; agencyId: string },
  b: Booking,
  dates: string[],
  opts: { status: BookingStatus; artistId: string | null; settings: Settings },
) {
  const days = cleanDates(dates);
  if (days.length > MAX_COPY_DATES) throw new Error(`Copy up to ${MAX_COPY_DATES} dates at once`);
  const tz = b.timezone;
  const t = (d: Date | null) => (d ? localTime(d, tz) : null);
  const times = { arrive: t(b.arriveBy)!, soundcheck: t(b.soundcheckAt), setStart: t(b.setStart)!, setEnd: t(b.setEnd) };
  const clashes =
    opts.artistId && LIVE_STATUSES.includes(opts.status)
      ? await clashDates({ agencyId: user.agencyId, artistId: opts.artistId, venueId: b.venueId, timezone: tz }, times, days, opts.settings.changeoverMinutes)
      : [];
  const made = await createBookingsWithReferences(
    user.agencyId,
    days.map((date) => ({
      ...buildSchedule(date, times, tz),
      artistId: opts.artistId,
      venueId: b.venueId,
      promoterId: b.promoterId,
      agentId: b.agentId,
      createdById: user.id,
      status: opts.status,
      dealType: b.dealType,
      eventType: b.eventType,
      eventName: b.eventName,
      timezone: tz,
      currency: b.currency,
      feeMinor: b.feeMinor,
      artistFeeMinor: b.artistFeeMinor,
      commissionPct: b.commissionPct,
      // A booking from before VAT on sales was turned on has none: its copies are new bookings, so they get it.
      vatPct: b.vatPct || defaultVat(opts.settings),
      bookingFeeMinor: b.bookingFeeMinor,
      depositMinor: b.depositMinor,
      dealNotes: b.dealNotes,
      contractTemplateId: b.contractTemplateId,
      radiusKm: b.radiusKm,
      radiusDays: b.radiusDays,
      travel: b.travel,
      accommodation: b.accommodation,
      dayContact: b.dayContact,
      hospitality: b.hospitality,
      notes: b.notes,
      tags: b.tags,
      notifyClientOnArrival: b.notifyClientOnArrival,
      slotId: null,
      demo: b.demo,
    })),
  );
  return { ids: made.map((m) => m.id), clashes };
}
