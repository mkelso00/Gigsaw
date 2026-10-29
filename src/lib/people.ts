import "server-only";
import { prisma } from "./db";
import { personName } from "./person-name";

// People and acts. An act (a solo singer, duo or band) is made up of people, and one person can
// be in several acts, e.g. Graham McKee in Wonderlust and in Graham McKee Solo.
// Messages about an act's gigs go to its members; an act with no members yet is messaged
// using the act's own email, phone and login, as before.

/** The acts a login can see: every act a person is in, or the one act an act login belongs to. */
export async function actIdsFor(user: { artistId: string | null; personId: string | null }) {
  if (user.personId) {
    return (await prisma.personAct.findMany({ where: { personId: user.personId }, select: { artistId: true } })).map((a) => a.artistId);
  }
  return user.artistId ? [user.artistId] : [];
}

/** This act plus every act that shares a member with it (a member can't be in two places at once). */
export async function linkedActIds(artistId: string) {
  const members = await prisma.personAct.findMany({ where: { artistId }, select: { personId: true } });
  if (!members.length) return [artistId];
  const acts = await prisma.personAct.findMany({ where: { personId: { in: members.map((m) => m.personId) } }, select: { artistId: true } });
  return [...new Set([artistId, ...acts.map((a) => a.artistId)])];
}

/** The members of an act shared with another act, by name, e.g. ["Graham McKee"]. */
export async function sharedMembers(actA: string, actB: string) {
  if (actA === actB) return [];
  const rows = await prisma.personAct.findMany({ where: { artistId: { in: [actA, actB] } }, include: { person: true } });
  const inA = new Set(rows.filter((r) => r.artistId === actA).map((r) => r.personId));
  return [...new Map(rows.filter((r) => r.artistId === actB && inA.has(r.personId)).map((r) => [r.personId, personName(r.person)])).values()];
}

export type Recipient = {
  /** "person:<id>" or "act:<id>", used to make sure each reminder only goes once. */
  key: string;
  name: string;
  firstName: string;
  emails: string[];
  phone: string;
  /** Their login, for phone notifications. */
  userId: string | null;
  /** True when this is a member hearing about one of their acts (so messages name the act). */
  isMember: boolean;
};

const cleanEmails = (...list: (string | null | undefined)[]) => [...new Set(list.filter((e): e is string => !!e?.trim()).map((e) => e.trim().toLowerCase()))];

/** Who hears about each act's gigs: its members, or the act itself when it has no members. Keyed by act id. */
export async function recipientsForActs(actIds: string[]): Promise<Map<string, Recipient[]>> {
  const acts = await prisma.artist.findMany({
    where: { id: { in: [...new Set(actIds)] } },
    include: { login: { select: { id: true, email: true } }, members: { include: { person: { include: { login: { select: { id: true, email: true } } } } } } },
  });
  const out = new Map<string, Recipient[]>();
  for (const act of acts) {
    if (act.members.length) {
      out.set(
        act.id,
        act.members.map(({ person: p }) => ({
          key: `person:${p.id}`,
          name: personName(p),
          firstName: p.alias?.trim() || p.firstName,
          emails: cleanEmails(p.email, p.login?.email),
          phone: p.phone,
          userId: p.login?.id ?? null,
          isMember: true,
        })),
      );
    } else {
      out.set(act.id, [
        {
          key: `act:${act.id}`,
          name: act.name,
          firstName: act.name,
          emails: cleanEmails(act.email, act.login?.email),
          phone: act.phone,
          userId: act.login?.id ?? null,
          isMember: false,
        },
      ]);
    }
  }
  return out;
}

/** Names offered in the person form: acts, and companies (venues first, then company contacts). */
export async function personFormOptions(agencyId: string) {
  const [acts, venues, contacts] = await Promise.all([
    prisma.artist.findMany({ where: { agencyId }, orderBy: { name: "asc" }, select: { name: true } }),
    prisma.venue.findMany({ where: { agencyId }, orderBy: { name: "asc" }, select: { name: true } }),
    prisma.contact.findMany({ where: { agencyId, type: { not: "CLIENT" } }, orderBy: { name: "asc" }, select: { name: true, company: true } }),
  ]);
  return {
    actNames: acts.map((a) => a.name),
    companyNames: [...new Set([...venues.map((v) => v.name), ...contacts.map((c) => c.company || c.name)])],
  };
}
