import "server-only";
import { randomBytes } from "node:crypto";
import type { Contract, Prisma } from "@prisma/client";
import {
  asContractDoc,
  bookingContractDoc,
  contractChanges,
  contractGigs,
  contractHash,
  currentContract,
  eventContractDoc,
  type ContractDoc,
} from "./contract-doc";
import { getSettings, prisma } from "./db";
import { messageFor } from "./message-templates";
import { appUrl, isEmail, sendEmail } from "./messaging";
import { wants } from "./notify-prefs";
import { formatDate, formatDateTime } from "./time";

// Contracts signed online. Staff send a booking's (or a whole wedding's) contract to the client,
// who reads and signs it at a private link (/c/<token>). Once signed the contract is locked: the
// content they saw is kept with its SHA-256 hash, and later edits to the booking are flagged.

export type ContractTarget = { kind: "booking" | "event"; id: string };

export const contractUrl = (token: string) => `${appUrl()}/c/${token}`;

const bookingInclude = { artist: { select: { name: true } }, venue: true, promoter: true } satisfies Prisma.BookingInclude;

/** Everything needed to draw and send a booking's or an event's contract, scoped to the agency. Null if not found. */
export async function contractSubject(agencyId: string, target: ContractTarget) {
  const settings = await getSettings(agencyId);
  if (target.kind === "booking") {
    const b = await prisma.booking.findFirst({ where: { id: target.id, agencyId }, include: bookingInclude });
    if (!b) return null;
    const act = b.artist?.name ?? "";
    return {
      settings,
      doc: bookingContractDoc(b, settings),
      timeZone: b.timezone,
      agentId: b.agentId,
      contact: b.promoter,
      what: b.eventName || [act, b.venue?.name].filter(Boolean).join(" at ") || b.reference,
      act,
      date: formatDate(b.arriveBy, b.timezone),
      demo: b.demo,
      cancelled: b.status === "CANCELLED",
      empty: false,
      href: `/bookings/${b.id}`,
    };
  }
  const e = await prisma.event.findFirst({
    where: { id: target.id, agencyId },
    include: {
      customer: true,
      venue: true,
      bookings: { where: { archivedAt: null }, include: { artist: { select: { name: true } } }, orderBy: { setStart: "asc" } },
    },
  });
  if (!e) return null;
  const gigs = contractGigs(e.bookings);
  return {
    settings,
    doc: eventContractDoc({ ...e, reference: e.bookings[0]?.reference ?? e.id.slice(-6).toUpperCase() }, settings),
    timeZone: e.timezone,
    agentId: e.agentId,
    contact: e.customer,
    what: e.name,
    act: gigs
      .map((g) => g.artist?.name ?? "")
      .filter(Boolean)
      .join(", "),
    date: formatDate(new Date(`${e.date}T12:00:00Z`), "UTC"),
    demo: e.demo,
    cancelled: e.status === "CANCELLED",
    empty: gigs.length === 0,
    href: `/events/${e.id}`,
  };
}

const targetOf = (c: Pick<Contract, "bookingId" | "eventId">): ContractTarget | null =>
  c.bookingId ? { kind: "booking", id: c.bookingId } : c.eventId ? { kind: "event", id: c.eventId } : null;

const whereTarget = (agencyId: string, t: ContractTarget) => ({ agencyId, ...(t.kind === "booking" ? { bookingId: t.id } : { eventId: t.id }) });

/** The contract as it stands now for whatever this contract belongs to. */
export async function liveContractDoc(c: Pick<Contract, "agencyId" | "bookingId" | "eventId">) {
  const t = targetOf(c);
  return t ? contractSubject(c.agencyId, t) : null;
}

/**
 * For the staff panel: the contracts sent for a booking or event, the one that counts, and, if it
 * was signed, what has changed since (empty when nothing has).
 */
export async function contractStatusFor(agencyId: string, target: ContractTarget, liveDoc: ContractDoc) {
  const all = await prisma.contract.findMany({
    where: whereTarget(agencyId, target),
    orderBy: { sentAt: "desc" },
    select: {
      id: true,
      token: true,
      status: true,
      signerName: true,
      signerEmail: true,
      sentAt: true,
      viewedAt: true,
      signedAt: true,
      signedName: true,
      cancelledAt: true,
      content: true,
    },
  });
  const current = currentContract(all);
  const signedDoc = current?.status === "SIGNED" ? asContractDoc(current.content) : null;
  const changes = signedDoc ? contractChanges(signedDoc, liveDoc) : [];
  const earlier = all.filter((c) => c.status === "SIGNED" && c.id !== current?.id);
  return { current, changes, earlier, all };
}

export class ContractError extends Error {}

/**
 * Send (or send again) the contract to sign. An unsigned contract already out keeps its link and
 * goes again to the name and email given; otherwise (none yet, or the last one is signed) a new
 * one is made. Returns the contract and whether the email went.
 */
