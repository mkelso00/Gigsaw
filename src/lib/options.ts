import "server-only";
import { prisma } from "./db";
import { pickerNotes } from "./book-signed-up-server";
import { VENUE_ORDER } from "./venue-order";

/** Dropdown options used by the booking form. */
export async function bookingFormOptions(agencyId: string) {
  const [acts, venues, promoters, agents, notes] = await Promise.all([
    prisma.artist.findMany({ where: { agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.venue.findMany({ where: { agencyId }, orderBy: VENUE_ORDER, select: { id: true, name: true, city: true } }),
    prisma.contact.findMany({
      where: { agencyId, type: { in: ["PROMOTER", "CLIENT"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: true },
    }),
    prisma.user.findMany({ where: { agencyId, role: { in: ["ADMIN", "AGENT"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    pickerNotes(agencyId),
  ]);
  // "Not signed up" or "Approved" beside acts while the business only books acts who've signed up.
  const artists = acts.map((a) => ({ ...a, detail: notes.get(a.id) }));
  return { artists, venues, promoters, agents };
}
