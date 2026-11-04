import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Enquiry, Settings as AgencySettings } from "@prisma/client";
import { createBookingWithReference } from "./bookings";
import { prisma } from "./db";
import {
  enquiryMakes,
  enquiryNote,
  enquiryRows,
  enquiryTitle,
  enquiryTypeLabel,
  firstName,
  formatDay,
  RateLimiter,
  readEnquiryConfig,
  type EnquiryChannel,
  type EnquiryData,
  type EnquiryDetails,
} from "./enquiries";
import { defaultTasks } from "./event-plan";
import { messageFor } from "./message-templates";
import { appUrl, sendEmail, sendPush } from "./messaging";
import { defaultBookingFee } from "./money";
import { wants } from "./notify-prefs";
import { buildSchedule } from "./schedule";

// The enquiry form's server side: the secret that signs the form's time stamp, rate limiting by
// IP address, what an enquiry makes (from the form, or added by hand), and the emails and phone
// notifications when one comes in.

let secret: string | null = null;

/** A secret made once and kept in the database, so every server signs and checks stamps alike. */
export async function enquirySecret() {
  if (process.env.ENQUIRY_SECRET) return process.env.ENQUIRY_SECRET;
  if (secret) return secret;
  await prisma.appSecret.createMany({ data: [{ key: "enquiry", value: randomBytes(32).toString("base64url") }], skipDuplicates: true });
  return (secret = (await prisma.appSecret.findUniqueOrThrow({ where: { key: "enquiry" } })).value);
}

/** The sender's IP address, as passed on by the host's proxy (Railway sets x-forwarded-for). */
export function clientIp(h: Headers) {
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || "unknown";
}

/** A one-way hash of the IP address, so it can be counted without being kept. */
export function ipHash(ip: string, key: string) {
  return createHash("sha256").update(`${key}:${ip}`).digest("base64url").slice(0, 32);
}

// Attempts per IP address (good or bad), kept across hot reloads in development.
const g = globalThis as unknown as { enquiryAttempts?: RateLimiter };
export const enquiryAttempts = (g.enquiryAttempts ??= new RateLimiter(10, 10 * 60_000));

/** Saved enquiries allowed from one IP address in an hour, across every business. */
export const MAX_PER_IP_PER_HOUR = 5;

/**
 * Save an enquiry and what it makes, the same way whether it came from the website form or staff
 * typed it in from an email or phone call: the customer (the one on file with this email, or a new
 * private customer), a note on them, and a wedding (an event) or an Enquiry booking once there's a
 * date. Sends nothing: the caller decides on the auto-reply and the team's emails.
 */
