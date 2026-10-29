import { PrismaClient } from "@prisma/client";

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** An agency's settings, created with defaults the first time they're needed. */
export async function getSettings(agencyId: string) {
  return prisma.settings.upsert({ where: { agencyId }, update: {}, create: { agencyId } });
}

export async function logActivity(
  user: { id: string; agencyId: string | null } | null,
  entity: string,
  entityId: string,
  action: string,
  detail = "",
) {
  await prisma.activity.create({ data: { userId: user?.id ?? null, agencyId: user?.agencyId ?? null, entity, entityId, action, detail } });
}
