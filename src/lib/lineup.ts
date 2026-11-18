// An act's line-up for one booking (BookingLineup): members off this gig (OUT) and stand-ins on it (IN).
// Everyone else in the act plays as usual. Plain functions, no database.

import type { Prisma } from "@prisma/client";

export type LineupChange = { personId: string; change: string };

/**
 * Whether a login sees a gig: a stand-in on it does; a member off it doesn't; otherwise it's down to the acts
 * the login can see (actIdsFor). An act's own login (no person) just goes by its acts.
 */
export function onGig(gig: { artistId: string | null; lineup?: LineupChange[] }, actIds: Iterable<string>, personId: string | null) {
  const mine = personId ? gig.lineup?.find((l) => l.personId === personId) : undefined;
  if (mine?.change === "IN") return true;
  if (mine?.change === "OUT") return false;
  return !!gig.artistId && [...actIds].includes(gig.artistId);
}

/** The same as a database filter on bookings: the login's acts' gigs, less ones they're off, plus ones they stand in on. */
export function gigsForLogin(actIds: string[], personId: string | null): Prisma.BookingWhereInput {
  if (!personId) return { artistId: { in: actIds } };
  return {
    OR: [{ artistId: { in: actIds }, NOT: { lineup: { some: { personId, change: "OUT" } } } }, { lineup: { some: { personId, change: "IN" } } }],
  };
}