export async function sendContract(user: { id: string; agencyId: string }, target: ContractTarget, signer: { name: string; email: string }) {
  const s = await contractSubject(user.agencyId, target);
  if (!s) throw new ContractError("Not found");
  if (s.cancelled) throw new ContractError("This is cancelled, so there's nothing to sign.");
  if (s.empty) throw new ContractError("Add an act first: the contract lists every act the customer has booked.");
  const name = signer.name.replace(/\s+/g, " ").trim().slice(0, 120);
  const email = signer.email.trim().toLowerCase();
  if (!name) throw new ContractError("Enter the name of the person signing");
  if (!isEmail(email)) throw new ContractError("Enter a valid email address for the person signing");

  const open = await prisma.contract.findFirst({ where: { ...whereTarget(user.agencyId, target), status: "SENT" }, orderBy: { sentAt: "desc" } });
  const contactId = s.contact && s.contact.email.trim().toLowerCase() === email ? s.contact.id : null;
  const data = { signerName: name, signerEmail: email, contactId, sentAt: new Date(), sentById: user.id };
  const contract = open
    ? await prisma.contract.update({ where: { id: open.id }, data })
    : await prisma.contract.create({
        data: {
          ...data,
          agencyId: user.agencyId,
          bookingId: target.kind === "booking" ? target.id : null,
          eventId: target.kind === "event" ? target.id : null,
          token: randomBytes(18).toString("base64url"),
        },
      });

  const agent = s.agentId ? await prisma.user.findUnique({ where: { id: s.agentId }, select: { email: true, name: true } }) : null;
  const brand = s.settings.agencyName;
  const first = name.split(" ")[0];
  const t = messageFor(s.settings.messageTemplates, "CONTRACT", { first_name: first, event: s.what, act: s.act, date: s.date, business: brand });
  // Demo data never sends anything; the link still works for trying it out.
  const status = s.demo
    ? "SKIPPED"
    : await sendEmail({
        kind: "CONTRACT",
        agencyId: user.agencyId,
        bookingId: target.kind === "booking" ? target.id : null,
        to: email,
        replyTo: agent?.email || s.settings.agencyEmail,
        subject: t.subject ?? `Your contract to sign: ${s.what}`,
        email: {
          brand,
          preheader: "Please read and sign your contract",
          title: "Your contract is ready to sign",
          intro:
            t.intro ??
            `Hi ${first}, here is your contract from ${brand} for ${s.what} on ${s.date}. Please read it and sign it online. It takes a minute and works on your phone.`,
          rows: [
            ["Booking", s.what],
            ["Date", s.date],
            ["Reference", s.doc.reference],
          ],
          cta: { label: "Read and sign", url: contractUrl(contract.token) },
          outro: `Questions? Reply to this email to reach ${agent?.name ?? brand}.`,
        },
      });
  return { contract, sent: status === "SENT" || status === "NOT_SENT", resent: !!open };
}

/** After signing: tell the lead agent (or the business email with no agent) and send the signer their copy. */
export async function afterSigned(contractId: string) {
  const c = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!c || c.status !== "SIGNED") return;
  const s = await liveContractDoc(c);
  if (!s || s.demo) return;
  const brand = s.settings.agencyName;
  const agent = s.agentId ? await prisma.user.findUnique({ where: { id: s.agentId }, select: { email: true, notifyPrefs: true } }) : null;
  const to = agent ? (wants(agent.notifyPrefs, "SIGNED", "email") ? agent.email : null) : s.settings.agencyEmail;
  const when = formatDateTime(c.signedAt!, s.timeZone);
  const base = { kind: "CONTRACT" as const, agencyId: c.agencyId, bookingId: c.bookingId };
  if (to) {
    await sendEmail({
      ...base,
      to,
      subject: `Contract signed: ${s.what}`,
      email: {
        brand,
        title: `${c.signedName} has signed the contract`,
        highlight: { label: "Signed", value: when, tone: "good" },
        rows: [
          ["Booking", s.what],
          ["Date", s.date],
          ["Signed by", `${c.signedName} (${c.signerEmail})`],
        ],
        cta: { label: "Open the signed copy", url: `${appUrl()}/print/contracts/${c.id}` },
      },
    });
  }
  await sendEmail({
    ...base,
    to: c.signerEmail,
    replyTo: s.settings.agencyEmail,
    subject: `Signed: your contract with ${brand}`,
    email: {
      brand,
      title: "Thank you, your contract is signed",
      intro: `Hi ${c.signedName.split(" ")[0]}, thank you for signing. You can see, print or save your signed copy at any time from the link below.`,
      rows: [
        ["Booking", s.what],
        ["Date", s.date],
        ["Signed", when],
      ],
      cta: { label: "Your signed copy", url: contractUrl(c.token) },
    },
  });
}
