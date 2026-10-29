import "server-only";
import { prisma } from "./db";

/** Dropdown options used by the booking form. */
export async function bookingFormOptions(agencyId: string) {
  const [artists, venues, promoters, agents] = await Promise.all([
    prisma.artist.findMany({ where: { agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.venue.findMany({ where: { agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true, city: true } }),
    prisma.contact.findMany({
      where: { agencyId, type: { in: ["PROMOTER", "CLIENT"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: true },
    }),
    prisma.user.findMany({ where: { agencyId, role: { in: ["ADMIN", "AGENT"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { artists, venues, promoters, agents };
}
