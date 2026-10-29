import "server-only";
import { describeAssessment, assessPair, type ClashAssessment } from "./clash";
import { LIVE_STATUSES } from "./constants";
import { prisma } from "./db";
import { linkedActIds, sharedMembers } from "./people";
import { formatDate, localTime } from "./time";

export type Candidate = {
  agencyId: string;
  artistId: string;
  venueId: string | null;
  arriveBy: Date;
  setStart: Date;
  setEnd: Date | null;
  timezone: string;
  /** The booking being edited, so it isn't compared with itself. */
  excludeId?: string;
};

export type ClashWarning = { level: "clash" | "tight"; text: string; assessment: ClashAssessment };

const DAY = 86_400_000;

/**
 * Other live gigs for the same artist that overlap the candidate or leave too little time to
 * travel between them. Gigs with plenty of time in between are not returned.
 */
export async function findClashes(c: Candidate, changeoverMinutes: number): Promise<ClashWarning[]> {
  // Check this act's other gigs, and gigs for any other act that shares a member with it.
  const actIds = await linkedActIds(c.artistId);
  const [venue, others] = await Promise.all([
    c.venueId
      ? prisma.venue.findFirst({ where: { id: c.venueId, agencyId: c.agencyId }, select: { id: true, name: true, latitude: true, longitude: true } })
      : null,
    prisma.booking.findMany({
      where: {
        agencyId: c.agencyId,
        artistId: { in: actIds },
        status: { in: LIVE_STATUSES },
        ...(c.excludeId ? { id: { not: c.excludeId } } : {}),
        arriveBy: { gte: new Date(c.arriveBy.getTime() - DAY), lte: new Date(c.arriveBy.getTime() + DAY) },
      },
      select: {
        id: true,
        arriveBy: true,
        setStart: true,
        setEnd: true,
        timezone: true,
        artistId: true,
        artist: { select: { name: true } },
        venue: { select: { id: true, name: true, city: true, latitude: true, longitude: true } },
      },
    }),
  ]);
  const out: ClashWarning[] = [];
  for (const o of others) {
    const a = assessPair({ arriveBy: c.arriveBy, setStart: c.setStart, setEnd: c.setEnd, venue }, o, changeoverMinutes);
    if (a.level === "ok") continue;
    const where = o.venue ? `${o.venue.name}${o.venue.city ? `, ${o.venue.city}` : ""}` : "another gig";
    const when = `${formatDate(o.arriveBy, o.timezone)}, ${localTime(o.setStart, o.timezone)}${o.setEnd ? `–${localTime(o.setEnd, o.timezone)}` : ""}`;
    let who = `${o.artist.name} is`;
    if (o.artistId !== c.artistId) {
      const names = await sharedMembers(c.artistId, o.artistId);
      who = names.includes(o.artist.name)
        ? `${o.artist.name} (a member of this act) is`
        : `${names.join(" and ") || "A member"} (with ${o.artist.name}) ${names.length > 1 ? "are" : "is"}`;
    }
    out.push({ level: a.level, assessment: a, text: `${who} also booked at ${where} (${when}). ${describeAssessment(a)}` });
  }
  return out;
}
