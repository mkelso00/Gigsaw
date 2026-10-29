import "server-only";
import type { AgencyUser } from "./auth";
import { findClashes } from "./clash-check";
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
    const before = snapshotOf(b);
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
    await prisma.booking.update({ where: { id: b.id }, data: { ...schedule, feeMinor, ...cost } });
    await logActivity(
      user,
      "BOOKING",
      b.id,
      "updated with other gigs",
      [hasTimes || change.shiftMinutes ? "times" : "", change.fee ? "sale" : "", change.cost ? "cost" : ""].filter(Boolean).join(" and "),
    );
    updated++;
    if (change.notifyArtists) {
      const changes = await notifyArtistIfChanged(before, b.id);
      if (changes.length) notified++;
    }
    const warnings = await findClashes(
      { agencyId: user.agencyId, artistId: b.artistId, venueId: b.venueId, timezone: tz, excludeId: b.id, ...schedule },
      changeover,
    );
    if (warnings.length) mayClash.push(b.reference);
  }
  return { updated, notified, mayClash };
}
