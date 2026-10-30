import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Enquiry } from "@prisma/client";
import { prisma } from "./db";
import { enquiryRows, enquiryTypeLabel, firstName, formatDay, RateLimiter, readEnquiryConfig, type EnquiryDetails } from "./enquiries";
import { messageFor } from "./message-templates";
import { appUrl, sendEmail, sendPush } from "./messaging";
import { wants } from "./notify-prefs";

// The enquiry form's server side: the secret that signs the form's time stamp, rate limiting by
// IP address, and the emails and phone notifications when an enquiry comes in.

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
