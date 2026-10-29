"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashPassword, requireStaff } from "@/lib/auth";
import { CONTACT_TYPES } from "@/lib/constants";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, int, normaliseTags, num, oneOf, optStr, required, str, type FormState } from "@/lib/forms";
import { isValidTimeZone } from "@/lib/time";

// ---------- Artists ----------

function artistData(form: FormData) {
  const colour = str(form, "colour");
  const commission = num(form, "defaultCommission");
  if (commission !== null && (commission < 0 || commission > 100)) throw new FormError("Commission must be between 0 and 100%");
  return {
    name: required(form, "name", "Name"),
    genre: str(form, "genre"),
    email: str(form, "email").toLowerCase(),
    phone: str(form, "phone"),
    colour: /^#[0-9a-f]{6}$/i.test(colour) ? colour : "#6d28d9",
    notes: str(form, "notes"),
    defaultCommission: commission,
    agentId: optStr(form, "agentId"),
  };
}

export async function createArtist(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  let id = "";
  const res = await handleForm(async () => {
    const artist = await prisma.artist.create({ data: artistData(form) });
    await logActivity(user.id, "ARTIST", artist.id, "added artist", artist.name);
    id = artist.id;
  });
  if (res?.error) return res;
  redirect(`/artists/${id}`);
}

export async function updateArtist(artistId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  const res = await handleForm(async () => {
    await prisma.artist.update({ where: { id: artistId }, data: artistData(form) });
    await logActivity(user.id, "ARTIST", artistId, "updated artist");
  });
  if (res?.error) return res;
  revalidatePath("/", "layout");
  redirect(`/artists/${artistId}`);
}

export async function deleteArtist(artistId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  const bookings = await prisma.booking.count({ where: { artistId } });
  if (bookings > 0) return { error: `This artist has ${bookings} booking(s). Delete or reassign them first.` };
  await prisma.user.deleteMany({ where: { artistId, role: "ARTIST" } });
  await prisma.artist.delete({ where: { id: artistId } });
  await logActivity(user.id, "ARTIST", artistId, "deleted artist");
  redirect("/artists");
}

/** Give an artist a login for the artist app, or reset their password. */
export async function setArtistLogin(artistId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const email = required(form, "email", "Email").toLowerCase();
    const password = required(form, "password", "Password");
    if (password.length < 8) throw new FormError("Password must be at least 8 characters");
    const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId }, include: { login: true } });
    const clash = await prisma.user.findUnique({ where: { email } });
    if (clash && clash.id !== artist.login?.id) throw new FormError("That email is already used by another login");
    const passwordHash = await hashPassword(password);
    if (artist.login) {
      await prisma.user.update({ where: { id: artist.login.id }, data: { email, passwordHash } });
      await prisma.session.deleteMany({ where: { userId: artist.login.id } });
    } else {
      await prisma.user.create({ data: { email, name: artist.name, passwordHash, role: "ARTIST", artistId } });
    }
    await logActivity(user.id, "ARTIST", artistId, artist.login ? "reset artist login" : "created artist login", email);
    revalidatePath(`/artists/${artistId}`);
    return { ok: `Login saved. Share the email and password with ${artist.name} so they can sign in on their phone.` };
  });
}

export async function resetCalendarToken(artistId: string) {
  await requireStaff();
  await prisma.artist.update({ where: { id: artistId }, data: { calendarToken: randomUUID() } });
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

export async function createContact(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  let id = "";
  const res = await handleForm(async () => {
    const c = await prisma.contact.create({ data: contactData(form) });
    await logActivity(user.id, "CONTACT", c.id, "added contact", c.name);
    id = c.id;
  });
  if (res?.error) return res;
  redirect(`/contacts/${id}`);
}

export async function updateContact(contactId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  const res = await handleForm(async () => {
    await prisma.contact.update({ where: { id: contactId }, data: contactData(form) });
    await logActivity(user.id, "CONTACT", contactId, "updated contact");
  });
  if (res?.error) return res;
  redirect(`/contacts/${contactId}`);
}

export async function deleteContact(contactId: string) {
  const user = await requireStaff();
  await prisma.contact.delete({ where: { id: contactId } });
  await logActivity(user.id, "CONTACT", contactId, "deleted contact");
  redirect("/contacts");
}

export async function addContactNote(contactId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const body = required(form, "body", "Note");
    await prisma.contactNote.create({ data: { contactId, body, authorId: user.id } });
    revalidatePath(`/contacts/${contactId}`);
    return { ok: "Note added." };
  });
}

export async function deleteContactNote(noteId: string) {
  await requireStaff();
  const n = await prisma.contactNote.delete({ where: { id: noteId } });
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
    notes: str(form, "notes"),
  };
}

export async function createVenue(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  let id = "";
  const res = await handleForm(async () => {
    const v = await prisma.venue.create({ data: venueData(form) });
    await logActivity(user.id, "VENUE", v.id, "added venue", v.name);
    id = v.id;
  });
  if (res?.error) return res;
  redirect(`/venues/${id}`);
}

export async function updateVenue(venueId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const data = venueData(form);
    const before = await prisma.venue.findUniqueOrThrow({ where: { id: venueId } });
    await prisma.venue.update({ where: { id: venueId }, data });
    let note = "";
    if (before.timezone !== data.timezone) {
      // Keep future bookings on the venue's clock. Their stored UTC times stay as they are,
      // so the agency should check the times on those bookings.
      const n = await prisma.booking.updateMany({ where: { venueId, setStart: { gte: new Date() } }, data: { timezone: data.timezone } });
      note = ` Time zone changed: check the times on ${n.count} upcoming booking(s).`;
    }
    await logActivity(user.id, "VENUE", venueId, "updated venue");
    revalidatePath("/", "layout");
    return { ok: `Venue saved.${note}` };
  });
}

export async function deleteVenue(venueId: string) {
  const user = await requireStaff();
  await prisma.venue.delete({ where: { id: venueId } });
  await logActivity(user.id, "VENUE", venueId, "deleted venue");
  redirect("/venues");
}
