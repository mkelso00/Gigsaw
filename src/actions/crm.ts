"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashPassword, requireStaff, type AgencyUser } from "@/lib/auth";
import { parseActProfile } from "@/lib/act-profile";
import { CONTACT_TYPES } from "@/lib/constants";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, int, normaliseTags, num, oneOf, optStr, required, str, type FormState } from "@/lib/forms";
import { isValidTimeZone } from "@/lib/time";

// Every lookup below includes the user's agencyId, so one agency can never read or change
// another agency's records, even by guessing an id.

// ---------- Artists ----------

async function artistData(form: FormData, agencyId: string) {
  const colour = str(form, "colour");
  const commission = num(form, "defaultCommission");
  if (commission !== null && (commission < 0 || commission > 100)) throw new FormError("Commission must be between 0 and 100%");
  const agentId = optStr(form, "agentId");
  if (agentId && !(await prisma.user.findFirst({ where: { id: agentId, agencyId, role: { in: ["ADMIN", "AGENT"] } }, select: { id: true } }))) {
    throw new FormError("That agent is not part of your agency");
  }
  return {
    name: required(form, "name", "Name"),
    genre: str(form, "genre"),
    email: str(form, "email").toLowerCase(),
    phone: str(form, "phone"),
    colour: /^#[0-9a-f]{6}$/i.test(colour) ? colour : "#6d28d9",
    notes: str(form, "notes"),
    defaultCommission: commission,
    agentId,
    ...parseActProfile(form),
  };
}

async function ownArtist(user: AgencyUser, artistId: string) {
  const artist = await prisma.artist.findFirst({ where: { id: artistId, agencyId: user.agencyId }, include: { login: true } });
  if (!artist) throw new FormError("Artist not found");
  return artist;
}

export async function createArtist(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  let id = "";
  const res = await handleForm(async () => {
    const artist = await prisma.artist.create({ data: { ...(await artistData(form, user.agencyId)), agencyId: user.agencyId } });
    await logActivity(user, "ARTIST", artist.id, "added artist", artist.name);
    id = artist.id;
  });
  if (res?.error) return res;
  redirect(`/artists/${id}`);
}

export async function updateArtist(artistId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  const res = await handleForm(async () => {
    await ownArtist(user, artistId);
    await prisma.artist.update({ where: { id: artistId }, data: await artistData(form, user.agencyId) });
    await logActivity(user, "ARTIST", artistId, "updated artist");
  });
  if (res?.error) return res;
  revalidatePath("/", "layout");
  redirect(`/artists/${artistId}`);
}

export async function deleteArtist(artistId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  const res = await handleForm(async () => {
    await ownArtist(user, artistId);
    const bookings = await prisma.booking.count({ where: { artistId } });
    if (bookings > 0) throw new FormError(`This artist has ${bookings} booking(s). Delete or reassign them first.`);
    await prisma.user.deleteMany({ where: { artistId, role: "ARTIST" } });
    await prisma.artist.delete({ where: { id: artistId } });
    await logActivity(user, "ARTIST", artistId, "deleted artist");
  });
  if (res?.error) return res;
  redirect("/artists");
}

/** Give an artist a login for the artist app, or reset their password. */
export async function setArtistLogin(artistId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const email = required(form, "email", "Email").toLowerCase();
    const password = required(form, "password", "Password");
    if (password.length < 8) throw new FormError("Password must be at least 8 characters");
    const artist = await ownArtist(user, artistId);
    const clash = await prisma.user.findUnique({ where: { email } });
    if (clash && clash.id !== artist.login?.id) throw new FormError("That email is already used by another login");
    const passwordHash = await hashPassword(password);
    if (artist.login) {
      await prisma.user.update({ where: { id: artist.login.id }, data: { email, passwordHash } });
      await prisma.session.deleteMany({ where: { userId: artist.login.id } });
    } else {
      await prisma.user.create({ data: { email, name: artist.name, passwordHash, role: "ARTIST", artistId, agencyId: user.agencyId } });
    }
    await logActivity(user, "ARTIST", artistId, artist.login ? "reset artist login" : "created artist login", email);
    revalidatePath(`/artists/${artistId}`);
    return { ok: `Login saved. Share the email and password with ${artist.name} so they can sign in on their phone.` };
  });
}

