import "server-only";
import { awayLine, type AwayBlock } from "./availability";
import { LIVE_STATUSES } from "./constants";
import { prisma } from "./db";
import { actTree } from "./people";
import { addDaysToKey, localDateKey, zonedToUtc } from "./time";

export type AwayEntry = AwayBlock & {
  /** The block's own id (shared by the copies made for bands). */
  id: string;
  /** The act that blocked the dates out, e.g. Graham McKee Solo. */
  actName: string;
  /** False for a copy on a band, because an act inside it is away. */
  own: boolean;
};

/**
 * Blocked-out days that touch these dates, for every act in the agency. A block on an act is
 * copied onto each band it is part of, so Wonderlust shows as away while Graham McKee Solo is.
 */
export async function awayBetween(agencyId: string, from: string, to: string): Promise<AwayEntry[]> {
  const rows = await prisma.artistUnavailability.findMany({
    where: { agencyId, startDate: { lte: to }, endDate: { gte: from } },
    include: { artist: { select: { name: true } } },
    orderBy: { startDate: "asc" },
  });
  if (!rows.length) return [];
  const tree = await actTree(agencyId);
  return rows.flatMap((r) =>
    [...tree.withBands([r.artistId])].map((id) => ({
      id: r.id,
      artistId: id,
      startDate: r.startDate,
      endDate: r.endDate,
      note: r.note,
      actName: r.artist.name,
      own: id === r.artistId,
    })),
  );
}

/**
 * A short note for each act that may not be free on a date, for pickers: "Away: Holiday" (or
 * "Away: Graham McKee Solo" for a band) when the day is blocked out, else "Has a gig" when the
 * act is already booked that day.
 */
export async function actHintsOn(agencyId: string, dateKey: string, timezone: string) {
  const [away, gigs] = await Promise.all([
    awayBetween(agencyId, dateKey, dateKey),
    prisma.booking.findMany({
      where: {
        agencyId,
        artistId: { not: null },
        status: { in: LIVE_STATUSES },
        arriveBy: { gte: zonedToUtc(addDaysToKey(dateKey, -1), "00:00", timezone), lt: zonedToUtc(addDaysToKey(dateKey, 2), "00:00", timezone) },
      },
      select: { artistId: true, arriveBy: true, timezone: true },
    }),
  ]);
  const out = new Map<string, { hint: string; tone: "away" | "busy" }>();
  for (const e of away) {
    if (out.has(e.artistId)) continue;
    const why = e.own ? e.note.trim() : e.actName;
    out.set(e.artistId, { hint: why ? `Away: ${why}` : "Away", tone: "away" });
  }
  for (const g of gigs) {
    if (g.artistId && !out.has(g.artistId) && localDateKey(g.arriveBy, g.timezone) === dateKey) out.set(g.artistId, { hint: "Has a booking", tone: "busy" });
  }
  return out;
}

/** Why an act can't play on a date: one line per block, naming the act inside a band when that's who is away. */
export async function awayReasons(agencyId: string, artistId: string, dateKey: string) {
  const entries = (await awayBetween(agencyId, dateKey, dateKey)).filter((e) => e.artistId === artistId);
  if (!entries.length) return [];
  const actName = (await prisma.artist.findFirst({ where: { id: artistId, agencyId }, select: { name: true } }))?.name ?? "This act";
  return entries.map((e) => awayLine(actName, e));
}
