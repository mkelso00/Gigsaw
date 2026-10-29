import { PrismaClient } from "@prisma/client";

// Archived bookings are left out of every booking query unless the query asks about archivedAt
// itself (e.g. the Archived list, or billing, which counts them).
const HIDE_ARCHIVED = ["findMany", "findFirst", "findFirstOrThrow", "count", "groupBy", "aggregate", "updateMany"] as const;

function makeClient() {
  return new PrismaClient().$extends({
    query: {
      booking: Object.fromEntries(
        HIDE_ARCHIVED.map((op) => [
          op,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ({ args, query }: { args: any; query: (a: any) => Promise<unknown> }) => {
            const where = args.where ?? {};
            // A lookup of one booking by its id (its page, an action on it) still finds it.
            if (!("archivedAt" in where) && typeof where.id !== "string") args.where = { ...where, archivedAt: null };
            return query(args);
          },
        ]),
      ),
    },
  });
}

type Client = ReturnType<typeof makeClient>;

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: Client };

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** An agency's settings, created with defaults the first time they're needed. */
export async function getSettings(agencyId: string) {
  // Read first: almost every page needs these, and a read is one query where the upsert is a
  // transaction of several.
  return (await prisma.settings.findUnique({ where: { agencyId } })) ?? prisma.settings.upsert({ where: { agencyId }, update: {}, create: { agencyId } });
}

export async function logActivity(user: { id: string; agencyId: string | null } | null, entity: string, entityId: string, action: string, detail = "") {
  await prisma.activity.create({ data: { userId: user?.id ?? null, agencyId: user?.agencyId ?? null, entity, entityId, action, detail } });
}
