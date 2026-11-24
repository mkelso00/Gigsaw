"use server";

import { linkActLoginQuietly } from "@/lib/login-person";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashPassword, requireStaff, type AgencyUser } from "@/lib/auth";
import { bankChanged, completedAt, readPayFields, type PayFields } from "@/lib/act-details";
import { parseActProfile } from "@/lib/act-profile";
import { legalName, peopleOf } from "@/lib/payee";
import { loadPayActs } from "@/lib/payee-server";
import { actBookingCounts, actInUseMessage } from "@/lib/archive";
import { removeCalendarsOfLogins } from "@/lib/calendar-sync";
import { queueCalendarSync } from "@/lib/calendar-sync/queue";
import { CONTACT_TYPES } from "@/lib/constants";
import { BILLING_MODES } from "@/lib/monthly-billing";
import { ownContractTemplateId } from "@/lib/contract-templates-server";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, int, normaliseTags, num, oneOf, optStr, required, str, type FormState } from "@/lib/forms";
import { personName } from "@/lib/person-name";
import { isValidTimeZone } from "@/lib/time";

// Every lookup below includes the user's agencyId, so one agency can never read or change
// another agency's records, even by guessing an id.

/** Gigs that may be in acts' connected calendars (the act feed goes back 90 days), to sync after a change to an act or venue. */
async function calendarGigIds(where: { agencyId: string; artistId?: string; venueId?: string }) {
  const since = new Date(Date.now() - 90 * 86_400_000);
  return (await prisma.booking.findMany({ where: { ...where, setStart: { gte: since } }, select: { id: true } })).map((b) => b.id);
}

// ---------- Artists ----------

const NO_PAY: PayFields & { detailsCompletedAt: Date | null } = {
  bankAccountName: "",
  bankSortCode: "",
  bankAccountNumber: "",
  address: "",
  niNumber: "",
  phone: "",
  vatRegistered: false,
  vatNumber: "",
  detailsCompletedAt: null,
};

/**
 * The pay details from the act form. Only admins have these fields (see ArtistForm); for anyone
 * else nothing is returned, so an agent saving the form never changes or clears them.
 */
function payData(form: FormData, user: AgencyUser, before: PayFields & { detailsCompletedAt: Date | null }) {
  if (user.role !== "ADMIN") return {};
  const after = readPayFields(form, before, { required: false });
  return {
    bankAccountName: after.bankAccountName,
    bankSortCode: after.bankSortCode,
    bankAccountNumber: after.bankAccountNumber,
    vatRegistered: after.vatRegistered,
    vatNumber: after.vatNumber,
    address: after.address,
    niNumber: after.niNumber,
    detailsCompletedAt: completedAt(after, before.detailsCompletedAt),
  };
}

async function artistData(form: FormData, agencyId: string) {
  const colour = str(form, "colour");
  const commission = num(form, "defaultCommission");
  if (commission !== null && (commission < 0 || commission > 100)) throw new FormError("Commission must be between 0 and 100%");
  const agentId = optStr(form, "agentId");
  if (agentId && !(await prisma.user.findFirst({ where: { id: agentId, agencyId, role: { in: ["ADMIN", "AGENT"] } }, select: { id: true } }))) {
    throw new FormError("That agent is not part of your agency");
  }
  // Bank and VAT are left out here: they come from payData, for admins only.
  const { bankAccountName: _n, bankSortCode: _s, bankAccountNumber: _a, vatRegistered: _r, vatNumber: _v, ...profile } = parseActProfile(form);
  return {
    name: required(form, "name", "Name"),
    genre: str(form, "genre"),
    email: str(form, "email").toLowerCase(),
    phone: str(form, "phone"),
    colour: /^#[0-9a-f]{6}$/i.test(colour) ? colour : "#6d28d9",
    notes: str(form, "notes"),
    defaultCommission: commission,
    agentId,
    ...profile,
  };
}

/** "Invoices go to" from the act form: someone in the act, or nobody. Nothing when the form doesn't have it. */
async function leadData(form: FormData, user: AgencyUser, artistId: string): Promise<{ leadPersonId?: string | null; name: string }> {
  if (!form.has("leadPersonId")) return { name: "" };
  const id = str(form, "leadPersonId");
  if (!id) return { leadPersonId: null, name: "" };
  const act = (await loadPayActs(user.agencyId, [artistId])).get(artistId);
  const person = act && peopleOf(act).find((p) => p.id === id);
  if (!person) throw new FormError("Choose someone in the act for its invoices");
  return { leadPersonId: person.id, name: legalName(person) };
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
    const data = await artistData(form, user.agencyId);
    const artist = await prisma.artist.create({ data: { ...data, ...payData(form, user, { ...NO_PAY, phone: data.phone }), agencyId: user.agencyId } });
    await logActivity(user, "ARTIST", artist.id, "added artist", artist.name);
    id = artist.id;
  });
  if (res?.error) return res;
  redirect(`/artists/${id}`);
}

