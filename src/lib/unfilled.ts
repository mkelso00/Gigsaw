import "server-only";
import { prisma } from "./db";
import { dateInWeek, weekStartOf } from "./rota";
import { addDaysToKey, localDateKey, zonedToUtc } from "./time";

export type UnfilledSlot = {
  date: string;
  slot: { id: string; weekday: number; label: string; startTime: string; endTime: string; artistId: string | null; venue: { id: string; name: string; city: string; colour: string } };
};

/**
 * Weekly venue slots with nobody booked, from today for `days` days, soonest first.
 * These are the gigs most likely to be forgotten.
 */
export async function unfilledSlots(agencyId: string, timezone: string, days: number): Promise<UnfilledSlot[]> {
  const today = localDateKey(new Date(), timezone);
  const until = addDaysToKey(today, days);
  const slots = await prisma.venueSlot.findMany({
    where: { agencyId, active: true },
    select: {
      id: true,
      weekday: true,
      label: true,
      startTime: true,
      endTime: true,
      artistId: true,
      venue: { select: { id: true, name: true, city: true, colour: true, timezone: true } },
    },
  });
  if (!slots.length) return [];
  const booked = await prisma.booking.findMany({
    where: {
      agencyId,
      slotId: { in: slots.map((s) => s.id) },
      status: { not: "CANCELLED" },
      arriveBy: { gte: zonedToUtc(addDaysToKey(today, -1), "00:00", timezone), lt: zonedToUtc(addDaysToKey(until, 1), "00:00", timezone) },
    },
    select: { slotId: true, arriveBy: true, timezone: true },
  });
  const filled = new Set(booked.map((b) => `${b.slotId}|${localDateKey(b.arriveBy, b.timezone)}`));
  const out: UnfilledSlot[] = [];
  for (let monday = weekStartOf(today); monday < until; monday = addDaysToKey(monday, 7)) {
    for (const s of slots) {
      const date = dateInWeek(monday, s.weekday);
      if (date < today || date >= until || filled.has(`${s.id}|${date}`)) continue;
      out.push({ date, slot: s });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.slot.startTime.localeCompare(b.slot.startTime) || a.slot.venue.name.localeCompare(b.slot.venue.name));
}
