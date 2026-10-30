import "server-only";
import { prisma } from "./db";
import { dateInWeek, weekStartOf } from "./rota";
import { addDaysToKey, localDateKey, zonedToUtc } from "./time";

// The venue's read-only line-up page and calendar feed.
// Only the fields below are ever read, so fees, deals, promoters and contact details
// can't end up on the page by accident.

const SHOWN_STATUSES = ["HOLD", "PENDING", "CONFIRMED", "SETTLED"];

export type LineupEntry =
  | {
      kind: "booking";
      id: string;
      start: Date;
      end: Date | null;
      arriveBy: Date;
      artist: string;
      genre: string;
      act: string;
      provisional: boolean;
      arrivedAt: Date | null;
    }
  | { kind: "open"; slotId: string; start: Date; end: Date; act: string };

export async function findSharedVenue(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const venue = await prisma.venue.findUnique({
    where: { shareToken: token },
    select: {
      id: true,
      name: true,
      city: true,
      timezone: true,
      agencyId: true,
      agency: { select: { status: true, name: true, settings: { select: { agencyName: true, agencyEmail: true } } } },
    },
  });
  if (!venue || venue.agency.status !== "ACTIVE") return null;
  return venue;
}

/** Gigs (and still-empty weekly slots) at a venue from today for `weeks` weeks, grouped by local date. */
export async function venueLineup(venue: { id: string; agencyId: string; timezone: string }, weeks = 8) {
  const tz = venue.timezone;
  const today = localDateKey(new Date(), tz);
  const until = addDaysToKey(today, weeks * 7);
  const [bookings, slots] = await Promise.all([
    prisma.booking.findMany({
      where: {
        agencyId: venue.agencyId,
        venueId: venue.id,
        status: { in: SHOWN_STATUSES },
        arriveBy: { gte: zonedToUtc(today, "00:00", tz), lt: zonedToUtc(until, "00:00", tz) },
      },
      select: {
        id: true,
        status: true,
        arriveBy: true,
        setStart: true,
        setEnd: true,
        eventName: true,
        slotId: true,
        artist: { select: { name: true, genre: true } },
        checkIns: { where: { kind: "ARRIVED" }, select: { at: true }, orderBy: { at: "asc" }, take: 1 },
      },
      orderBy: { setStart: "asc" },
    }),
    prisma.venueSlot.findMany({
      where: { venueId: venue.id, agencyId: venue.agencyId, active: true },
      select: { id: true, weekday: true, startTime: true, endTime: true, label: true },
    }),
  ]);

  const days = new Map<string, LineupEntry[]>();
  const add = (key: string, e: LineupEntry) => days.set(key, [...(days.get(key) ?? []), e]);
  const filled = new Set<string>();
  for (const b of bookings) {
    const key = localDateKey(b.arriveBy, tz);
    if (b.slotId) filled.add(`${b.slotId}|${key}`);
    add(key, {
      kind: "booking",
      id: b.id,
      start: b.setStart,
      end: b.setEnd,
      arriveBy: b.arriveBy,
      artist: b.artist?.name ?? "To be confirmed",
      genre: b.artist?.genre ?? "",
      act: b.eventName,
      provisional: b.status === "HOLD" || b.status === "PENDING",
      arrivedAt: b.checkIns[0]?.at ?? null,
    });
  }
  // Weekly slots with nobody booked yet show as "to be confirmed".
  for (let monday = weekStartOf(today); monday < until; monday = addDaysToKey(monday, 7)) {
    for (const s of slots) {
      const key = dateInWeek(monday, s.weekday);
      if (key < today || key >= until || filled.has(`${s.id}|${key}`)) continue;
      const start = zonedToUtc(key, s.startTime, tz);
      let end = zonedToUtc(key, s.endTime, tz);
      if (end <= start) end = zonedToUtc(addDaysToKey(key, 1), s.endTime, tz);
      add(key, { kind: "open", slotId: s.id, start, end, act: s.label });
    }
  }
  for (const list of days.values()) list.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { today, days: [...days].sort((a, b) => a[0].localeCompare(b[0])) };
}
