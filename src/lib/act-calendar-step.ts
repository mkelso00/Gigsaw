import "server-only";
import { prisma } from "./db";

// Adding their gigs to a calendar is a required step in the act app, after their pay details. Gigsaw can't see
// inside a phone, so the step counts as done when the first of these happens:
//  - a calendar app fetches the act's (or person's) subscribe feed for the first time (Apple does this at once),
//  - the login connects Google Calendar or Outlook,
//  - the act says they've added it, after pressing one of the add buttons (Google can take hours to fetch).

/** The act or person's feed was just fetched by a calendar app: their logins have added the calendar. */
export async function markFeedFetched(owner: { artistId: string } | { personId: string }) {
  await prisma.user.updateMany({ where: { ...owner, role: "ARTIST", calendarAddedAt: null }, data: { calendarAddedAt: new Date() } });
}

/** This login has added (or connected) its calendar. */
export async function markCalendarAdded(userId: string) {
  await prisma.user.updateMany({ where: { id: userId, calendarAddedAt: null }, data: { calendarAddedAt: new Date() } });
}

/** Whether the login still has to add its calendar before using the app. */
export async function needsCalendar(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { calendarAddedAt: true, _count: { select: { calendarConnections: true } } } });
  return !!u && !u.calendarAddedAt && u._count.calendarConnections === 0;
}
