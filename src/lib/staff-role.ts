import "server-only";
import { prisma } from "./db";

export type StaffRole = "ADMIN" | "AGENT";

/**
 * Make an internal user an admin (who can open Settings and manage users) or an agent. A business always keeps
 * at least one admin, so the last one can't be made an agent. Returns why not, or null when done.
 */
export async function setStaffRole(agencyId: string, userId: string, role: StaffRole): Promise<{ name: string } | { why: string }> {
  return prisma.$transaction(async (tx) => {
    // One change at a time per business, so two admins demoting each other can't leave it with none.
    await tx.$queryRaw`SELECT id FROM "Agency" WHERE id = ${agencyId} FOR UPDATE`;
    const u = await tx.user.findFirst({
      where: { id: userId, agencyId, role: { in: ["ADMIN", "AGENT"] }, demo: false },
      select: { id: true, name: true, role: true },
    });
    if (!u) return { why: "That person isn't on this business's team." };
    if (u.role === role) return { name: u.name };
    if (role === "AGENT") {
      const admins = await tx.user.count({ where: { agencyId, role: "ADMIN", demo: false } });
      if (admins <= 1) return { why: `${u.name} is the only admin, so make someone else an admin first.` };
    }
    await tx.user.update({ where: { id: u.id }, data: { role } });
    return { name: u.name };
  });
}
