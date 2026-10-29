import { BOOKING_STATUS_LABELS, type BookingStatus, actName, ACT_VISIBLE } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { actIdsFor } from "@/lib/people";
import { personName } from "@/lib/person-name";
import { buildIcs } from "@/lib/ics";
import { appUrl } from "@/lib/messaging";
import { localTime } from "@/lib/time";

// Private calendar feed, addressed by a secret token: one act's gigs, or a person's gigs
// across every act they're in. Never includes money.
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/, "");
  const act = await prisma.artist.findUnique({ where: { calendarToken: token }, include: { agency: true } });
  const person = act
    ? null
    : await prisma.person.findUnique({ where: { calendarToken: token }, include: { agency: true, acts: { select: { artistId: true } } } });
  const owner = act ?? person;
  if (!owner || owner.agency.status !== "ACTIVE") return new Response("Not found", { status: 404 });
  // Includes any band the act or person is part of.
  const actIds = await actIdsFor({ artistId: act?.id ?? null, personId: person?.id ?? null, agencyId: owner.agencyId });
  const calendarName = act ? act.name : personName(person!);

  const bookings = await prisma.booking.findMany({
    where: { agencyId: owner.agencyId, artistId: { in: actIds }, setStart: { gte: new Date(Date.now() - 90 * 86_400_000) }, status: { in: ACT_VISIBLE } },
    include: { venue: true, artist: { select: { name: true } } },
    orderBy: { setStart: "asc" },
  });

  const ics = buildIcs(
    `${calendarName} · Gigsaw`,
    bookings.map((b) => {
      const status = BOOKING_STATUS_LABELS[b.status as BookingStatus] ?? b.status;
      const where = b.venue ? [b.venue.name, b.venue.address, b.venue.city, b.venue.country].filter(Boolean).join(", ") : "";
      return {
        uid: `${b.id}@gigsaw`,
        start: b.arriveBy,
        end: b.setEnd ?? new Date(b.setStart.getTime() + 2 * 3_600_000),
        summary: `${b.status === "HOLD" ? "[HOLD] " : ""}${actName(b)}${b.venue ? ` @ ${b.venue.name}` : ""}`,
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
