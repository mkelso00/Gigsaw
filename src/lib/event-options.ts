import "server-only";
import { prisma } from "./db";
import { VENUE_ORDER } from "./venue-order";

/** Customers, venues and lead agents offered on the wedding/event form. Private customers come first. */
export async function eventFormOptions(agencyId: string) {
  const [contacts, venues, agents] = await Promise.all([
    prisma.contact.findMany({ where: { agencyId }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, company: true, type: true } }),
    prisma.venue.findMany({ where: { agencyId }, orderBy: VENUE_ORDER, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { agencyId, role: { in: ["ADMIN", "AGENT"] }, demo: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const clients = contacts.filter((c) => c.type === "CLIENT");
  const others = contacts.filter((c) => c.type !== "CLIENT");
  return {
    customers: [...clients, ...others].map((c) => ({ id: c.id, name: c.type === "CLIENT" ? c.name : `${c.name}${c.company ? ` (${c.company})` : ""}` })),
    venues,
    agents,
  };
}
