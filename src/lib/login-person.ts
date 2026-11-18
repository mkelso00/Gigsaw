import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { log } from "@/server/log";

// A login can belong to an act (Artist) or to a person in acts (Person). Someone with their own solo
// act and a person record (e.g. Justin Crow solo, and Justin Crow in two bands) who signs up with the
// solo act's email gets a login on the act only. Then their bands don't count them as signed up, and
// their app and calendar feed only carry the solo act's gigs. Linking the login to their person as
// well fixes both: a person's login sees every act they're in (src/lib/people.ts ownActIds).
//
// Who the person is: someone in the login's act, in the same business, with no login of their own,
// whose email is the login's or the act's; failing that, the act's only member. Never a guess
// between two people.

type Candidate = { id: string; email: string };

/** The person an act login should also belong to, or null. Pure, for tests. */
export function personForActLogin(login: { email: string }, act: { email: string }, members: Candidate[]): string | null {
  const same = (a: string, b: string) => !!a.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();
  const byEmail = members.filter((m) => same(m.email, login.email) || same(m.email, act.email));
  if (byEmail.length === 1) return byEmail[0].id;
  if (byEmail.length > 1) return null;
  return members.length === 1 ? members[0].id : null;
}

/** Link an act login to its person, when there's exactly one and they have no login yet. Returns the person's id if linked. */
export async function linkActLoginToPerson(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      personId: true,
      agencyId: true,
      artist: {
        select: {
          email: true,
          agencyId: true,
          members: { select: { person: { select: { id: true, email: true, agencyId: true, login: { select: { id: true } } } } } },
        },
      },
    },
  });
  if (!user || user.role !== "ARTIST" || user.personId || !user.artist) return null;
  const members = user.artist.members.map((m) => m.person).filter((p) => p.agencyId === user.artist!.agencyId);
  const personId = personForActLogin(user, user.artist, members);
  if (!personId || members.find((m) => m.id === personId)?.login) return null;
  try {
    const done = await prisma.user.updateMany({ where: { id: user.id, personId: null }, data: { personId } });
    return done.count ? personId : null;
  } catch (e) {
    // The person got a login of their own in the meantime: leave both as they are.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

/** The same, never throwing: for sign-in and the calendar feed, which mustn't fail because of it. */
export async function linkActLoginQuietly(userId: string | null | undefined) {
  if (!userId) return null;
  try {
    return await linkActLoginToPerson(userId);
  } catch (e) {
    log.error("Couldn't link an act login to its person", { userId, err: e });
    return null;
  }
}
