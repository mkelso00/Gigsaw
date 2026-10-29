import { PrismaClient } from "@prisma/client";

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function getSettings() {
  return prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export async function logActivity(
  userId: string | null,
  entity: string,
  entityId: string,
  action: string,
  detail = "",
) {
  await prisma.activity.create({ data: { userId, entity, entityId, action, detail } });
}
