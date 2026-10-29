import "server-only";
import { prisma } from "./db";
import { toMinor } from "./money";
import type { CsvRow } from "./overture";
import { tidyPhone } from "./overture";
import { splitNames, TEMPLATE_COLUMNS, type TemplateKind } from "./templates";

// Bring in a filled-in template (acts, people or venues). Rows are matched to what's already
// here by name (or a person's email), only blank details are filled in, and links to acts and
// workplaces are added, so the same file can be uploaded again safely.

const COLOURS = ["#e11d48", "#7c3aed", "#2563eb", "#0891b2", "#059669", "#ca8a04", "#ea580c", "#db2777", "#4f46e5", "#16a34a"];
const key = (s: string) => s.trim().toLowerCase();
const ACT_TYPES: Record<string, string> = { solo: "SOLO", duo: "DUO", band: "BAND", dj: "DJ", other: "OTHER", trio: "BAND" };
const url = (s: string) => (!s ? "" : /^https?:\/\//i.test(s) ? s : `https://${s}`);
/** Only fill blanks: never overwrite something already typed in. */
const fill = <T extends Record<string, unknown>>(current: T, incoming: Partial<T>) =>
  Object.fromEntries(Object.entries(incoming).filter(([k, v]) => v !== "" && v != null && !current[k])) as Partial<T>;

export type TemplateSummary = { added: number; updated: number; skipped: number; links: number; created: string[] };

/** Is this file the template it claims to be? Returns the missing required column, if any. */
export function missingColumn(kind: TemplateKind, rows: CsvRow[]) {
  const required = TEMPLATE_COLUMNS[kind].required;
  return rows.length && !(required in rows[0]) ? required : null;
}

function splitName(n: string) {
  const [first, ...rest] = n.trim().split(/\s+/);
  return { firstName: first || n.trim(), surname: rest.join(" ") };
}

export async function importTemplate(agencyId: string, kind: TemplateKind, rows: CsvRow[]): Promise<TemplateSummary> {
  const out: TemplateSummary = { added: 0, updated: 0, skipped: 0, links: 0, created: [] };
  const g = (r: CsvRow, k: string) => (r[k] ?? "").trim();

  // Acts and people are linked by name, so load what's here once.
  const acts = await prisma.artist.findMany({ where: { agencyId }, select: { id: true, name: true } });
  const actByName = new Map(acts.map((a) => [key(a.name), a.id]));
  const people = await prisma.person.findMany({ where: { agencyId }, select: { id: true, firstName: true, surname: true, email: true } });
  const links = new Set(
    (await prisma.personAct.findMany({ where: { act: { agencyId } }, select: { personId: true, artistId: true } })).map((l) => `${l.personId}:${l.artistId}`),
  );
  let colour = acts.length;

  const actId = async (name: string) => {
    const found = actByName.get(key(name));
    if (found) return found;
    const a = await prisma.artist.create({ data: { agencyId, name: name.trim(), colour: COLOURS[colour++ % COLOURS.length] } });
    actByName.set(key(name), a.id);
    out.created.push(`act ${a.name}`);
    return a.id;
  };
  const personId = async (name: string) => {
    const n = splitName(name);
    const found = people.find((p) => key(`${p.firstName} ${p.surname}`) === key(`${n.firstName} ${n.surname}`));
    if (found) return found.id;
    const p = await prisma.person.create({ data: { agencyId, ...n } });
    people.push({ id: p.id, firstName: p.firstName, surname: p.surname, email: "" });
    out.created.push(`person ${name.trim()}`);
    return p.id;
  };
  const link = async (pid: string, aid: string) => {
    if (links.has(`${pid}:${aid}`)) return;
    await prisma.personAct.create({ data: { personId: pid, artistId: aid } });
    links.add(`${pid}:${aid}`);
    out.links++;
  };

  if (kind === "acts") {
    for (const r of rows) {
      const name = g(r, "Act name");
      if (!name) {
        out.skipped++;
        continue;
      }
      let fee: number | null = null;
      try {
        fee = g(r, "Usual fee") ? toMinor(g(r, "Usual fee")) : null;
      } catch {
        fee = null;
      }
      const data = {
        actType: ACT_TYPES[key(g(r, "Type"))] ?? "",
        genre: g(r, "Genre"),
        town: g(r, "Based in"),
        email: g(r, "Email").toLowerCase(),
        phone: tidyPhone(g(r, "Phone")),
        usualFeeMinor: fee,
        videoUrl: url(g(r, "Video link")),
        instagram: g(r, "Instagram").replace(/^'?@/, ""),
        website: url(g(r, "Website")),
        notes: g(r, "Notes"),
      };
      const existing = actByName.get(key(name)) ? await prisma.artist.findUnique({ where: { id: actByName.get(key(name))! } }) : null;
      let id: string;
      if (existing) {
        const patch = fill(existing, data);
        if (Object.keys(patch).length) {
          await prisma.artist.update({ where: { id: existing.id }, data: patch });
          out.updated++;
        }
        id = existing.id;
      } else {
        const a = await prisma.artist.create({ data: { agencyId, name, colour: COLOURS[colour++ % COLOURS.length], ...data } });
        actByName.set(key(name), a.id);
        id = a.id;
        out.added++;
      }
      for (const m of splitNames(r["Members"])) await link(await personId(m), id);
    }
  }

  if (kind === "people") {
    const [venues, companies] = await Promise.all([
      prisma.venue.findMany({ where: { agencyId }, select: { id: true, name: true } }),
      prisma.contact.findMany({ where: { agencyId, type: { not: "CLIENT" } }, select: { id: true, name: true, company: true } }),
    ]);
    for (const r of rows) {
      const firstName = g(r, "First name");
      if (!firstName) {
        out.skipped++;
        continue;
      }
      const surname = g(r, "Surname");
      const email = g(r, "Email").toLowerCase();
      // Where they work: a venue if there's one by that name, otherwise a company (made if new).
      const at = g(r, "Works at");
      let venueId: string | null = null;
      let companyId: string | null = null;
      if (at) {
        venueId = venues.find((v) => key(v.name) === key(at))?.id ?? null;
        if (!venueId) {
          companyId = companies.find((c) => key(c.company || c.name) === key(at))?.id ?? null;
          if (!companyId) {
            const c = await prisma.contact.create({ data: { agencyId, type: "COMPANY", name: at, company: at } });
            companies.push({ id: c.id, name: at, company: at });
            companyId = c.id;
            out.created.push(`company ${at}`);
          }
        }
      }
      const data = { firstName, surname, email, phone: tidyPhone(g(r, "Phone")), jobTitle: g(r, "Job title"), notes: g(r, "Notes"), venueId, companyId };
      const match =
        (email && people.find((p) => p.email.toLowerCase() === email)) ||
        people.find((p) => key(`${p.firstName} ${p.surname}`) === key(`${firstName} ${surname}`));
      let id: string;
      if (match) {
        const current = await prisma.person.findUnique({ where: { id: match.id } });
        const patch = fill(current!, data);
        if (Object.keys(patch).length) {
          await prisma.person.update({ where: { id: match.id }, data: patch });
          out.updated++;
        }
        id = match.id;
      } else {
        const p = await prisma.person.create({ data: { agencyId, ...data } });
        people.push({ id: p.id, firstName, surname, email });
        id = p.id;
        out.added++;
      }
      for (const a of splitNames(r["Acts"])) await link(id, await actId(a));
    }
  }

  if (kind === "venues") {
    const venues = await prisma.venue.findMany({ where: { agencyId } });
    for (const r of rows) {
      const name = g(r, "Venue name");
      if (!name) {
        out.skipped++;
        continue;
      }
      const notes = [
        g(r, "Parking") && `Parking: ${g(r, "Parking")}`,
        g(r, "PA setup") && `PA: ${g(r, "PA setup")}`,
        g(r, "Arrival") && `Arrival: ${g(r, "Arrival")}`,
        g(r, "Email") && `Email: ${g(r, "Email")}`,
        g(r, "Phone") && `Phone: ${tidyPhone(g(r, "Phone"))}`,
        g(r, "Notes"),
      ].filter(Boolean) as string[];
      const data = { address: [g(r, "Address"), g(r, "Postcode")].filter(Boolean).join(", "), city: g(r, "Town or city"), country: g(r, "Country") };
      const v = venues.find((x) => key(x.name) === key(name));
      if (v) {
        const patch: Record<string, unknown> = fill(v, data);
        const newLines = notes.filter((l) => !v.notes.includes(l));
        if (newLines.length) patch.notes = [v.notes, ...newLines].filter(Boolean).join("\n");
        if (Object.keys(patch).length) {
          await prisma.venue.update({ where: { id: v.id }, data: patch });
          out.updated++;
        }
      } else {
        const created = await prisma.venue.create({ data: { agencyId, name, ...data, notes: notes.join("\n") } });
        venues.push(created);
        out.added++;
      }
    }
  }
  return out;
}
