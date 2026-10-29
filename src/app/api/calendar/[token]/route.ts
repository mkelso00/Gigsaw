import { BOOKING_STATUS_LABELS, type BookingStatus } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { buildIcs } from "@/lib/ics";
import { appUrl } from "@/lib/messaging";
import { localTime } from "@/lib/time";

// Private calendar feed for one artist, addressed by a secret token.
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const artist = await prisma.artist.findUnique({ where: { calendarToken: token.replace(/\.ics$/, "") }, include: { agency: true } });
  if (!artist || artist.agency.status !== "ACTIVE") return new Response("Not found", { status: 404 });

  const bookings = await prisma.booking.findMany({
    where: { agencyId: artist.agencyId, artistId: artist.id, setStart: { gte: new Date(Date.now() - 90 * 86_400_000) }, status: { not: "ENQUIRY" } },
    include: { venue: true },
    orderBy: { setStart: "asc" },
  });

  const ics = buildIcs(
    `${artist.name} · Gigsaw`,
    bookings.map((b) => {
      const status = BOOKING_STATUS_LABELS[b.status as BookingStatus] ?? b.status;
      const where = b.venue ? [b.venue.name, b.venue.address, b.venue.city, b.venue.country].filter(Boolean).join(", ") : "";
      return {
        uid: `${b.id}@gigsaw`,
        start: b.arriveBy,
        end: b.setEnd ?? new Date(b.setStart.getTime() + 2 * 3_600_000),
        summary: `${b.status === "HOLD" ? "[HOLD] " : ""}${artist.name}${b.venue ? ` @ ${b.venue.name}` : ""}`,
        location: where,
        description: [
          `Status: ${status}`,
          `Arrive by ${localTime(b.arriveBy, b.timezone)}`,
          b.soundcheckAt ? `Soundcheck ${localTime(b.soundcheckAt, b.timezone)}` : "",
          `On stage ${localTime(b.setStart, b.timezone)}`,
          b.dayContact ? `Contact: ${b.dayContact}` : "",
          `Details: ${appUrl()}/app/gigs/${b.id}`,
        ]
          .filter(Boolean)
          .join("\n"),
        updated: b.updatedAt,
        cancelled: b.status === "CANCELLED",
      };
    }),
  );
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" } });
}
