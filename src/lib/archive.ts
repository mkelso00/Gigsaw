// Checks that must see archived bookings too. The client in db.ts hides archived bookings from
// most queries, so a guard like "does this act still have bookings?" would pass while archived
// ones still point at it; `archivedAt: undefined` switches that filter off.

import type { prisma as appPrisma } from "./db";

type Db = Pick<typeof appPrisma, "booking">;

/** Every booking an act has, and how many of those are archived. */
export async function actBookingCounts(db: Db, artistId: string) {
  const [total, archived] = await Promise.all([
    db.booking.count({ where: { artistId, archivedAt: undefined } }),
    db.booking.count({ where: { artistId, archivedAt: { not: null } } }),
  ]);
  return { total, archived };
}

/** Why an act can't be deleted yet, or null when nothing points at it. */
export function actInUseMessage({ total, archived }: { total: number; archived: number }) {
  if (!total) return null;
  const count = `${total} booking${total === 1 ? "" : "s"}${archived ? `, including ${archived} archived` : ""}`;
  return `This act has ${count}. Delete or reassign them first.`;
}
