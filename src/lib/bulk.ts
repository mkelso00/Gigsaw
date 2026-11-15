import "server-only";
import type { Booking, Prisma } from "@prisma/client";
import type { AgencyUser } from "./auth";
import { findClashes } from "./clash-check";
import { queueCalendarSync } from "./calendar-sync/queue";
import { getSettings, logActivity, prisma } from "./db";
import { FormError } from "./forms";
import { toMinor } from "./money";
import { notifyArtistIfChanged, snapshotOf } from "./notify";
import { buildSchedule, shiftSchedule } from "./schedule";
import { localDateKey, localTime } from "./time";

export type BulkChange = {
  /** New local times. Any left out keep their current value. */
  times?: { arrive?: string; soundcheck?: string; setStart?: string; setEnd?: string };
  /** Or: move every time by this many minutes. */
  shiftMinutes?: number;
  /** New fee (sale) as typed, applied in each booking's own currency. */
  fee?: string;
  /** New cost (the act's fee) as typed; makes each gig a sale and cost deal. */
  cost?: string;
  notifyArtists: boolean;
};

/** Apply the same change to several of the agency's bookings, telling artists if asked. */
export async function applyBulkChange(user: AgencyUser, bookingIds: string[], change: BulkChange) {
  const hasTimes = !!change.times && Object.values(change.times).some(Boolean);
  if (hasTimes && change.shiftMinutes) throw new FormError("Either set new times or move times by some minutes, not both");
  if (!hasTimes && !change.shiftMinutes && !change.fee && !change.cost)
    throw new FormError("Nothing to change: set new times, a shift, a new sale or a new cost");

  const bookings = await prisma.booking.findMany({
    where: { id: { in: bookingIds.slice(0, 500) }, agencyId: user.agencyId },
    include: { venue: { select: { name: true } } },
  });
  let updated = 0;
  let notified = 0;
  const mayClash: string[] = [];
  const changeover = (await getSettings(user.agencyId)).changeoverMinutes;
  for (const b of bookings) {
    const tz = b.timezone;
    let schedule = { arriveBy: b.arriveBy, soundcheckAt: b.soundcheckAt, setStart: b.setStart, setEnd: b.setEnd };
    if (change.shiftMinutes) {
      schedule = shiftSchedule(schedule, change.shiftMinutes);
    } else if (hasTimes) {
      const t = change.times!;
      schedule = buildSchedule(
        localDateKey(b.arriveBy, tz),
        {
          arrive: t.arrive || localTime(b.arriveBy, tz),
          soundcheck: t.soundcheck || (b.soundcheckAt ? localTime(b.soundcheckAt, tz) : null),
          setStart: t.setStart || localTime(b.setStart, tz),
          setEnd: t.setEnd || (b.setEnd ? localTime(b.setEnd, tz) : null),
        },
        tz,
      );
    }
    let feeMinor = b.feeMinor;
    if (change.fee) {
      try {
        feeMinor = toMinor(change.fee, b.currency);
      } catch {
        throw new FormError("Enter the fee as a number, like 150.00");
      }
      if (feeMinor < 0) throw new FormError("The fee can't be negative");
    }
    let cost: { dealType: string; artistFeeMinor: number } | object = {};
    if (change.cost) {
      let artistFeeMinor: number;
      try {
        artistFeeMinor = toMinor(change.cost, b.currency);
      } catch {
        throw new FormError("Enter the cost as a number, like 120.00");
      }
      if (artistFeeMinor < 0) throw new FormError("The cost can't be negative");
      cost = { dealType: "BUY_SELL", artistFeeMinor };
    }
    const res = await saveAndTell(b, { ...schedule, feeMinor, ...cost }, { agencyId: user.agencyId, notify: change.notifyArtists, changeover, schedule });
    await logActivity(
      user,
      "BOOKING",
      b.id,
      "updated with other bookings",
      [hasTimes || change.shiftMinutes ? "times" : "", change.fee ? "sale" : "", change.cost ? "cost" : ""].filter(Boolean).join(" and "),
    );
    updated++;
    if (res.told) notified++;
    if (res.mayClash) mayClash.push(b.reference);
  }
  return { updated, notified, mayClash };
}

type Schedule = { arriveBy: Date; soundcheckAt: Date | null; setStart: Date; setEnd: Date | null };

/**
 * Save new fields on one booking that's being changed along with others, then bring the act's connected
 * calendars up to date and, if asked, tell the act what changed. Every way of changing several bookings at
 * once goes through here, so acts hear about it the same way whichever page it was done from.
 * Pass `schedule` (the booking's times after the change) to check the act isn't double booked by them.
 */
export async function saveAndTell(
  b: Booking & { venue: { name: string } | null },
  data: Prisma.BookingUncheckedUpdateInput,
  opts: { agencyId: string; notify: boolean; changeover: number; schedule?: Schedule },
) {
  const before = snapshotOf(b);
  await prisma.booking.update({ where: { id: b.id }, data });
  queueCalendarSync(b.id);
  const told = opts.notify ? (await notifyArtistIfChanged(before, b.id)).length > 0 : false;
  const warnings = opts.schedule
    ? await findClashes(
        { agencyId: opts.agencyId, artistId: b.artistId, venueId: b.venueId, timezone: b.timezone, excludeId: b.id, ...opts.schedule },
        opts.changeover,
      )
    : [];
  return { told, mayClash: warnings.length > 0 };
}
