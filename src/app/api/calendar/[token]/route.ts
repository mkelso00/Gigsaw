import { ACT_FEED_SELECT, actFeedEvent, actFeedWhere } from "@/lib/act-calendar";
import { getSettings, prisma } from "@/lib/db";
import { actIdsFor } from "@/lib/people";
import { personName } from "@/lib/person-name";
import { buildIcs, icsResponse } from "@/lib/ics";
import { appUrl } from "@/lib/messaging";
import { billingState } from "@/lib/subscription";

export const dynamic = "force-dynamic";

// Private calendar feed, addressed by a secret token: one act's gigs, or a person's gigs
// across every act they're in. Never includes money.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
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

  // Like the staff feed: a business whose trial or subscription has ended keeps the calendar, but it's empty until it pays.
  const locked = billingState(owner.agency).locked;
  const bookings = locked
    ? []
    : await prisma.booking.findMany({ where: actFeedWhere(owner.agencyId, actIds), select: ACT_FEED_SELECT, orderBy: { setStart: "asc" } });

  // The same events a connected Google or Outlook calendar gets (src/lib/calendar-sync), built in one place.
  const { defaultTimezone } = await getSettings(owner.agencyId);
  const baseUrl = appUrl();
  const ics = buildIcs(
    `${calendarName} · Gigsaw`,
    bookings.map((b) => actFeedEvent(b, { baseUrl })),
    { timezone: defaultTimezone },
  );
  const lastModified = bookings.reduce<Date | undefined>((max, b) => (!max || b.updatedAt > max ? b.updatedAt : max), undefined);
  return icsResponse(req, ics, { filename: "bookings.ics", lastModified });
}