export async function resetCalendarToken(artistId: string) {
  const user = await requireStaff();
  await prisma.artist.updateMany({ where: { id: artistId, agencyId: user.agencyId }, data: { calendarToken: randomUUID() } });
  revalidatePath(`/artists/${artistId}`);
}

// ---------- Contacts ----------

function contactData(form: FormData) {
  return {
    type: oneOf(str(form, "type"), CONTACT_TYPES, "PROMOTER"),
    name: required(form, "name", "Name"),
    company: str(form, "company"),
    email: str(form, "email").toLowerCase(),
    phone: str(form, "phone"),
    address: str(form, "address"),
    tags: normaliseTags(str(form, "tags")),
  };
}

async function ownContact(user: AgencyUser, contactId: string) {
  const c = await prisma.contact.findFirst({ where: { id: contactId, agencyId: user.agencyId } });
  if (!c) throw new FormError("Contact not found");
  return c;
}

export async function createContact(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  let id = "";
  const res = await handleForm(async () => {
    const c = await prisma.contact.create({ data: { ...contactData(form), agencyId: user.agencyId } });
    await logActivity(user, "CONTACT", c.id, "added contact", c.name);
    id = c.id;
  });
  if (res?.error) return res;
  redirect(`/contacts/${id}`);
}

export async function updateContact(contactId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  const res = await handleForm(async () => {
    await ownContact(user, contactId);
    await prisma.contact.update({ where: { id: contactId }, data: contactData(form) });
    await logActivity(user, "CONTACT", contactId, "updated contact");
  });
  if (res?.error) return res;
  redirect(`/contacts/${contactId}`);
}

export async function deleteContact(contactId: string) {
  const user = await requireStaff();
  const { count } = await prisma.contact.deleteMany({ where: { id: contactId, agencyId: user.agencyId } });
  if (count) await logActivity(user, "CONTACT", contactId, "deleted contact");
  redirect("/contacts");
}

export async function addContactNote(contactId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const body = required(form, "body", "Note");
    await ownContact(user, contactId);
    await prisma.contactNote.create({ data: { contactId, body, authorId: user.id } });
    revalidatePath(`/contacts/${contactId}`);
    return { ok: "Note added." };
  });
}

export async function deleteContactNote(noteId: string) {
  const user = await requireStaff();
  const n = await prisma.contactNote.findFirst({ where: { id: noteId, contact: { agencyId: user.agencyId } } });
  if (!n) return;
  await prisma.contactNote.delete({ where: { id: n.id } });
  revalidatePath(`/contacts/${n.contactId}`);
}

// ---------- Venues ----------

function venueData(form: FormData) {
  const latitude = num(form, "latitude");
  const longitude = num(form, "longitude");
  if ((latitude === null) !== (longitude === null)) throw new FormError("Enter both latitude and longitude, or neither");
  if (latitude !== null && Math.abs(latitude) > 90) throw new FormError("Latitude must be between -90 and 90");
  if (longitude !== null && Math.abs(longitude) > 180) throw new FormError("Longitude must be between -180 and 180");
  const timezone = str(form, "timezone") || "Europe/London";
  if (!isValidTimeZone(timezone)) throw new FormError("Unknown time zone");
  const capacity = int(form, "capacity");
  return {
    name: required(form, "name", "Name"),
    address: str(form, "address"),
    city: str(form, "city"),
    country: str(form, "country"),
    capacity: capacity !== null && capacity > 0 ? capacity : null,
    latitude,
    longitude,
    timezone,
    colour: /^#[0-9a-f]{6}$/i.test(str(form, "colour")) ? str(form, "colour") : "",
    notes: str(form, "notes"),
  };
}

export async function createVenue(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  let id = "";
  const res = await handleForm(async () => {
    const v = await prisma.venue.create({ data: { ...venueData(form), agencyId: user.agencyId } });
    await logActivity(user, "VENUE", v.id, "added venue", v.name);
    id = v.id;
  });
  if (res?.error) return res;
  redirect(`/venues/${id}`);
}