export async function recordEnquiry(o: {
  settings: AgencySettings;
  d: EnquiryData;
  channel: EnquiryChannel;
  /** The website the form was sent from, if known. */
  source?: string;
  ipHash?: string;
  /** Who looks after what it makes (the person chosen for enquiries, or whoever added it). */
  agentId: string | null;
  /** Staff who added it by hand, for the note and the activity log. */
  addedBy?: { id: string; name: string } | null;
}): Promise<Enquiry> {
  const { settings, d, channel } = o;
  const agencyId = settings.agencyId;
  const tz = settings.defaultTimezone;
  const source = o.source ?? "";
  const how = channel === "EMAIL" ? "by email" : channel === "PHONE" ? "by phone" : "";
  const note = enquiryNote(d, source, o.addedBy ? `Enquiry${how ? ` ${how}` : ""}, added by ${o.addedBy.name}` : undefined);

  // The customer: the one already on file with this email, or a new private customer.
  let contact = d.email
    ? await prisma.contact.findFirst({ where: { agencyId, email: { equals: d.email, mode: "insensitive" } }, orderBy: { createdAt: "asc" } })
    : null;
  const contactCreated = !contact;
  if (!contact) {
    contact = await prisma.contact.create({
      data: { agencyId, type: "CLIENT", name: d.name, email: d.email, phone: d.phone, tags: d.eventType === "WEDDING" ? "wedding" : "" },
    });
  } else if (!contact.phone && d.phone) {
    await prisma.contact.update({ where: { id: contact.id }, data: { phone: d.phone } });
  }
  await prisma.contactNote.create({ data: { contactId: contact.id, body: note, authorId: o.addedBy?.id ?? null } });

  let bookingId: string | null = null;
  let eventId: string | null = null;
  const makes = enquiryMakes(d);
  if (makes === "EVENT") {
    // A wedding: the agency adds the acts later. No automatic emails to the couple until they switch them on.
    const e = await prisma.event.create({
      data: {
        agencyId,
        name: enquiryTitle(d),
        type: "WEDDING",
        date: d.date,
        timezone: tz,
        customerId: contact.id,
        venueText: d.venue,
        guestCount: d.guests,
        agentId: o.agentId,
        notes: note,
        autoEmails: false,
        plannerToken: randomBytes(18).toString("base64url"),
        tasks: { create: defaultTasks("WEDDING", d.date) },
      },
    });
    eventId = e.id;
  } else if (makes === "BOOKING") {
    const eventType = d.eventType || "OTHER";
    // Bookings need a time: with none given, 19:00 holds the place until it's agreed.
    const time = d.startTime || "19:00";
    const b = await createBookingWithReference(agencyId, {
      ...buildSchedule(d.date, { arrive: time, setStart: time, setEnd: d.startTime && d.endTime ? d.endTime : null }, tz),
      status: "ENQUIRY",
      eventType,
      eventName: enquiryTitle(d),
      timezone: tz,
      currency: settings.defaultCurrency,
      commissionPct: settings.defaultCommission,
      bookingFeeMinor: defaultBookingFee(settings, { eventType }),
      promoterId: contact.id,
      agentId: o.agentId,
      createdById: o.addedBy?.id ?? null,
      tags: channel === "WEBSITE" ? "website" : "",
      notes: d.startTime ? note : `${note}\n\nNo start time given: 19:00 is a placeholder.`,
    });
    bookingId = b.id;
  }

  const enquiry = await prisma.enquiry.create({
    data: { agencyId, ...d, contactId: contact.id, contactCreated, bookingId, eventId, source, channel, ipHash: o.ipHash ?? "" },
  });
  const what = [d.name, d.eventType ? enquiryTypeLabel(d.eventType).toLowerCase() : "", d.date ? formatDay(d.date) : ""].filter(Boolean).join(", ");
  await prisma.activity.create({
    data: {
      agencyId,
      userId: o.addedBy?.id ?? null,
      entity: bookingId ? "BOOKING" : eventId ? "EVENT" : "ENQUIRY",
      entityId: bookingId ?? eventId ?? enquiry.id,
      action: o.addedBy ? `added an enquiry${how ? ` that came ${how}` : ""}` : "sent an enquiry from your website",
      detail: what,
    },
  });
  return enquiry;
}

type Settings = { agencyId: string; agencyName: string; agencyEmail: string; alertEmail: string; messageTemplates: unknown; enquiryForm: unknown };

function details(e: Enquiry): EnquiryDetails {
  return { ...e, acts: Array.isArray(e.acts) ? (e.acts as { id: string; name: string }[]) : [] };
}

/** Who hears about new enquiries: people (with their own alert choices) and plain addresses. */
async function recipients(s: Settings) {
  const notify = readEnquiryConfig(s.enquiryForm).notify;
  const businessEmail = s.agencyEmail || s.alertEmail;
  const staff = { agencyId: s.agencyId, role: { in: ["ADMIN", "AGENT"] } };
  const users =
    notify === "BUSINESS"
      ? []
      : await prisma.user.findMany({
          where: notify === "ADMINS" ? { ...staff, role: "ADMIN" } : notify === "TEAM" ? staff : { ...staff, id: notify.slice(5) },
          select: { id: true, email: true, notifyPrefs: true },
        });
  // Nobody to tell (e.g. the chosen person has left): the business email hears instead.
  return { users, emails: users.length ? [] : businessEmail ? [businessEmail] : [] };
}