export async function updateArtist(artistId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  const res = await handleForm(async () => {
    const before = await ownArtist(user, artistId);
    const lead = await leadData(form, user, artistId);
    const saved = await prisma.artist.update({
      where: { id: artistId },
      data: {
        ...(await artistData(form, user.agencyId)),
        ...payData(form, user, before),
        ...(lead.leadPersonId !== undefined ? { leadPersonId: lead.leadPersonId } : {}),
      },
    });
    if (lead.leadPersonId !== undefined && lead.leadPersonId !== before.leadPersonId) {
      // Who gets paid is worth seeing on its own in the log.
      await logActivity(user, "ARTIST", artistId, lead.leadPersonId ? "chose who invoices go to" : "cleared who invoices go to", lead.name);
    }
    // The act's name is in its calendar events.
    if (saved.name !== before.name) queueCalendarSync(await calendarGigIds({ agencyId: user.agencyId, artistId }));
    await logActivity(user, "ARTIST", artistId, "updated artist");
    // A change of bank account is worth seeing on its own in the log (never with the numbers).
    if (bankChanged(before, saved)) await logActivity(user, "ARTIST", artistId, "changed bank details");
  });
  if (res?.error) return res;
  revalidatePath("/", "layout");
  redirect(`/artists/${artistId}`);
}

export async function deleteArtist(artistId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  const res = await handleForm(async () => {
    await ownArtist(user, artistId);
    // Archived bookings count too: they still point at the act, so deleting it would fail.
    const inUse = actInUseMessage(await actBookingCounts(prisma, artistId));
    if (inUse) throw new FormError(inUse);
    // The login's connected calendar goes with it: take Gigsaw's events out first (a band's gigs, say).
    await removeCalendarsOfLogins({ artistId, role: "ARTIST" });
    // Together, so the act's login isn't removed if the act itself can't be deleted.
    await prisma.$transaction([prisma.user.deleteMany({ where: { artistId, role: "ARTIST" } }), prisma.artist.delete({ where: { id: artistId } })]);
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
      const login = await prisma.user.create({ data: { email, name: artist.name, passwordHash, role: "ARTIST", artistId, agencyId: user.agencyId } });
      await linkActLoginQuietly(login.id);
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

/** "Contract for this client", when the form has it: one of the business's contract types, or none. */
async function contactContract(user: AgencyUser, form: FormData) {
  return form.has("contractTemplateId") ? { contractTemplateId: await ownContractTemplateId(user.agencyId, str(form, "contractTemplateId")) } : {};
}

function contactData(form: FormData) {
  return {
    type: oneOf(str(form, "type"), CONTACT_TYPES, "PROMOTER"),
    name: required(form, "name", "Name"),
    company: str(form, "company"),
    email: str(form, "email").toLowerCase(),
    phone: str(form, "phone"),
    address: str(form, "address"),
    tags: normaliseTags(str(form, "tags")),
    // "Monthly bill", when the form has it: one bill for all the company's venues, or one per venue.
    ...(form.has("billing") ? { billing: oneOf(str(form, "billing"), BILLING_MODES, "COMBINED") } : {}),
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
    const c = await prisma.contact.create({ data: { ...contactData(form), ...(await contactContract(user, form)), agencyId: user.agencyId } });
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
    await prisma.contact.update({ where: { id: contactId }, data: { ...contactData(form), ...(await contactContract(user, form)) } });
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

// ---------- The client's lead contact (src/lib/client-recipient.ts) ----------

/** The "Lead contact for bookings" select: one of the people at this venue or company, or nobody. */
async function leadFrom(user: AgencyUser, form: FormData, at: { venueId: string } | { companyId: string }) {
  const id = str(form, "leadContactId");
  if (!id) return null;
  const person = await prisma.person.findFirst({ where: { id, agencyId: user.agencyId, ...at } });
  if (!person) throw new FormError("That person isn't here any more. Reload the page.");
  return person;
}

/** "Lead contact for bookings" on a venue's page: who its gigs' client messages go to, unless a booking names someone. */
export async function setVenueLeadContact(venueId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const venue = await prisma.venue.findFirst({ where: { id: venueId, agencyId: user.agencyId } });
    if (!venue) throw new FormError("Venue not found");
    const lead = await leadFrom(user, form, { venueId });
    if ((lead?.id ?? null) === venue.leadContactId) return { ok: "Saved." };
    await prisma.venue.update({ where: { id: venueId }, data: { leadContactId: lead?.id ?? null } });
    await logActivity(
      user,
      "VENUE",
      venueId,
      lead ? "chose the lead contact for bookings" : "cleared the lead contact for bookings",
      lead ? personName(lead) : "",
    );
    revalidatePath(`/venues/${venueId}`);
    return { ok: lead ? `Saved. ${personName(lead)} gets the client's messages for bookings here.` : "Saved. There's no lead contact here now." };
  });
}

/**
 * On a company's page: its lead contact for bookings, and "Send day-to-day emails to this company's own email"
 * (Contact.notifyOwner). Off, with no lead contact, its arrival notes and confirmations aren't sent at all.
 */
export async function setCompanyLeadContact(contactId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const c = await ownContact(user, contactId);
    const lead = await leadFrom(user, form, { companyId: contactId });
    const notifyOwner = form.get("notifyOwner") === "on";
    await prisma.contact.update({ where: { id: contactId }, data: { leadContactId: lead?.id ?? null, notifyOwner } });
    if ((lead?.id ?? null) !== c.leadContactId) {
      await logActivity(
        user,
        "CONTACT",
        contactId,
        lead ? "chose the lead contact for bookings" : "cleared the lead contact for bookings",
        lead ? personName(lead) : "",
      );
    }
    if (notifyOwner !== c.notifyOwner) {
      await logActivity(user, "CONTACT", contactId, notifyOwner ? "day-to-day emails to its own email on" : "day-to-day emails to its own email off");
    }
    revalidatePath(`/contacts/${contactId}`);
    return { ok: "Saved." };
  });
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
    priority: form.get("priority") === "on",
  };
}

