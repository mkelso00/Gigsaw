import "server-only";
import { billableGigs, monthSearchWindow } from "./billing";
import { prisma } from "./db";

export type Usage = { count: number; references: string[] };

/** Billable gigs per agency for a month ("YYYY-MM"). */
export async function usageForMonth(month: string, agencyId?: string): Promise<Map<string, Usage>> {
  const bookings = await prisma.booking.findMany({
    // Archived gigs still count: archiving tidies a booking away, it doesn't undo a gig that happened.
    where: { ...(agencyId ? { agencyId } : {}), demo: false, status: { not: "CANCELLED" }, arriveBy: monthSearchWindow(month), archivedAt: undefined },
    select: {
      agencyId: true,
      reference: true,
      status: true,
      demo: true,
      arriveBy: true,
      timezone: true,
      artistId: true,
      checkIns: { where: { kind: "ARRIVED" }, select: { id: true }, take: 1 },
    },
  });
  const rows = bookings.map((b) => ({ ...b, arrived: b.checkIns.length > 0, hasAct: !!b.artistId }));
  const out = new Map<string, Usage>();
  for (const b of billableGigs(rows, month)) {
    const u = out.get(b.agencyId) ?? { count: 0, references: [] };
    u.count++;
    u.references.push(b.reference);
    out.set(b.agencyId, u);
  }
  return out;
}