/** Tell the team about a new enquiry, by email and phone notification, as each person has chosen. */
export async function notifyTeam(enquiryId: string) {
  const e = await prisma.enquiry.findUnique({ where: { id: enquiryId }, include: { agency: { include: { settings: true } } } });
  const s = e?.agency.settings;
  if (!e || !s) return;
  const business = s.agencyName || e.agency.name;
  const vars = { name: e.name, event_type: enquiryTypeLabel(e.eventType), date: e.date ? formatDay(e.date) : "", business };
  const t = messageFor(s.messageTemplates, "NEW_ENQUIRY", vars);
  if (!t.on) return;
  const what = [enquiryTypeLabel(e.eventType), e.date ? formatDay(e.date) : ""].filter(Boolean).join(", ");
  const subject = t.subject ?? `New enquiry: ${e.name}${what ? `, ${what}` : ""}`;
  const url = `${appUrl()}/enquiries#${e.id}`;
  const base = { kind: "ENQUIRY" as const, agencyId: e.agencyId, bookingId: e.bookingId };
  const email = (to: string) =>
    sendEmail({
      ...base,
      to,
      // Reply straight to the customer.
      replyTo: e.email,
      subject,
      email: {
        brand: business,
        preheader: e.message.slice(0, 120) || what,
        title: `New enquiry from ${e.name}`,
        intro: t.intro ?? `${e.name} has sent an enquiry from your website${e.source ? ` (${e.source})` : ""}. Reply to this email to answer them.`,
        rows: enquiryRows(details(e)),
        cta: { label: "Open enquiries", url },
      },
    });
  const { users, emails } = await recipients({ ...s, agencyName: business });
  for (const u of users) {
    if (wants(u.notifyPrefs, "ENQUIRY", "email")) await email(u.email);
    if (wants(u.notifyPrefs, "ENQUIRY", "push"))
      await sendPush({
        ...base,
        userId: u.id,
        payload: { title: `New enquiry: ${e.name}`, body: what || e.message.slice(0, 120), url: `/enquiries#${e.id}`, tag: `enquiry-${e.id}` },
      });
  }
  for (const to of emails) await email(to);
}

/** The automatic reply to the customer, listing what they sent. */
export async function replyToCustomer(enquiryId: string) {
  const e = await prisma.enquiry.findUnique({ where: { id: enquiryId }, include: { agency: { include: { settings: true } } } });
  const s = e?.agency.settings;
  if (!e || !s) return;
  const business = s.agencyName || e.agency.name;
  const t = messageFor(s.messageTemplates, "ENQUIRY_REPLY", {
    first_name: firstName(e.name),
    event_type: enquiryTypeLabel(e.eventType),
    date: e.date ? formatDay(e.date) : "",
    business,
  });
  if (!t.on) return;
  // Replies go to the person looking after enquiries, if there's one, else the business.
  const notify = readEnquiryConfig(s.enquiryForm).notify;
  const person = notify.startsWith("USER:")
    ? await prisma.user.findFirst({ where: { id: notify.slice(5), agencyId: e.agencyId }, select: { email: true } })
    : null;
  await sendEmail({
    kind: "ENQUIRY",
    agencyId: e.agencyId,
    bookingId: e.bookingId,
    to: e.email,
    replyTo: person?.email || s.agencyEmail,
    subject: t.subject ?? `Thanks for your enquiry`,
    email: {
      brand: business,
      preheader: `We've got your enquiry`,
      title: "Thanks for your enquiry",
      intro:
        t.intro ??
        `Hi ${firstName(e.name)}, thanks for getting in touch with ${business}. We've got your enquiry and will come back to you soon. Here's what you sent us:`,
      rows: enquiryRows({ ...details(e), name: undefined, email: undefined }),
      outro: "If anything's changed, just reply to this email.",
    },
  });
}
