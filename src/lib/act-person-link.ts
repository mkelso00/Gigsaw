import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { linkActLoginToPerson } from "./login-person";

// Someone already signed up (e.g. Sean Ellis, in two bands) who gets a new act (Sean Ellis Solo) shouldn't have to
// sign up again: the new act goes onto the person, and a person's login sees every act they're in
// (src/lib/people.ts ownActIds). These find the person behind an email, put them in the act, and join an act login
// to its person, so their sign-up counts for every act they're in.

/**
 * The person in this business behind an email: whoever has a login with it (a person's own login, or an act login
 * joined to its person), or else the one person with that email on file. Null when there's none, or two.
 */
export async function personByEmail(agencyId: string, rawEmail: string): Promise<string | null> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return null;
  const login = await prisma.user.findFirst({
    where: { agencyId, role: "ARTIST", email: { equals: email, mode: "insensitive" } },
    select: { id: true, personId: true, artistId: true },
  });
  if (login?.personId) return login.personId;
  if (login?.artistId) {
    const linked = await linkActLoginToPerson(login.id);
    if (linked) return linked;
  }
  const people = await prisma.person.findMany({ where: { agencyId, email: { equals: email, mode: "insensitive" } }, select: { id: true }, take: 2 });
  return people.length === 1 ? people[0].id : null;
}

/** Put a person in an act (no change if they're in it already). True when they were added. */
export async function addPersonToAct(personId: string, artistId: string): Promise<boolean> {
  const there = await prisma.personAct.findUnique({ where: { personId_artistId: { personId, artistId } }, select: { id: true } });
  if (there) return false;
  try {
    await prisma.personAct.create({ data: { personId, artistId } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

/**
 * A person with no login of their own whose email is an act login's (they signed up through one of their acts):
 * join that login to them, so it counts for all their acts. Returns true when joined.
 */
export async function joinLoginToPerson(agencyId: string, personId: string): Promise<boolean> {
  const p = await prisma.person.findFirst({ where: { id: personId, agencyId }, select: { email: true, login: { select: { id: true } } } });
  if (!p || p.login || !p.email.trim()) return false;
  const login = await prisma.user.findFirst({
    where: { agencyId, role: "ARTIST", personId: null, email: { equals: p.email.trim(), mode: "insensitive" } },
    select: { id: true },
  });
  if (!login) return false;
  try {
    return (await prisma.user.updateMany({ where: { id: login.id, personId: null }, data: { personId } })).count === 1;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}
