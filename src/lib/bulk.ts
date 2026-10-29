import "server-only";
import type { AgencyUser } from "./auth";
import { logActivity, prisma } from "./db";
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
  /** New fee as typed, applied in each booking's own currency. */
  fee?: string;
  notifyArtists: boolean;
};

/** Apply the same change to several of the agency's bookings, telling artists if asked. */
export async function applyBulkChange(user: AgencyUser, bookingIds: string[], change: BulkChange) {
  const hasTimes = !!change.times && Object.values(change.times).some(Boolean);
  if (hasTimes && change.shiftMinutes) throw new FormError("Either set new times or move times by some minutes, not both");
  if (!hasTimes && !change.shiftMinutes && !change.fee) throw new FormError("Nothing to change: set new times, a shift or a new fee");

  const bookings = await prisma.booking.findMany({
    where: { id: { in: bookingIds.slice(0, 500) }, agencyId: user.agencyId },
    include: { venue: { select: { name: true } } },
  });
  let updated = 0;
  let notified = 0;
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
    await prisma.booking.update({ where: { id: b.id }, data: { ...schedule, feeMinor } });
    await logActivity(user, "BOOKING", b.id, "updated with other gigs", [hasTimes || change.shiftMinutes ? "times" : "", change.fee ? "fee" : ""].filter(Boolean).join(" and "));
    updated++;
    if (change.notifyArtists) {
      const changes = await notifyArtistIfChanged(before, b.id);
      if (changes.length) notified++;
    }
  }
  return { updated, notified };
}
