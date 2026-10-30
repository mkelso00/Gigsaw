"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashPassword, requireStaff, type AgencyUser } from "@/lib/auth";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, required, str, type FormState } from "@/lib/forms";
import { personName } from "@/lib/person-name";
import { wouldLoop } from "@/lib/people";

// People, following Overture: a person has a company (a venue, or another company such as a
// promoter or management firm) and can be in any number of acts, each with a job title.
// Typing a company or act name that doesn't exist yet creates it.
// Every lookup includes the agency, so one agency can never touch another's records.

const MAX_ACT_ROWS = 12;

function personFields(form: FormData) {
  return {
    firstName: required(form, "firstName", "First name"),
    surname: str(form, "surname"),
    alias: str(form, "alias"),
    pronouns: str(form, "pronouns"),
    email: str(form, "email").toLowerCase(),
    phone: str(form, "phone"),
    social: str(form, "social"),
    website: str(form, "website"),
    address: str(form, "address"),
    notes: str(form, "notes"),
    jobTitle: str(form, "jobTitle"),
  };
}

const same = (name: string) => ({ equals: name, mode: "insensitive" as const });

/** A company by name: a venue first, then a company or promoter contact, else a new company. */
async function resolveCompany(user: AgencyUser, raw: string): Promise<{ venueId: string | null; companyId: string | null; created?: string }> {
  const name = raw.trim();
  if (!name) return { venueId: null, companyId: null };
  const venue = await prisma.venue.findFirst({ where: { agencyId: user.agencyId, name: same(name) }, select: { id: true } });
  if (venue) return { venueId: venue.id, companyId: null };
  const contact = await prisma.contact.findFirst({
    where: { agencyId: user.agencyId, OR: [{ name: same(name) }, { company: same(name) }] },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (contact) return { venueId: null, companyId: contact.id };
  const created = await prisma.contact.create({ data: { agencyId: user.agencyId, type: "COMPANY", name, company: name } });
  await logActivity(user, "CONTACT", created.id, "added company", name);
  return { venueId: null, companyId: created.id, created: name };
}

/** The act rows on the form (act_0 / actRole_0 …), with new acts created by name. */
async function resolveActs(user: AgencyUser, form: FormData) {
  const rows: { artistId: string; jobTitle: string }[] = [];
  const created: string[] = [];
  for (let i = 0; i < MAX_ACT_ROWS; i++) {
    const name = str(form, `act_${i}`);
    if (!name) continue;
    let act = await prisma.artist.findFirst({ where: { agencyId: user.agencyId, name: same(name) }, select: { id: true } });
    if (!act) {
      act = await prisma.artist.create({ data: { agencyId: user.agencyId, name }, select: { id: true } });
      await logActivity(user, "ARTIST", act.id, "added act", name);
      created.push(name);
    }
    if (!rows.some((r) => r.artistId === act.id)) rows.push({ artistId: act.id, jobTitle: str(form, `actRole_${i}`) });
  }
  return { rows, created };
}

async function ownPerson(user: AgencyUser, personId: string) {
  const p = await prisma.person.findFirst({ where: { id: personId, agencyId: user.agencyId }, include: { login: true } });
  if (!p) throw new FormError("Person not found");
  return p;
}

export async function createPerson(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  let id = "";
  const res = await handleForm(async () => {
    const fields = personFields(form);
    const company = await resolveCompany(user, str(form, "company"));
    const acts = await resolveActs(user, form);
    const p = await prisma.person.create({
      data: { ...fields, venueId: company.venueId, companyId: company.companyId, agencyId: user.agencyId, acts: { create: acts.rows } },
    });
    await logActivity(user, "PERSON", p.id, "added person", personName(p));
    id = p.id;
  });
  if (res?.error) return res;
  revalidatePath("/", "layout");
  redirect(`/people/${id}`);
}

export async function updatePerson(personId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    await ownPerson(user, personId);
    const fields = personFields(form);
    const company = await resolveCompany(user, str(form, "company"));
    const acts = await resolveActs(user, form);
    await prisma.$transaction([
      prisma.person.update({ where: { id: personId }, data: { ...fields, venueId: company.venueId, companyId: company.companyId } }),
      prisma.personAct.deleteMany({ where: { personId, artistId: { notIn: acts.rows.map((r) => r.artistId) } } }),
      ...acts.rows.map((r) =>
        prisma.personAct.upsert({
          where: { personId_artistId: { personId, artistId: r.artistId } },
          create: { personId, ...r },
          update: { jobTitle: r.jobTitle },
        }),
      ),
    ]);
    await logActivity(user, "PERSON", personId, "updated person");
    revalidatePath("/", "layout");
    const made = [...(company.created ? [`company ${company.created}`] : []), ...acts.created.map((a) => `act ${a}`)];
    return { ok: `Saved.${made.length ? ` Added ${made.join(", ")}.` : ""}` };
  });
}

export async function deletePerson(personId: string) {
  const user = await requireStaff();
  const p = await prisma.person.findFirst({ where: { id: personId, agencyId: user.agencyId } });
  if (p) {
    // Their app login goes too; their acts and bookings stay.
    await prisma.user.deleteMany({ where: { personId, role: "ARTIST", agencyId: user.agencyId } });
    await prisma.person.delete({ where: { id: personId } });
    await logActivity(user, "PERSON", personId, "deleted person", personName(p));
  }
  redirect("/people");
}

