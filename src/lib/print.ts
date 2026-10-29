import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "./auth";
import { getSettings, prisma } from "./db";

/** Load a booking for a printable document. Artists may only open their own itinerary. */
export async function loadPrintable(id: string, allowArtist = false) {
  const user = await requireUser(allowArtist ? undefined : ["ADMIN", "AGENT"]);
  const [booking, settings] = await Promise.all([
    prisma.booking.findUnique({
      where: { id },
      include: { artist: true, venue: true, promoter: true, agent: true, payments: true },
    }),
    getSettings(),
  ]);
  if (!booking) notFound();
  if (user.role === "ARTIST" && booking.artistId !== user.artistId) notFound();
  return { booking, settings, user };
}
