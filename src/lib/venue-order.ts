import type { Prisma } from "@prisma/client";

/** Priority venues first, then A to Z: the order everywhere venues are listed or picked. */
export const VENUE_ORDER = [{ priority: "desc" }, { name: "asc" }] satisfies Prisma.VenueOrderByWithRelationInput[];