/** Give a person their own login for the artist app (they see the gigs of every act they're in), or reset it. */
export async function setPersonLogin(personId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const email = required(form, "email", "Email").toLowerCase();
    const password = required(form, "password", "Password");
    if (password.length < 8) throw new FormError("Password must be at least 8 characters");
    const p = await ownPerson(user, personId);
    const clash = await prisma.user.findUnique({ where: { email } });
    if (clash && clash.id !== p.login?.id) throw new FormError("That email is already used by another login");
    const passwordHash = await hashPassword(password);
    if (p.login) {
      await prisma.user.update({ where: { id: p.login.id }, data: { email, passwordHash } });
      await prisma.session.deleteMany({ where: { userId: p.login.id } });
    } else {
      await prisma.user.create({ data: { email, name: personName(p), passwordHash, role: "ARTIST", personId, agencyId: user.agencyId } });
    }
    await logActivity(user, "PERSON", personId, p.login ? "reset app login" : "created app login", email);
    revalidatePath(`/people/${personId}`);
    return {
      ok: `Login saved. Share the email and password with ${personName(p)} so they can sign in on their phone. They'll see the bookings for every act they're in.`,
    };
  });
}

/** Add someone to an act from the act's page: an existing person, or a new one by name. */
export async function addActMember(artistId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const act = await prisma.artist.findFirst({ where: { id: artistId, agencyId: user.agencyId }, select: { id: true, name: true } });
    if (!act) throw new FormError("Act not found");
    const name = required(form, "person", "Name");
    const jobTitle = str(form, "jobTitle");
    const people = await prisma.person.findMany({ where: { agencyId: user.agencyId }, select: { id: true, firstName: true, surname: true, alias: true } });
    let person = people.find(
      (p) => personName(p).toLowerCase() === name.toLowerCase() || `${p.firstName} ${p.surname}`.trim().toLowerCase() === name.toLowerCase(),
    );
    let made = false;
    if (!person) {
      const [firstName, ...rest] = name.split(/\s+/);
      person = await prisma.person.create({
        data: { agencyId: user.agencyId, firstName, surname: rest.join(" ") },
        select: { id: true, firstName: true, surname: true, alias: true },
      });
      await logActivity(user, "PERSON", person.id, "added person", name);
      made = true;
    }
    await prisma.personAct.upsert({
      where: { personId_artistId: { personId: person.id, artistId } },
      create: { personId: person.id, artistId, jobTitle },
      update: { jobTitle },
    });
    await logActivity(user, "ARTIST", artistId, "added member", personName(person));
    revalidatePath(`/artists/${artistId}`);
    return { ok: `${personName(person)} is now in ${act.name}.${made ? " Open their name to add their phone, email and app login." : ""}` };
  });
}

export async function removeActMember(memberId: string) {
  const user = await requireStaff();
  const m = await prisma.personAct.findFirst({ where: { id: memberId, act: { agencyId: user.agencyId } }, include: { person: true } });
  if (!m) return;
  await prisma.personAct.delete({ where: { id: m.id } });
  await logActivity(user, "ARTIST", m.artistId, "removed member", personName(m.person));
  revalidatePath(`/artists/${m.artistId}`);
}

/** Build a band from other acts: put an act (e.g. "Graham McKee Solo") inside this one. */
export async function addActPart(parentId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const parent = await prisma.artist.findFirst({ where: { id: parentId, agencyId: user.agencyId }, select: { id: true, name: true } });
    if (!parent) throw new FormError("Act not found");
    // Members are picked from existing acts only; new acts are added under Acts first.
    const name = required(form, "act", "Act");
    const child = await prisma.artist.findFirst({ where: { agencyId: user.agencyId, name: same(name) }, select: { id: true, name: true } });
    if (!child) throw new FormError(`There's no act called “${name}”. Pick one from the list, or add it under Acts first.`);
    if (await wouldLoop(parentId, child.id)) throw new FormError(`${child.name} can't go inside ${parent.name}: ${parent.name} is already part of it.`);
    const role = str(form, "role");
    await prisma.actLink.upsert({
      where: { parentId_childId: { parentId, childId: child.id } },
      create: { parentId, childId: child.id, role },
      update: { role },
    });
    await logActivity(user, "ARTIST", parentId, "added act to line-up", child.name);
    revalidatePath(`/artists/${parentId}`);
    return { ok: `${child.name} is now a member of ${parent.name}.` };
  });
}

export async function removeActPart(linkId: string) {
  const user = await requireStaff();
  const l = await prisma.actLink.findFirst({ where: { id: linkId, parent: { agencyId: user.agencyId } }, include: { child: { select: { name: true } } } });
  if (!l) return;
  await prisma.actLink.delete({ where: { id: l.id } });
  await logActivity(user, "ARTIST", l.parentId, "removed act from line-up", l.child.name);
  revalidatePath(`/artists/${l.parentId}`);
}
