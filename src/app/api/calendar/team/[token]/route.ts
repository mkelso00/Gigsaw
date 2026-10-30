import { getSettings, prisma } from "@/lib/db";
import { buildIcs, icsResponse } from "@/lib/ics";
import { appUrl } from "@/lib/messaging";
import { billingState } from "@/lib/subscription";
import { TEAM_FEED_SELECT, teamFeedEvent, teamFeedWhere } from "@/lib/team-calendar";

export const dynamic = "force-dynamic";

// A staff member's private calendar feed of bookings, addressed by the secret token from their
// Profile. Times in the agency's time zone; never any money.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.ics$/, "");
  if (token.length < 20) return new Response("Not found", { status: 404 });
  const user = await prisma.user.findUnique({ where: { calendarToken: token }, include: { agency: true } });
  // Only admins and agents of an agency that's still running. Turning the link off or resetting it stops this at once.
  if (!user || !user.agencyId || !user.agency || user.agency.status !== "ACTIVE" || (user.role !== "ADMIN" && user.role !== "AGENT")) {
    return new Response("Not found", { status: 404 });
  }
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const scopeName = user.calendarScope === "ALL" ? "All bookings" : "My bookings";
  // A business whose trial or subscription has ended keeps the calendar, but it's empty until it pays.
  const locked = billingState(user.agency).locked;
  const bookings = locked
    ? []
    : await prisma.booking.findMany({
        where: teamFeedWhere({ ...user, agencyId: user.agencyId }),
        select: TEAM_FEED_SELECT,
        orderBy: { arriveBy: "asc" },
        take: 5000,
      });
  const base = appUrl();
  const body = buildIcs(
    `${settings.agencyName} · ${scopeName}`,
    bookings.map((b) => teamFeedEvent(b, { baseUrl: base, agencyTimezone: tz })),
    { timezone: tz },
  );
  const lastModified = bookings.reduce<Date | undefined>((max, b) => (!max || b.updatedAt > max ? b.updatedAt : max), undefined);
  return icsResponse(req, body, { filename: "gigsaw-bookings.ics", lastModified });
}
