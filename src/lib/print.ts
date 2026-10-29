import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "./auth";
import { getSettings, prisma } from "./db";
import { actIdsFor } from "./people";

/** Load a booking for a printable document. Artists may only open their own itinerary. */
export async function loadPrintable(id: string, allowArtist = false) {
  const user = await requireUser(allowArtist ? undefined : ["ADMIN", "AGENT"]);
  const [booking, settings] = await Promise.all([
    prisma.booking.findFirst({
      where: { id, agencyId: user.agencyId },
      include: { artist: true, venue: true, promoter: true, agent: true, payments: true },
    }),
    getSettings(user.agencyId),
  ]);
  if (!booking) notFound();
  if (user.role === "ARTIST" && (!booking.artistId || !(await actIdsFor(user)).includes(booking.artistId))) notFound();
  return { booking, settings, user };
}
