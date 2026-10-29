import "server-only";
import { prisma } from "./db";
import { readOvertureContacts, type CsvRow } from "./overture";

// Bring an Overture contacts export into a business: acts, people (linked to their acts and to
// the venue or company they work at), venues, companies and private customers. Anything already
// here with the same Overture id, or the same name, is matched rather than duplicated, so the same
// file can be imported again safely. Existing details are only filled in where they're blank.

const COLOURS = ["#e11d48", "#7c3aed", "#2563eb", "#0891b2", "#059669", "#ca8a04", "#ea580c", "#db2777", "#4f46e5", "#16a34a"];
const key = (s: string) => s.trim().toLowerCase();
/** Only fill blanks: never overwrite something already typed in. */
const fill = <T extends Record<string, unknown>>(current: T, incoming: Partial<T>) =>
  Object.fromEntries(Object.entries(incoming).filter(([k, v]) => v && !current[k])) as Partial<T>;

export type ImportSummary = {
  acts: { added: number; matched: number };
  people: { added: number; matched: number };
  venues: { added: number; matched: number };
  companies: { added: number; matched: number };
  customers: { added: number; matched: number };
  links: { acts: number; workplaces: number };
  skipped: number;
};

export async function importOverture(agencyId: string, rows: CsvRow[]): Promise<ImportSummary> {
  const data = readOvertureContacts(rows);
  const out: ImportSummary = {
    acts: { added: 0, matched: 0 },
    people: { added: 0, matched: 0 },
    venues: { added: 0, matched: 0 },
    companies: { added: 0, matched: 0 },
    customers: { added: 0, matched: 0 },
    links: { acts: 0, workplaces: 0 },
    skipped: data.skipped,
  };

  // Acts, by Overture id or name.
  const existingActs = await prisma.artist.findMany({ where: { agencyId }, select: { id: true, name: true, importRef: true } });
  const actByName = new Map(existingActs.map((a) => [key(a.name), a.id]));
  const actByRef = new Map(existingActs.filter((a) => a.importRef).map((a) => [a.importRef!, a.id]));
  let colour = existingActs.length;
  for (const a of data.acts) {
    const id = (a.ref && actByRef.get(a.ref)) || actByName.get(key(a.name));
    if (id) {
      out.acts.matched++;
      if (a.ref && !actByRef.has(a.ref)) await prisma.artist.update({ where: { id }, data: { importRef: a.ref } });
      actByName.set(key(a.name), id);
      continue;
    }
    const created = await prisma.artist.create({
      data: { agencyId, name: a.name, importRef: a.ref || null, colour: COLOURS[colour++ % COLOURS.length] },
    });
    actByName.set(key(a.name), created.id);
    out.acts.added++;
  }

  // Companies: venues become venues, the rest companies.
  const [existingVenues, existingCompanies] = await Promise.all([
    prisma.venue.findMany({ where: { agencyId }, select: { id: true, name: true, importRef: true, address: true, city: true, country: true, notes: true } }),
    prisma.contact.findMany({ where: { agencyId, type: { not: "CLIENT" } }, select: { id: true, name: true, company: true, importRef: true } }),
  ]);
  const venueByName = new Map(existingVenues.map((v) => [key(v.name), v]));
  const companyByName = new Map(existingCompanies.map((c) => [key(c.company || c.name), c.id]));
  const workplace = new Map<string, { venueId?: string; companyId?: string }>();
  for (const c of data.companies) {
    const v = venueByName.get(key(c.name)) ?? existingVenues.find((x) => c.ref && x.importRef === c.ref);
    const companyId = companyByName.get(key(c.name)) ?? existingCompanies.find((x) => c.ref && x.importRef === c.ref)?.id;
    if (v) {
      out.venues.matched++;
      const patch = fill(v, { address: c.address, city: c.city, country: c.country, notes: c.notes, importRef: c.ref || undefined });
      if (Object.keys(patch).length) await prisma.venue.update({ where: { id: v.id }, data: patch });
      workplace.set(key(c.name), { venueId: v.id });
    } else if (companyId) {
      out.companies.matched++;
      workplace.set(key(c.name), { companyId });
    } else if (c.venue) {
      const created = await prisma.venue.create({
        data: { agencyId, name: c.name, address: c.address, city: c.city, country: c.country, notes: c.notes, importRef: c.ref || null },
      });
      out.venues.added++;
      venueByName.set(key(c.name), created);
      workplace.set(key(c.name), { venueId: created.id });
    } else {
      const created = await prisma.contact.create({
        data: { agencyId, type: "COMPANY", name: c.name, company: c.name, address: [c.address, c.city].filter(Boolean).join(", "), importRef: c.ref || null },
      });
      out.companies.added++;
      companyByName.set(key(c.name), created.id);
      workplace.set(key(c.name), { companyId: created.id });
    }
  }

  // People and private customers.
  const [existingPeople, existingClients, existingLinks] = await Promise.all([
    prisma.person.findMany({
      where: { agencyId },
      select: {
        id: true,
        firstName: true,
        surname: true,
        email: true,
        phone: true,
        importRef: true,
        alias: true,
        website: true,
        address: true,
        notes: true,
        jobTitle: true,
        venueId: true,
        companyId: true,
      },
    }),
    prisma.contact.findMany({
      where: { agencyId, type: "CLIENT" },
      select: { id: true, name: true, email: true, phone: true, address: true, importRef: true },
    }),
    prisma.personAct.findMany({ where: { act: { agencyId } }, select: { personId: true, artistId: true } }),
  ]);
  const linked = new Set(existingLinks.map((l) => `${l.personId}:${l.artistId}`));
  const personMatch = (p: (typeof data.people)[number]) =>
    existingPeople.find((x) => p.ref && x.importRef === p.ref) ??
    existingPeople.find((x) => p.email && x.email.toLowerCase() === p.email) ??
    existingPeople.find((x) => key(`${x.firstName} ${x.surname}`) === key(`${p.firstName} ${p.surname}`) && (!p.email || !x.email));

  for (const p of data.people) {
    // A customer with no act is a private customer (weddings, parties), kept with Companies & customers.
    if (p.customer && !p.acts.length) {
      const name = [p.firstName, p.surname].filter(Boolean).join(" ");
      const c =
        existingClients.find((x) => p.ref && x.importRef === p.ref) ??
        existingClients.find((x) => (p.email && x.email.toLowerCase() === p.email) || key(x.name) === key(name));
      if (c) {
        out.customers.matched++;
        const patch = fill(c, { email: p.email, phone: p.phone, address: p.address, importRef: p.ref || undefined });
        if (Object.keys(patch).length) await prisma.contact.update({ where: { id: c.id }, data: patch });
      } else {
        await prisma.contact.create({
          data: {
            agencyId,
            type: "CLIENT",
            name,
            email: p.email,
            phone: p.phone,
            address: p.address,
            tags: "imported from Overture",
            importRef: p.ref || null,
          },
        });
        out.customers.added++;
      }
      continue;
    }

    const work = p.companies.map((c) => workplace.get(key(c))).find(Boolean) ?? {};
    const fields = {
      firstName: p.firstName,
      surname: p.surname,
      alias: p.alias,
      pronouns: p.pronouns,
      jobTitle: p.jobTitle,
      email: p.email,
      phone: p.phone,
      website: p.website,
      address: p.address,
      notes: p.notes,
      venueId: work.venueId ?? null,
      companyId: work.companyId ?? null,
    };
    let personId: string;
    let workplaceSet = false;
    const match = personMatch(p);
    if (match) {
      out.people.matched++;
      personId = match.id;
      const patch = fill(match, { ...fields, importRef: p.ref || undefined, venueId: fields.venueId ?? undefined, companyId: fields.companyId ?? undefined });
      if (Object.keys(patch).length) await prisma.person.update({ where: { id: match.id }, data: patch });
      workplaceSet = !!(patch.venueId || patch.companyId);
    } else {
      const created = await prisma.person.create({ data: { agencyId, ...fields, importRef: p.ref || null } });
      existingPeople.push({ ...created });
      personId = created.id;
      out.people.added++;
      workplaceSet = !!(work.venueId || work.companyId);
    }
    if (workplaceSet) out.links.workplaces++;

    for (const a of p.acts) {
      const artistId = actByName.get(key(a));
      if (!artistId || linked.has(`${personId}:${artistId}`)) continue;
      await prisma.personAct.create({ data: { personId, artistId } });
      linked.add(`${personId}:${artistId}`);
      out.links.acts++;
    }
  }

  // Solo acts with one person: give the act that person's email and phone, so offers reach them.
  const solo = await prisma.artist.findMany({
    where: { agencyId, email: "", members: { some: {} } },
    select: { id: true, phone: true, members: { select: { person: { select: { email: true, phone: true } } } } },
  });
  for (const a of solo) {
    if (a.members.length !== 1) continue;
    const m = a.members[0].person;
    if (m.email || m.phone) await prisma.artist.update({ where: { id: a.id }, data: { email: m.email, phone: a.phone || m.phone } });
  }
  return out;
}
