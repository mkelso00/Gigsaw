import "server-only";
import { BILLABLE_STATUSES, billableGigs, monthSearchWindow } from "./billing";
import { prisma } from "./db";

export type Usage = { count: number; references: string[] };

/** Billable gigs per agency for a month ("YYYY-MM"). */
export async function usageForMonth(month: string, agencyId?: string): Promise<Map<string, Usage>> {
  const bookings = await prisma.booking.findMany({
    where: { ...(agencyId ? { agencyId } : {}), demo: false, status: { in: BILLABLE_STATUSES }, arriveBy: monthSearchWindow(month) },
    select: { agencyId: true, reference: true, status: true, demo: true, arriveBy: true, timezone: true },
  });
  const out = new Map<string, Usage>();
  for (const b of billableGigs(bookings, month)) {
    const u = out.get(b.agencyId) ?? { count: 0, references: [] };
    u.count++;
    u.references.push(b.reference);
    out.set(b.agencyId, u);
  }
  return out;
}
