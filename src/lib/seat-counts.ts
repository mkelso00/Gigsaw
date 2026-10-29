import "server-only";
import { prisma } from "./db";
import { INTERNAL_ROLES } from "./seats";

/** How many internal users each business has (demo logins don't count). */
export async function internalUserCounts(agencyIds?: string[]): Promise<Map<string, number>> {
  const rows = await prisma.user.groupBy({
    by: ["agencyId"],
    where: { role: { in: INTERNAL_ROLES }, demo: false, agencyId: agencyIds ? { in: agencyIds } : { not: null } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.agencyId!, r._count._all]));
}
