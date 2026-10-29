import "server-only";
import { prisma } from "./db";

/** Dropdown options used by the booking form. */
export async function bookingFormOptions() {
  const [artists, venues, promoters, agents] = await Promise.all([
    prisma.artist.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.venue.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, city: true } }),
    prisma.contact.findMany({
      where: { type: { in: ["PROMOTER", "CLIENT"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: true },
    }),
    prisma.user.findMany({ where: { role: { in: ["ADMIN", "AGENT"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { artists, venues, promoters, agents };
}