export async function updateVenue(venueId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const data = venueData(form);
    const before = await prisma.venue.findFirst({ where: { id: venueId, agencyId: user.agencyId } });
    if (!before) throw new FormError("Venue not found");
    await prisma.venue.update({ where: { id: venueId }, data });
    let note = "";
    if (before.timezone !== data.timezone) {
      // Keep future bookings on the venue's clock. Their stored UTC times stay as they are,
      // so the agency should check the times on those bookings.
      const n = await prisma.booking.updateMany({
        where: { venueId, agencyId: user.agencyId, setStart: { gte: new Date() } },
        data: { timezone: data.timezone },
      });
      note = ` Time zone changed: check the times on ${n.count} upcoming booking(s).`;
    }
    await logActivity(user, "VENUE", venueId, "updated venue");
    revalidatePath("/", "layout");
    return { ok: `Venue saved.${note}` };
  });
}

export async function deleteVenue(venueId: string) {
  const user = await requireStaff();
  const { count } = await prisma.venue.deleteMany({ where: { id: venueId, agencyId: user.agencyId } });
  if (count) await logActivity(user, "VENUE", venueId, "deleted venue");
  redirect("/venues");
}

/** Make (or replace) the venue's private line-up link. The old link stops working. */
export async function makeVenueShareLink(venueId: string) {
  const user = await requireStaff();
  const { randomBytes } = await import("node:crypto");
  const { count } = await prisma.venue.updateMany({
    where: { id: venueId, agencyId: user.agencyId },
    data: { shareToken: randomBytes(24).toString("base64url") },
  });
  if (count) await logActivity(user, "VENUE", venueId, "made a new venue line-up link");
  revalidatePath(`/venues/${venueId}`);
}

/** Turn the venue's line-up link off. */
export async function removeVenueShareLink(venueId: string) {
  const user = await requireStaff();
  const { count } = await prisma.venue.updateMany({ where: { id: venueId, agencyId: user.agencyId }, data: { shareToken: null } });
  if (count) await logActivity(user, "VENUE", venueId, "turned off the venue line-up link");
  revalidatePath(`/venues/${venueId}`);
}

// ---------- Companies and venues: moving one to the other ----------
// Overture keeps venues and client companies (e.g. a record label booking a band for a party) in
// one list, so after an import some may be in the wrong place. These move them across, taking the
// people who work there with them.

/** A company that's really a venue: make the venue and move its people to it. */
export async function companyToVenue(contactId: string) {
  const user = await requireStaff();
  const c = await prisma.contact.findFirst({ where: { id: contactId, agencyId: user.agencyId, type: { not: "CLIENT" } } });
  if (!c) return;
  const name = c.company || c.name;
  const venue =
    (await prisma.venue.findFirst({ where: { agencyId: user.agencyId, name: { equals: name, mode: "insensitive" } } })) ??
    (await prisma.venue.create({ data: { agencyId: user.agencyId, name, address: c.address, importRef: c.importRef } }));
  await prisma.person.updateMany({ where: { agencyId: user.agencyId, companyId: c.id }, data: { companyId: null, venueId: venue.id } });
  // Keep the company if it's who pays for any bookings; otherwise it's no longer needed.
  const used = await prisma.booking.count({ where: { promoterId: c.id } });
  const usedByEvents = await prisma.event.count({ where: { customerId: c.id } });
  if (!used && !usedByEvents) await prisma.contact.delete({ where: { id: c.id } });
  await logActivity(user, "VENUE", venue.id, "made a venue from a company", name);
  revalidatePath("/", "layout");
  redirect(`/venues/${venue.id}`);
}

/** A venue that's really a client company: make the company and move its people to it. */
export async function venueToCompany(venueId: string) {
  const user = await requireStaff();
  const v = await prisma.venue.findFirst({
    where: { id: venueId, agencyId: user.agencyId },
    include: { _count: { select: { bookings: true, slots: true, events: true } } },
  });
  if (!v) return;
  if (v._count.bookings || v._count.slots || v._count.events) return; // it's being used as a venue
  const company = await prisma.contact.create({
    data: {
      agencyId: user.agencyId,
      type: "COMPANY",
      name: v.name,
      company: v.name,
      address: [v.address, v.city].filter(Boolean).join(", "),
      importRef: v.importRef,
    },
  });
  await prisma.person.updateMany({ where: { agencyId: user.agencyId, venueId: v.id }, data: { venueId: null, companyId: company.id } });
  await prisma.venue.delete({ where: { id: v.id } });
  await logActivity(user, "CONTACT", company.id, "made a company from a venue", v.name);
  revalidatePath("/", "layout");
  redirect(`/contacts/${company.id}`);
}