/** Star or unstar a venue from the Venues list: priority venues are listed first everywhere venues are picked. */
export async function setVenuePriority(venueId: string, priority: boolean) {
  const user = await requireStaff();
  const v = await prisma.venue.updateMany({ where: { id: venueId, agencyId: user.agencyId }, data: { priority } });
  if (!v.count) return;
  await logActivity(user, "VENUE", venueId, priority ? "made a priority venue" : "no longer a priority venue");
  revalidatePath("/venues");
  revalidatePath("/calendar");
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
    // The venue's name, address and time zone are in the acts' calendar events.
    const gigIds = await calendarGigIds({ agencyId: user.agencyId, venueId });
    if (before.timezone !== data.timezone) {
      // Keep future bookings on the venue's clock. Their stored UTC times stay as they are,
      // so the agency should check the times on those bookings.
      // Archived ones too (archivedAt: undefined), so a booking restored later isn't left on the old clock.
      const n = await prisma.booking.updateMany({
        where: { venueId, agencyId: user.agencyId, setStart: { gte: new Date() }, archivedAt: undefined },
        data: { timezone: data.timezone },
      });
      note = ` Time zone changed: check the times on ${n.count} upcoming booking(s).`;
    }
    queueCalendarSync(gigIds);
    await logActivity(user, "VENUE", venueId, "updated venue");
    revalidatePath("/", "layout");
    return { ok: `Venue saved.${note}` };
  });
}

export async function deleteVenue(venueId: string) {
  const user = await requireStaff();
  // Read before: the gigs lose their venue, so their events lose the address.
  const gigIds = await calendarGigIds({ agencyId: user.agencyId, venueId });
  const { count } = await prisma.venue.deleteMany({ where: { id: venueId, agencyId: user.agencyId } });
  if (count) queueCalendarSync(gigIds);
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
  // Its lead contact moved with its people: they're the venue's now (unless it already has one).
  if (c.leadContactId) {
    await prisma.venue.updateMany({ where: { id: venue.id, leadContactId: null }, data: { leadContactId: c.leadContactId } });
    await prisma.contact.update({ where: { id: c.id }, data: { leadContactId: null } });
  }
  // Keep the company if it's who pays for any bookings; otherwise it's no longer needed.
  // Archived bookings count (archivedAt: undefined): deleting the company would clear who paid for them.
  const used = await prisma.booking.count({ where: { promoterId: c.id, archivedAt: undefined } });
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
      // Its people move to the company, its lead contact with them.
      leadContactId: v.leadContactId,
    },
  });
  await prisma.person.updateMany({ where: { agencyId: user.agencyId, venueId: v.id }, data: { venueId: null, companyId: company.id } });
  await prisma.venue.delete({ where: { id: v.id } });
  await logActivity(user, "CONTACT", company.id, "made a company from a venue", v.name);
  revalidatePath("/", "layout");
  redirect(`/contacts/${company.id}`);
}
