import "server-only";
import { prisma } from "./db";
import { personName } from "./person-name";

// People and acts. An act (a solo singer, duo or band) is made up of people and/or other acts
// (a band built from solo acts), and one person can be in several acts, e.g. Graham McKee in
// Wonderlust and in Graham McKee Solo. Messages about an act's gigs go to everyone in it; an
// act with no members yet is messaged using the act's own email, phone and login, as before.

/**
 * How acts sit inside each other in an agency (a band built from solo acts), loaded once.
 * Cycles are ignored, so a mistake can't loop forever.
 */
async function actTree(agencyId: string) {
  const links = await prisma.actLink.findMany({ where: { parent: { agencyId } }, select: { parentId: true, childId: true } });
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const l of links) {
    parents.set(l.childId, [...(parents.get(l.childId) ?? []), l.parentId]);
    children.set(l.parentId, [...(children.get(l.parentId) ?? []), l.childId]);
  }
  const walk = (start: string[], next: Map<string, string[]>) => {
    const seen = new Set(start);
    const queue = [...start];
    while (queue.length) for (const n of next.get(queue.pop()!) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
    return seen;
  };
  return {
    /** These acts plus every band they're part of (and bands those are part of). */
    withBands: (ids: string[]) => walk(ids, parents),
    /** These acts plus every act inside them. */
    withParts: (ids: string[]) => walk(ids, children),
    children,
  };
}

async function agencyOfAct(artistId: string) {
  return (await prisma.artist.findUnique({ where: { id: artistId }, select: { agencyId: true } }))?.agencyId ?? null;
}

/**
 * The acts a login can see: a person's acts, or the one act an act login belongs to, plus any
 * band those acts are part of (Graham's solo login also sees Wonderlust's gigs).
 */
export async function actIdsFor(user: { artistId: string | null; personId: string | null; agencyId?: string | null }) {
  const own = user.personId
    ? (await prisma.personAct.findMany({ where: { personId: user.personId }, select: { artistId: true } })).map((a) => a.artistId)
    : user.artistId
      ? [user.artistId]
      : [];
  if (!own.length) return [];
  const agencyId = user.agencyId ?? (await agencyOfAct(own[0]));
  if (!agencyId) return own;
  return [...(await actTree(agencyId)).withBands(own)];
}

/**
 * Every act that can't be booked at the same time as this one: itself, the acts inside it, the
 * bands it's part of, and any act that shares a person or a solo act with any of those.
 */
export async function linkedActIds(artistId: string) {
  const agencyId = await agencyOfAct(artistId);
  if (!agencyId) return [artistId];
  const tree = await actTree(agencyId);
  const family = tree.withParts([artistId]);
  const people = await prisma.personAct.findMany({ where: { artistId: { in: [...family] } }, select: { personId: true } });
  const viaPeople = people.length
    ? (await prisma.personAct.findMany({ where: { personId: { in: people.map((p) => p.personId) } }, select: { artistId: true } })).map((a) => a.artistId)
    : [];
  // Bands that contain any of these acts (or the acts' own parts) are busy too.
  return [...tree.withBands([...family, ...viaPeople])];
}

/** Who two connected acts have in common, by name, e.g. ["Graham McKee"] or ["Graham McKee Solo"]. */
export async function sharedMembers(actA: string, actB: string) {
  if (actA === actB) return [];
  const agencyId = await agencyOfAct(actA);
  if (!agencyId) return [];
  const tree = await actTree(agencyId);
  const famA = tree.withParts([actA]);
  const famB = tree.withParts([actB]);
  const rows = await prisma.personAct.findMany({ where: { artistId: { in: [...famA, ...famB] } }, include: { person: true } });
  const inA = new Set(rows.filter((r) => famA.has(r.artistId)).map((r) => r.personId));
  const people = [...new Map(rows.filter((r) => famB.has(r.artistId) && inA.has(r.personId)).map((r) => [r.personId, personName(r.person)])).values()];
  if (people.length) return people;
  // No people on file: name the act they share (e.g. the solo act inside the band).
  const shared = [...famA].filter((id) => famB.has(id));
  const acts = await prisma.artist.findMany({ where: { id: { in: shared } }, select: { name: true } });
  return acts.map((a) => a.name);
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

/**
 * Who hears about each act's gigs, keyed by act id. An act's people are its members plus
 * everyone in the acts it's built from; an act (or a solo act inside a band) with no members
 * on file is reached through its own email, phone and login.
 */
export async function recipientsForActs(actIds: string[]): Promise<Map<string, Recipient[]>> {
  const ids = [...new Set(actIds)];
  const out = new Map<string, Recipient[]>();
  if (!ids.length) return out;
  const agencyId = await agencyOfAct(ids[0]);
  const tree = agencyId ? await actTree(agencyId) : null;
  const families = new Map(ids.map((id) => [id, tree ? tree.withParts([id]) : new Set([id])]));
  const allIds = [...new Set([...families.values()].flatMap((f) => [...f]))];
  const acts = await prisma.artist.findMany({
    where: { id: { in: allIds } },
    include: { login: { select: { id: true, email: true } }, members: { include: { person: { include: { login: { select: { id: true, email: true } } } } } } },
  });
  const byId = new Map(acts.map((a) => [a.id, a]));
  for (const id of ids) {
    const found = new Map<string, Recipient>();
    for (const actId of families.get(id) ?? []) {
      const act = byId.get(actId);
      if (!act) continue;
      const hasParts = (tree?.children.get(actId)?.length ?? 0) > 0;
      if (act.members.length) {
        for (const { person: p } of act.members) {
          found.set(`person:${p.id}`, {
            key: `person:${p.id}`,
            name: personName(p),
            firstName: p.alias?.trim() || p.firstName,
            emails: cleanEmails(p.email, p.login?.email),
            phone: p.phone,
            userId: p.login?.id ?? null,
            isMember: true,
          });
        }
      } else if (!hasParts || actId === id) {
        // A solo act inside a band, or an act with nobody on file: use the act's own details.
        // (A band with parts but no direct members is reached through its parts.)
        if (hasParts && actId === id) continue;
        found.set(`act:${act.id}`, {
          key: `act:${act.id}`,
          name: act.name,
          firstName: act.name,
          emails: cleanEmails(act.email, act.login?.email),
          phone: act.phone,
          userId: act.login?.id ?? null,
          isMember: actId !== id,
        });
      }
    }
    out.set(id, [...found.values()]);
  }
  return out;
}

/** Gigs grouped by who hears about them (from recipientsForActs): each person once, with all their gigs in order. */
export function groupByRecipient<T extends { artistId: string | null }>(gigs: T[], recipients: Map<string, Recipient[]>) {
  const out = new Map<string, { to: Recipient; gigs: T[] }>();
  for (const g of gigs) {
    for (const r of recipients.get(g.artistId!) ?? []) {
      const entry = out.get(r.key) ?? { to: r, gigs: [] };
      entry.gigs.push(g);
      out.set(r.key, entry);
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

/** True if putting `childId` inside `parentId` would put an act inside itself. */
export async function wouldLoop(parentId: string, childId: string) {
  if (parentId === childId) return true;
  const agencyId = await agencyOfAct(parentId);
  if (!agencyId) return false;
  return (await actTree(agencyId)).withParts([childId]).has(parentId);
}
