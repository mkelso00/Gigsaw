import { ACT_FEED_SELECT, actFeedEvent, actFeedWhere } from "@/lib/act-calendar";
import { getSettings, prisma } from "@/lib/db";
import { parseExtraFields } from "@/lib/event-plan";
import { actIdsFor } from "@/lib/people";
import { personName } from "@/lib/person-name";
import { buildIcs, icsResponse } from "@/lib/ics";
import { appUrl } from "@/lib/messaging";
import { billingState } from "@/lib/subscription";
import { markFeedFetched } from "@/lib/act-calendar-step";

export const dynamic = "force-dynamic";

// Private calendar feed, addressed by a secret token: one act's gigs, or a person's gigs
// across every act they're in. The only money in it is the act's own pay (src/lib/act-calendar.ts).
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/, "");
  const act = await prisma.artist.findUnique({ where: { calendarToken: token }, include: { agency: true } });
  const person = act
    ? null
    : await prisma.person.findUnique({ where: { calendarToken: token }, include: { agency: true, acts: { select: { artistId: true } } } });
  const owner = act ?? person;
  if (!owner || owner.agency.status !== "ACTIVE") return new Response("Not found", { status: 404 });
  // A calendar app fetching the feed means the act has added it: that ticks off the act app's calendar step.
  await markFeedFetched(act ? { artistId: act.id } : { personId: person!.id });
  // Includes any band the act or person is part of.
  const actIds = await actIdsFor({ artistId: act?.id ?? null, personId: person?.id ?? null, agencyId: owner.agencyId });
  const calendarName = act ? act.name : personName(person!);

  // Like the staff feed: a business whose trial or subscription has ended keeps the calendar, but it's empty until it pays.
  const locked = billingState(owner.agency).locked;
  const bookings = locked
    ? []
    : await prisma.booking.findMany({
        where: actFeedWhere(owner.agencyId, actIds, new Date(), person?.id ?? null),
        select: ACT_FEED_SELECT,
        orderBy: { setStart: "asc" },
      });

  // The same events a connected Google or Outlook calendar gets (src/lib/calendar-sync), built in one place.
  const settings = await getSettings(owner.agencyId);
  // The fee shows on the gigs of the acts this link belongs to directly, not on a band's gigs they're part of.
  const viewer = { ownActIds: act ? [act.id] : person!.acts.map((a) => a.artistId), person: !act };
  const opts = { baseUrl: appUrl(), viewer, planExtras: parseExtraFields(settings.planExtraFields) };
  const events = bookings.map((b) => actFeedEvent(b, opts));
  const ics = buildIcs(`${calendarName} · Gigsaw`, events, { timezone: settings.defaultTimezone });
  const lastModified = events.reduce<Date | undefined>((max, e) => (!max || e.updated > max ? e.updated : max), undefined);
  return icsResponse(req, ics, { filename: "bookings.ics", lastModified });
}
