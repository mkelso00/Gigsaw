import "server-only";
import { prisma } from "./db";
import { OPEN_STATUSES } from "./proposals";
import { localDateKey } from "./time";

/**
 * Who becomes lead agent on something a person makes: someone else when they've said so on their Profile (an owner
 * who adds bookings but leaves the day-to-day, and the alerts, to the booking coordinator), otherwise themselves.
 * "Booked by" (createdById) is always the person who made it.
 */
export function leadAgentFor(user: { id: string; handOffToId?: string | null }): string {
  return user.handOffToId || user.id;
}

/** Someone on this business's team who can be a lead agent, or null. */
export async function teamMember(agencyId: string, userId: string) {
  return prisma.user.findFirst({ where: { id: userId, agencyId, role: { in: ["ADMIN", "AGENT"] }, demo: false }, select: { id: true, name: true } });
}

export type HandedOver = { bookings: number; events: number; proposals: number; acts: number };

/**
 * Move what one person is lead agent on to another: upcoming bookings and weddings or events that aren't cancelled,
 * proposals still being drafted or out with the customer, and their acts. Past work stays as it was.
 */
export async function handOverWork(agencyId: string, fromId: string, toId: string, timezone: string): Promise<HandedOver> {
  const today = localDateKey(new Date(), timezone);
  return prisma.$transaction(async (tx) => {
    const bookings = await tx.booking.updateMany({
      where: { agencyId, agentId: fromId, setStart: { gte: new Date() }, status: { not: "CANCELLED" } },
      data: { agentId: toId },
    });
    const events = await tx.event.updateMany({
      where: { agencyId, agentId: fromId, date: { gte: today }, status: { not: "CANCELLED" } },
      data: { agentId: toId },
    });
    const proposals = await tx.quote.updateMany({
      where: { agencyId, agentId: fromId, status: { in: ["DRAFT", ...OPEN_STATUSES] } },
      data: { agentId: toId },
    });
    const acts = await tx.artist.updateMany({ where: { agencyId, agentId: fromId }, data: { agentId: toId } });
    return { bookings: bookings.count, events: events.count, proposals: proposals.count, acts: acts.count };
  });
}
