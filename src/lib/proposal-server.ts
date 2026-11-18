import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { highestReference, referenceAfter } from "./bookings";
import { cardPaymentsReady, ensurePayLink, payUrl } from "./card-payments";
import { onConfirmed } from "./confirmations";
import { pickContract } from "./contract-templates";
import { contractTemplatesFor } from "./contract-templates-server";
import { getSettings, prisma } from "./db";
import { enquiryTitle, firstName, formatDay } from "./enquiries";
import { defaultTasks } from "./event-plan";
import { messageFor } from "./message-templates";
import { appUrl, isEmail, sendEmail, sendPush } from "./messaging";
import { defaultBookingFee, defaultVat, formatMoney } from "./money";
import { wants } from "./notify-prefs";
import {
  answerProblem,
  canNewVersion,
  canResend,
  canSend,
  eventKindFor,
  holdsUntilDeposit,
  lineFee,
  lineTimes,
  lineTitle,
  nextProposalNumber,
  OPEN_STATUSES,
  proposalRef,
  proposalTotals,
  spreadDeposit,
  tokenExpiry,
  tokenOpens,
} from "./proposals";
import { buildSchedule } from "./schedule";
import { recordHeld, secureEvent } from "./secure-event";
import { addDaysToKey, localDateKey, zonedToUtc } from "./time";
import { log } from "@/server/log";

// Proposals, server side: starting one, new versions, sending it, and the customer's answer. The
// customer's Accept is one transaction that claims the proposal (only a proposal still out with them can
// be claimed, so a double tap books once) and makes the wedding or event and its bookings. The
// messages to the acts, the customer and the team go after it has committed, from the one request
// that made the claim.

export class ProposalError extends Error {}

export const proposalInclude = {
  lines: {
    orderBy: { sort: "asc" },
    include: {
      artist: { select: { id: true, name: true, agentId: true, defaultCommission: true } },
      venue: { select: { id: true, name: true, city: true, timezone: true } },
    },
  },
  contact: true,
  // The business's contract types: a proposal with no wording of its own takes its contract's (termsFor).
  agency: { include: { settings: true, contractTemplates: { orderBy: [{ sort: "asc" }, { createdAt: "asc" }] } } },
} satisfies Prisma.QuoteInclude;
export type FullProposal = Prisma.QuoteGetPayload<{ include: typeof proposalInclude }>;

/** 24 random bytes: a link nobody can guess. */
const newProposalToken = () => randomBytes(24).toString("base64url");
export const proposalUrl = (token: string) => `${appUrl()}/q/${token}`;

const todayIn = (tz: string) => localDateKey(new Date(), tz);
const brandOf = (q: FullProposal) => q.agency.settings?.agencyName || q.agency.name;
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

async function highestProposalNumber(agencyId: string) {
  const [row] = await prisma.$queryRaw<{ n: number | null }[]>`
    SELECT MAX(NULLIF(regexp_replace(number, '[^0-9]', '', 'g'), '')::bigint)::int AS n FROM "Quote" WHERE "agencyId" = ${agencyId}`;
  return row?.n ?? null;
}

/** The place a line is at, as the customer and staff read it. */
export const linePlace = (l: { venue: { name: string; city: string } | null; place: string }) =>
  l.venue ? `${l.venue.name}${l.venue.city ? `, ${l.venue.city}` : ""}` : l.place;

/**
 * Start a draft proposal for a customer, from an enquiry (filled in from what they asked for: the
 * date, times, place and any acts they liked) or from the customer's page.
 */
export async function createDraftProposal(user: { id: string; agencyId: string }, from: { enquiryId?: string | null; contactId?: string | null }) {
  const settings = await getSettings(user.agencyId);
  const enquiry = from.enquiryId ? await prisma.enquiry.findFirst({ where: { id: from.enquiryId, agencyId: user.agencyId } }) : null;
  if (from.enquiryId && !enquiry) throw new ProposalError("Enquiry not found");
  const contactId = enquiry?.contactId ?? from.contactId ?? null;
  const contact = contactId ? await prisma.contact.findFirst({ where: { id: contactId, agencyId: user.agencyId } }) : null;
  if (!contact) throw new ProposalError("This enquiry has no customer. Add them first.");

  const eventType = enquiry?.eventType || "WEDDING";
  // The contract: the customer's own (e.g. Sony's Corporate contract), else the one for this type of event, else the default.
  const contract = pickContract(await contractTemplatesFor(user.agencyId), { clientTemplateId: contact.contractTemplateId, eventType });
  const title = enquiryTitle({ name: enquiry?.name ?? contact.name, eventType: eventType as Parameters<typeof enquiryTitle>[0]["eventType"] });
  const liked = (Array.isArray(enquiry?.acts) ? (enquiry.acts as { id?: string }[]) : []).map((a) => a.id).filter((id): id is string => !!id);
  const acts = liked.length ? await prisma.artist.findMany({ where: { id: { in: liked.slice(0, 3) }, agencyId: user.agencyId }, select: { id: true } }) : [];
  const today = todayIn(settings.defaultTimezone);
  const line = (artistId: string | null, sort: number) => ({
    sort,
    artistId,
    date: enquiry?.date || "",
    startTime: enquiry?.startTime || "",
    endTime: enquiry?.endTime || "",
    place: enquiry?.venue || "",
    vatPct: defaultVat(settings),
  });
  const lines = enquiry?.date ? (acts.length ? acts.map((a, i) => line(a.id, i)) : [line(null, 0)]) : [];

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.quote.create({
        data: {
          agencyId: user.agencyId,
          number: nextProposalNumber(await highestProposalNumber(user.agencyId)),
          enquiryId: enquiry?.id ?? null,
          contactId: contact.id,
          agentId: user.id,
          createdById: user.id,
          title,
          eventType,
          timezone: settings.defaultTimezone,
          currency: settings.defaultCurrency,
          bookingFeeMinor: defaultBookingFee(settings, { eventType }),
          validUntil: addDaysToKey(today, 14),
          contractTemplateId: contract?.id ?? null,
          terms: contract?.terms ?? "",
          lines: { create: lines },
        },
      });
    } catch (e) {
      if (!isUnique(e)) throw e;
    }
  }
  throw new Error("Could not allocate a proposal number");
}

/**
 * Copy a proposal as the next version, a draft. If the old one is still out with the customer it's
 * replaced: its link can't be accepted any more and says the proposal has been updated. Both happen in
 * one transaction, and only if nobody has accepted the old one in the meantime.
 */
export async function newProposalVersion(user: { id: string; agencyId: string }, proposalId: string) {
  return prisma.$transaction(async (tx) => {
    const q = await tx.quote.findFirst({ where: { id: proposalId, agencyId: user.agencyId }, include: { lines: { orderBy: { sort: "asc" } } } });
    if (!q) throw new ProposalError("Proposal not found");
    if (!canNewVersion(q))
      throw new ProposalError(q.status === "ACCEPTED" ? "This proposal has been accepted: change the bookings instead." : "This proposal can't be copied.");
    const top = await tx.quote.aggregate({ where: { agencyId: user.agencyId, number: q.number }, _max: { version: true } });
    const next = await tx.quote.create({
      data: {
        agencyId: q.agencyId,
        number: q.number,
        version: (top._max.version ?? q.version) + 1,
        enquiryId: q.enquiryId,
        contactId: q.contactId,
        agentId: q.agentId ?? user.id,
        createdById: user.id,
        title: q.title,
        eventType: q.eventType,
        timezone: q.timezone,
        currency: q.currency,
        bookingFeeMinor: q.bookingFeeMinor,
        depositMinor: q.depositMinor,
        depositDue: q.depositDue,
        validUntil: q.validUntil && q.validUntil >= todayIn(q.timezone) ? q.validUntil : addDaysToKey(todayIn(q.timezone), 14),
        tellActs: q.tellActs,
        message: q.message,
        contractTemplateId: q.contractTemplateId,
        terms: q.terms,
        lines: {
          create: q.lines.map((l) => ({
            sort: l.sort,
            artistId: l.artistId,
            description: l.description,
            date: l.date,
            arriveTime: l.arriveTime,
            startTime: l.startTime,
            endTime: l.endTime,
            venueId: l.venueId,
            place: l.place,
            saleMinor: l.saleMinor,
            costMinor: l.costMinor,
            vatPct: l.vatPct,
          })),
        },
      },
    });
    // The claim: not if it's been accepted or replaced since we read it.
    const claimed = await tx.quote.updateMany({
      where: { id: q.id, supersededById: null, status: { in: ["SENT", "VIEWED", "DECLINED", "EXPIRED", "WITHDRAWN"] } },
      data: { supersededById: next.id },
    });
    if (claimed.count !== 1) throw new ProposalError("The customer has just answered this proposal. Reload the page.");
    return next;
  });
}

/**
 * The terms the customer agrees to: the proposal's own wording, or if it has none, its contract type's (the one
 * picked, then the customer's own, then the one for its type of event, then the default).
 */
export function termsFor(
  q: Pick<FullProposal, "terms" | "agency" | "contractTemplateId" | "eventType"> & { contact: { contractTemplateId: string | null } | null },
) {
  if (q.terms.trim()) return q.terms.trim().slice(0, 20000);
  const contract = pickContract(q.agency.contractTemplates, {
    chosenId: q.contractTemplateId,
    clientTemplateId: q.contact?.contractTemplateId,
    eventType: q.eventType,
  });
  return (contract?.terms ?? "").trim().slice(0, 20000);
}

/** On sending: a proposal with no wording of its own takes its contract type's now, so what's signed includes it. */
async function fillTerms(q: FullProposal) {
  if (q.terms.trim()) return;
  const terms = termsFor(q);
  if (!terms) return;
  await prisma.quote.updateMany({ where: { id: q.id, status: "DRAFT" }, data: { terms } });
  q.terms = terms;
}

/** Everything a proposal needs before it can go to the customer, or a reason it can't. */
export function readyToSend(q: FullProposal, today: string): string | null {
  if (!q.lines.length) return "Add at least one line first";
  for (const [i, l] of q.lines.entries()) {
    const n = q.lines.length > 1 ? ` on line ${i + 1}` : "";
    if (!l.date) return `Choose the date${n}`;
    if (l.date < today) return `The date${n} has already passed`;
    if (!l.startTime) return `Enter the start time${n}`;
  }
  if (q.validUntil && q.validUntil < today) return "The valid-until date has passed. Change it first.";
  // A wedding proposal is the couple's contract: they agree to the terms when they sign it.
  if (q.eventType === "WEDDING" && !termsFor(q))
    return "Add the terms the couple agree to first: choose a contract with terms, or add your contracts in Settings, Contracts and invoices. The couple agree to them when they sign.";
  const t = proposalTotals(q.lines, q.bookingFeeMinor);
  if (q.depositMinor > t.totalMinor) return "The deposit is more than the total";
  return null;
}

/**
 * Email the proposal to the customer: the first time (which makes this version's private link) or
 * again. The first send is a claim on the draft, so two presses send it once.
 */
/**
 * Make a draft proposal live without emailing it: it gets its customer link, which staff copy and
 * send themselves (WhatsApp, a text, their own email). Same checks and claim as the first send.
 */
export async function publishProposal(user: { agencyId: string }, proposalId: string) {
  const q = await prisma.quote.findFirst({ where: { id: proposalId, agencyId: user.agencyId }, include: proposalInclude });
  if (!q) throw new ProposalError("Proposal not found");
  if (!canSend(q)) throw new ProposalError("This proposal already has its link.");
  const problem = readyToSend(q, todayIn(q.timezone));
  if (problem) throw new ProposalError(problem);
  await fillTerms(q);
  const token = newProposalToken();
  const claimed = await prisma.quote.updateMany({
    where: { id: q.id, status: "DRAFT", supersededById: null },
    data: {
      status: "SENT",
      sentAt: new Date(),
      sentTo: "",
      token,
      tokenExpiresAt: tokenExpiry(
        q.lines.map((l) => l.date),
        q.validUntil,
      ),
    },
  });
  if (claimed.count !== 1) throw new ProposalError("This proposal has just been sent.");
  return q;
}

export async function sendProposal(user: { id: string; agencyId: string; email: string }, proposalId: string, to: string) {
  const q = await prisma.quote.findFirst({ where: { id: proposalId, agencyId: user.agencyId }, include: proposalInclude });
  if (!q) throw new ProposalError("Proposal not found");
  const today = todayIn(q.timezone);
  const first = canSend(q);
  if (!first && !canResend(q, today)) throw new ProposalError("This proposal can't be sent. Make a new version to change it.");
  const email = to.trim().toLowerCase();
  if (!isEmail(email)) throw new ProposalError("Enter the customer's email address");
  const problem = readyToSend(q, today);
  if (problem) throw new ProposalError(problem);
  if (first) await fillTerms(q);

  let token = q.token;
  if (first) {
    token = newProposalToken();
    const claimed = await prisma.quote.updateMany({
      where: { id: q.id, status: "DRAFT", supersededById: null },
      data: {
        status: "SENT",
        sentAt: new Date(),
        sentTo: email,
        token,
        tokenExpiresAt: tokenExpiry(
          q.lines.map((l) => l.date),
          q.validUntil,
        ),
      },
    });
    if (claimed.count !== 1) throw new ProposalError("This proposal has just been sent.");
  } else {
    const claimed = await prisma.quote.updateMany({
      where: { id: q.id, status: { in: OPEN_STATUSES }, supersededById: null },
      data: { sentAt: new Date(), sentTo: email },
    });
    if (claimed.count !== 1) throw new ProposalError("The customer has just answered this proposal.");
  }

  const brand = brandOf(q);
  const t = proposalTotals(q.lines, q.bookingFeeMinor);
  const m = (x: number) => formatMoney(x, q.currency);
  const firstDate = q.lines.map((l) => l.date).sort()[0];
  const name = q.contact && q.contact.email.toLowerCase() === email ? firstName(q.contact.name) : "";
  const agent = q.agentId ? await prisma.user.findUnique({ where: { id: q.agentId }, select: { email: true, name: true } }) : null;
  const w = messageFor(q.agency.settings?.messageTemplates, "QUOTE", {
    first_name: name,
    event: q.title,
    date: formatDay(firstDate),
    total: m(t.totalMinor),
    valid_until: q.validUntil ? formatDay(q.validUntil) : "",
    business: brand,
  });
  const status = await sendEmail({
    kind: "QUOTE",
    agencyId: q.agencyId,
    to: email,
    replyTo: agent?.email || user.email || q.agency.settings?.agencyEmail,
    subject: w.subject ?? `Your proposal from ${brand}: ${q.title}`,
    email: {
      brand,
      preheader: `${m(t.totalMinor)} for ${q.title}`,
      title: q.version > 1 ? "Your updated proposal" : "Your proposal",
      intro:
        w.intro ??
        `Hi${name ? ` ${name}` : ""}, thank you for getting in touch. Here's your ${q.version > 1 ? "updated " : ""}proposal for ${q.title} on ${formatDay(firstDate)}. You can read it and accept it online: it takes a minute and works on your phone.`,
      highlight: q.version > 1 ? { label: "Updated", value: "This replaces the proposal we sent before" } : undefined,
      rows: [
        ...q.lines.map(
          (l, i) =>
            [lineTitle(l), `${formatDay(l.date)}, ${lineTimes(l).toLowerCase()}${linePlace(l) ? `\n${linePlace(l)}` : ""}\n${m(t.lines[i].grossMinor)}`] as [
              string,
              string,
            ],
        ),
        ...(t.bookingFeeMinor ? ([["Booking fee", m(t.bookingFeeMinor)]] as [string, string][]) : []),
        ...(t.vatMinor ? ([["VAT", m(t.vatMinor)]] as [string, string][]) : []),
        ["Total", m(t.totalMinor)],
        ...(q.depositMinor ? ([["Deposit", `${m(q.depositMinor)}${q.depositDue ? `, due by ${formatDay(q.depositDue)}` : ""}`]] as [string, string][]) : []),
        ...(q.validUntil ? ([["Valid until", formatDay(q.validUntil)]] as [string, string][]) : []),
      ],
      cta: { label: "See your proposal", url: proposalUrl(token!) },
      outro: `Questions? Just reply to this email to reach ${agent?.name ?? brand}.`,
    },
  });
  return { proposal: q, resent: !first, sent: status === "SENT" || status === "NOT_SENT" };
}

export type ProposalAnswer = { name: string; note: string; ip: string; agent: string; signature?: string };

/**
 * The customer accepts. In one transaction: claim the proposal (only one still out with them, not
 * past its date, not replaced), then make or reuse the enquiry's wedding or event, one booking per
 * line (Confirmed with an act, Pending for "act to be confirmed"; a wedding with a deposit is on Hold
 * until the deposit is in, see holdsUntilDeposit), and mark the enquiry dealt with.
 * Returns null when there was nothing to claim (e.g. the second of two taps).
 */
export async function acceptProposal(token: string, answer: ProposalAnswer) {
  const q = await prisma.quote.findUnique({ where: { token }, include: { ...proposalInclude, enquiry: true } });
  if (!q || q.agency.status !== "ACTIVE" || !tokenOpens(q, token)) throw new ProposalError("This link isn't valid any more. Please contact us.");
  const today = todayIn(q.timezone);
  if (q.status === "ACCEPTED") return null;
  const problem = answerProblem(q, today);
  if (problem) throw new ProposalError(problem);
  if (!q.lines.length) throw new ProposalError("This proposal has nothing on it. Please contact us.");
  const settings = q.agency.settings ?? (await getSettings(q.agencyId));

  // Booking numbers are taken inside the transaction; if someone else takes the same one at that
  // moment, the whole thing (claim included) rolls back and runs again.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const claimed = await tx.quote.updateMany({
          where: { id: q.id, token, status: { in: OPEN_STATUSES }, supersededById: null, OR: [{ validUntil: null }, { validUntil: { gte: today } }] },
          data: {
            status: "ACCEPTED",
            answeredAt: now,
            answerName: answer.name,
            answerNote: answer.note,
            answerIp: answer.ip,
            answerAgent: answer.agent,
            answerSignature: answer.signature ?? "",
          },
        });
        if (claimed.count !== 1) return null;

        const ref = proposalRef(q);
        const kind = eventKindFor(q.eventType);
        const first = q.lines[0];
        const date = q.lines.map((l) => l.date).sort()[0];
        const where = { venueId: first.venueId, venueText: first.venueId ? "" : first.place };
        // The enquiry's own wedding, if it made one and it's still there; otherwise a new one.
        const existing = q.enquiry?.eventId
          ? await tx.event.findFirst({ where: { id: q.enquiry.eventId, agencyId: q.agencyId, status: "ACTIVE" }, select: { id: true, agentId: true } })
          : null;
        const event = existing
          ? await tx.event.update({
              where: { id: existing.id },
              // Now booked: the customer gets the usual automatic emails (planner, balance, thank you).
              data: {
                name: q.title,
                type: kind,
                date,
                customerId: q.contactId,
                ...where,
                agentId: existing.agentId ?? q.agentId,
                autoEmails: true,
                contractTemplateId: q.contractTemplateId,
              },
            })
          : await tx.event.create({
              data: {
                agencyId: q.agencyId,
                name: q.title,
                type: kind,
                date,
                timezone: q.timezone,
                customerId: q.contactId,
                ...where,
                // The contract type the customer accepted, for any contract sent from the event later.
                contractTemplateId: q.contractTemplateId,
                guestCount: q.enquiry?.guests ?? null,
                agentId: q.agentId,
                notes: `Booked from proposal ${ref}, accepted by ${answer.name}.`,
                plannerToken: randomBytes(18).toString("base64url"),
                tasks: { create: defaultTasks(kind, date) },
              },
            });

        const totals = proposalTotals(q.lines, q.bookingFeeMinor);
        const deposits = spreadDeposit(
          q.depositMinor,
          totals.lines.map((d) => d.totalDueMinor),
        );
        const highest = await highestReference(q.agencyId, tx);
        // A wedding with a deposit is only booked once the deposit is in (the couple's terms): until then its
        // gigs are on Hold, the date kept for them, and the acts aren't told (src/lib/secure-event.ts).
        const held = holdsUntilDeposit(q);
        const made: { id: string; reference: string; status: string }[] = [];
        for (const [i, l] of q.lines.entries()) {
          const tz = l.venue?.timezone ?? q.timezone;
          const schedule = buildSchedule(l.date, { arrive: l.arriveTime || l.startTime, setStart: l.startTime, setEnd: l.endTime || null }, tz);
          const status = held ? "HOLD" : l.artistId ? "CONFIRMED" : "PENDING";
          const elsewhere = !l.venueId && l.place && l.place !== where.venueText ? `Where: ${l.place}` : "";
          const b = await tx.booking.create({
            data: {
              agencyId: q.agencyId,
              reference: referenceAfter(highest, i + 1),
              ...schedule,
              eventId: event.id,
              artistId: l.artistId,
              venueId: l.venueId,
              promoterId: q.contactId,
              agentId: l.artist?.agentId ?? q.agentId,
              createdById: q.createdById,
              status,
              eventType: kind,
              eventName: q.title,
              timezone: tz,
              currency: q.currency,
              dealType: "BUY_SELL",
              feeMinor: l.saleMinor,
              artistFeeMinor: l.costMinor,
              commissionPct: l.artist?.defaultCommission ?? settings.defaultCommission,
              vatPct: l.vatPct,
              bookingFeeMinor: lineFee(i, q.bookingFeeMinor),
              depositMinor: deposits[i],
              depositDueDate: deposits[i] && q.depositDue ? zonedToUtc(q.depositDue, "23:59", tz) : null,
              notes: [l.description, elsewhere].filter(Boolean).join("\n"),
              tags: "quote",
              notifyClientOnArrival: false,
              // The customer's "you're booked" email lists every act, so they aren't sent one per act as well.
              customerToldAt: status === "CONFIRMED" ? now : null,
            },
            select: { id: true, reference: true, status: true },
          });
          await tx.quoteLine.update({ where: { id: l.id }, data: { bookingId: b.id } });
          made.push(b);
        }
        await tx.quote.update({ where: { id: q.id }, data: { eventId: event.id } });
        // Remembered as held by the journey, so the gate moves these on and not a gig staff put On hold.
        await recordHeld(
          tx,
          made.filter((b) => b.status === "HOLD").map((b) => b.id),
          "proposal",
        );

        if (q.enquiry) {
          await tx.enquiry.update({ where: { id: q.enquiry.id }, data: { status: "DONE", doneAt: q.enquiry.doneAt ?? now, eventId: event.id } });
          // The Enquiry booking the website form made (no act, nothing paid) is replaced by the real ones.
          if (q.enquiry.bookingId) {
            await tx.booking.updateMany({
              where: { id: q.enquiry.bookingId, agencyId: q.agencyId, status: "ENQUIRY", artistId: null, payments: { none: {} } },
              data: { status: "CANCELLED" },
            });
          }
        }
        await tx.activity.createMany({
          data: [
            { agencyId: q.agencyId, entity: "QUOTE", entityId: q.id, action: `customer accepted proposal ${ref}`, detail: answer.name, createdAt: now },
            {
              agencyId: q.agencyId,
              entity: "EVENT",
              entityId: event.id,
              action: `booked from proposal ${ref}`,
              detail: q.title,
              createdAt: new Date(now.getTime() + 1),
            },
            ...made.map((b, i) => ({
              agencyId: q.agencyId,
              entity: "BOOKING",
              entityId: b.id,
              action: `booked from proposal ${ref}`,
              detail: b.status === "CONFIRMED" ? "confirmed" : b.status === "HOLD" ? "on hold until the deposit is paid" : "pending: act to be confirmed",
              createdAt: new Date(now.getTime() + 2 + i),
            })),
            ...(q.enquiry?.bookingId
              ? [
                  {
                    agencyId: q.agencyId,
                    entity: "BOOKING",
                    entityId: q.enquiry.bookingId,
                    action: `replaced by the bookings from proposal ${ref}`,
                    createdAt: new Date(now.getTime() + 2 + made.length),
                  },
                ]
              : []),
          ],
        });
        return { proposalId: q.id, eventId: event.id, bookings: made };
      });
    } catch (e) {
      if (isUnique(e) && attempt < 4) continue;
      throw e;
    }
  }
}

/** The customer declines. A claim like accepting, so it's recorded once. Returns false if there was nothing to claim. */
export async function declineProposal(token: string, answer: ProposalAnswer) {
  const q = await prisma.quote.findUnique({ where: { token }, include: { agency: { select: { status: true } } } });
  if (!q || q.agency.status !== "ACTIVE" || !tokenOpens(q, token)) throw new ProposalError("This link isn't valid any more. Please contact us.");
  const today = todayIn(q.timezone);
  if (q.status === "DECLINED") return false;
  const problem = answerProblem(q, today);
  if (problem) throw new ProposalError(problem);
  const claimed = await prisma.quote.updateMany({
    where: { id: q.id, token, status: { in: OPEN_STATUSES }, supersededById: null },
    data: { status: "DECLINED", answeredAt: new Date(), answerName: answer.name, answerNote: answer.note, answerIp: answer.ip, answerAgent: answer.agent },
  });
  if (claimed.count !== 1) return false;
  await prisma.activity.create({
    data: { agencyId: q.agencyId, entity: "QUOTE", entityId: q.id, action: `customer declined proposal ${proposalRef(q)}`, detail: answer.note.slice(0, 200) },
  });
  return true;
}

/** The deposit's "Pay now" link for the event, when card payments are set up and there's a deposit. */
export async function depositLinkFor(proposalId: string) {
  const q = await prisma.quote.findUnique({ where: { id: proposalId }, include: { agency: true } });
  if (!q?.eventId || q.depositMinor <= 0 || !(await cardPaymentsReady(q.agency))) return null;
  return ensurePayLink(q.agencyId, { eventId: q.eventId }, "DEPOSIT");
}

/**
 * After an accept has committed: each act hears they're booked (their own times and fee only,
 * through the usual confirmation), the customer gets their confirmation (with the deposit link if
 * there is one) and the lead agent hears. Each part is tried on its own, so one failure doesn't stop the rest.
 *
 * A wedding goes through the gate (src/lib/secure-event.ts). With a deposit, its gigs are on Hold: the
 * acts aren't told yet, and the couple are thanked and asked for the deposit; the gate books it when the
 * deposit arrives. With no deposit it's booked now, and the gate sends the couple's "you're booked" email.
 */
export async function afterAccepted(proposalId: string) {
  const q = await prisma.quote.findUnique({ where: { id: proposalId }, include: proposalInclude });
  if (!q || q.status !== "ACCEPTED") return;
  const wedding = eventKindFor(q.eventType) === "WEDDING";
  const held = holdsUntilDeposit(q);
  // Unticked on the proposal: the bookings are made, but staff tell the acts themselves. Held gigs: the gate tells them.
  for (const l of q.tellActs && !held ? q.lines : []) {
    if (!l.bookingId || !l.artistId) continue;
    try {
      await onConfirmed(l.bookingId);
    } catch (e) {
      log.error("Proposal accepted, but telling an act failed", { err: e });
    }
  }
  // Whether the wedding is booked: if it is (the deposit was already in), the couple are never asked for one.
  let secured = false;
  if (wedding && q.eventId) {
    try {
      secured = (await secureEvent(q.eventId, { announce: !held })).secured;
    } catch (e) {
      log.error("Proposal accepted, but checking whether the wedding is booked failed", { err: e });
    }
  }
  try {
    if (held && !secured) await tellCustomerHeld(q);
    else if (!wedding) await tellCustomerBooked(q);
  } catch (e) {
    log.error("Proposal accepted, but the customer's confirmation failed", { err: e });
  }
  try {
    await tellTeam(q, "ACCEPTED");
  } catch (e) {
    log.error("Proposal accepted, but telling the team failed", { err: e });
  }
}

/** After a decline has committed: the team hears, and the customer is thanked for considering us. */
export async function afterDeclined(proposalId: string) {
  const q = await prisma.quote.findUnique({ where: { id: proposalId }, include: proposalInclude });
  if (!q || q.status !== "DECLINED") return;
  try {
    await tellCustomerDeclined(q);
  } catch (e) {
    log.error("Proposal declined, but thanking the customer failed", { err: e });
  }
  try {
    await tellTeam(q, "DECLINED");
  } catch (e) {
    log.error("Proposal declined, but telling the team failed", { err: e });
  }
}

/** Where the customer's emails about a proposal go: the address it was sent to, or the customer's own. */
const customerEmailOf = (q: FullProposal) => q.sentTo || q.contact?.email || "";
const agentOf = (q: Pick<FullProposal, "agentId">) =>
  q.agentId ? prisma.user.findUnique({ where: { id: q.agentId }, select: { email: true, name: true } }) : Promise.resolve(null);

/**
 * A wedding accepted with a deposit to pay: thank you, your date is held for you, and it's booked once the
 * deposit is in. With the deposit's "Pay now" link when card payments are set up.
 */
async function tellCustomerHeld(q: FullProposal) {
  const to = customerEmailOf(q);
  if (!isEmail(to)) return;
  const brand = brandOf(q);
  const t = proposalTotals(q.lines, q.bookingFeeMinor);
  const m = (x: number) => formatMoney(x, q.currency);
  const firstDate = q.lines.map((l) => l.date).sort()[0];
  const name = firstName(q.answerName || q.contact?.name || "");
  const deposit = m(q.depositMinor);
  const w = messageFor(q.agency.settings?.messageTemplates, "QUOTE_ACCEPTED_HELD", {
    first_name: name,
    event: q.title,
    date: formatDay(firstDate),
    total: m(t.totalMinor),
    deposit,
    business: brand,
  });
  if (!w.on) return;
  const link = await depositLinkFor(q.id);
  const agent = await agentOf(q);
  const by = q.depositDue ? ` by ${formatDay(q.depositDue)}` : "";
  await sendEmail({
    kind: "QUOTE",
    agencyId: q.agencyId,
    to,
    replyTo: agent?.email || q.agency.settings?.agencyEmail,
    subject: w.subject ?? `Thanks for accepting: ${q.title}`,
    email: {
      brand,
      preheader: `Your date is held for you. Pay your deposit of ${deposit} to book it.`,
      title: "Thanks for accepting",
      highlight: { label: "Held for you", value: `${q.title}, ${formatDay(firstDate)}` },
      intro:
        w.intro ??
        `Hi ${name}, thank you for accepting your proposal for ${q.title} on ${formatDay(firstDate)}. Your date is held for you. The next step is your deposit of ${deposit}${by}: once it's in, you're booked and we'll confirm everything with you.`,
      rows: [
        ...q.lines.map(
          (l) => [lineTitle(l), `${formatDay(l.date)}, ${lineTimes(l).toLowerCase()}${linePlace(l) ? `\n${linePlace(l)}` : ""}`] as [string, string],
        ),
        ["Total", m(t.totalMinor)],
        ["Deposit to pay", `${deposit}${q.depositDue ? `, due by ${formatDay(q.depositDue)}` : ""}`],
      ],
      cta: link ? { label: `Pay your deposit of ${deposit}`, url: payUrl(link.token) } : undefined,
      outro: link
        ? `Any questions, just reply to this email to reach ${agent?.name ?? brand}.`
        : `We'll send you the details to pay your deposit. Any questions, just reply to this email to reach ${agent?.name ?? brand}.`,
    },
  });
}

/** The customer declined: a warm thank you for considering us, and the door left open. */
async function tellCustomerDeclined(q: FullProposal) {
  const to = customerEmailOf(q);
  if (!isEmail(to)) return;
  const brand = brandOf(q);
  const firstDate = q.lines.map((l) => l.date).sort()[0];
  const name = firstName(q.contact?.name || "");
  const w = messageFor(q.agency.settings?.messageTemplates, "QUOTE_DECLINED", {
    first_name: name,
    event: q.title,
    date: firstDate ? formatDay(firstDate) : "",
    business: brand,
  });
  if (!w.on) return;
  const agent = await agentOf(q);
  await sendEmail({
    kind: "QUOTE",
    agencyId: q.agencyId,
    to,
    replyTo: agent?.email || q.agency.settings?.agencyEmail,
    subject: w.subject ?? `Thank you for considering ${brand}`,
    email: {
      brand,
      title: "Thank you for your interest",
      intro:
        w.intro ??
        `Hi${name ? ` ${name}` : ""}, thank you for letting us know about your proposal for ${q.title}, and for considering ${brand}. It was lovely to hear about your plans.`,
      outro: `If anything changes, or you'd like us to put together something different, just reply to this email to reach ${agent?.name ?? brand}. We wish you a wonderful day.`,
    },
  });
}

/** Days after sending that a customer who hasn't answered gets a reminder. */
export const CHASE_DAYS = [3, 7] as const;
export type ChaseDay = (typeof CHASE_DAYS)[number];

/** Remind the customer about a proposal they haven't answered yet (the scheduler's proposal reminders). */
export async function sendProposalChase(q: FullProposal, day: ChaseDay) {
  const to = customerEmailOf(q);
  if (!isEmail(to) || !q.token) return false;
  const brand = brandOf(q);
  const t = proposalTotals(q.lines, q.bookingFeeMinor);
  const m = (x: number) => formatMoney(x, q.currency);
  const firstDate = q.lines.map((l) => l.date).sort()[0];
  const name = q.contact && (!q.sentTo || q.contact.email.toLowerCase() === q.sentTo.toLowerCase()) ? firstName(q.contact.name) : "";
  const valid = q.validUntil ? formatDay(q.validUntil) : "";
  const w = messageFor(q.agency.settings?.messageTemplates, "QUOTE_CHASE", {
    first_name: name,
    event: q.title,
    date: formatDay(firstDate),
    total: m(t.totalMinor),
    valid_until: valid,
    business: brand,
  });
  if (!w.on) return false;
  const agent = await agentOf(q);
  const hi = `Hi${name ? ` ${name}` : ""}`;
  await sendEmail({
    kind: "QUOTE",
    agencyId: q.agencyId,
    to,
    replyTo: agent?.email || q.agency.settings?.agencyEmail,
    subject: w.subject ?? (day === 3 ? `Your proposal for ${q.title}` : `A gentle reminder: your proposal for ${q.title}`),
    email: {
      brand,
      preheader: valid ? `Your proposal is ready whenever you are. It's valid until ${valid}.` : "Your proposal is ready whenever you are.",
      title: day === 3 ? "Your proposal is ready for you" : "A gentle reminder about your proposal",
      intro:
        w.intro ??
        (day === 3
          ? `${hi}, just checking you've seen your proposal for ${q.title} on ${formatDay(firstDate)}. You can read it and sign it online in a minute, and it works on your phone.`
          : `${hi}, a gentle reminder that your proposal for ${q.title} on ${formatDay(firstDate)} is still waiting for you.${valid ? ` It's valid until ${valid}.` : ""} If you'd like to go ahead, you can sign it online in a minute.`),
      rows: [
        ["Total", m(t.totalMinor)],
        ...(q.depositMinor ? ([["Deposit", m(q.depositMinor)]] as [string, string][]) : []),
        ...(valid ? ([["Valid until", valid]] as [string, string][]) : []),
      ],
      cta: { label: "See your proposal", url: proposalUrl(q.token) },
      outro: `Want to change something, or have a question? Just reply to this email to reach ${agent?.name ?? brand}. We're happy to help.`,
    },
  });
  return true;
}

async function tellCustomerBooked(q: FullProposal) {
  const to = q.sentTo || q.contact?.email || "";
  if (!isEmail(to)) return;
  const brand = brandOf(q);
  const t = proposalTotals(q.lines, q.bookingFeeMinor);
  const m = (x: number) => formatMoney(x, q.currency);
  const firstDate = q.lines.map((l) => l.date).sort()[0];
  const name = firstName(q.answerName || q.contact?.name || "");
  const w = messageFor(q.agency.settings?.messageTemplates, "QUOTE_ACCEPTED", {
    first_name: name,
    event: q.title,
    date: formatDay(firstDate),
    total: m(t.totalMinor),
    business: brand,
  });
  if (!w.on) return;
  const link = q.depositMinor > 0 ? await depositLinkFor(q.id) : null;
  const agent = q.agentId ? await prisma.user.findUnique({ where: { id: q.agentId }, select: { email: true, name: true } }) : null;
  await sendEmail({
    kind: "QUOTE",
    agencyId: q.agencyId,
    to,
    replyTo: agent?.email || q.agency.settings?.agencyEmail,
    subject: w.subject ?? `You're booked: ${q.title}`,
    email: {
      brand,
      title: "Thank you, you're booked",
      highlight: { label: "Booked", value: `${q.title}, ${formatDay(firstDate)}`, tone: "good" },
      intro: w.intro ?? `Hi ${name}, thank you for accepting your proposal. Here's what's booked with ${brand}:`,
      rows: [
        ...q.lines.map(
          (l) => [lineTitle(l), `${formatDay(l.date)}, ${lineTimes(l).toLowerCase()}${linePlace(l) ? `\n${linePlace(l)}` : ""}`] as [string, string],
        ),
        ["Total", m(t.totalMinor)],
        ...(q.depositMinor ? ([["Deposit", `${m(q.depositMinor)}${q.depositDue ? `, due by ${formatDay(q.depositDue)}` : ""}`]] as [string, string][]) : []),
      ],
      cta: link ? { label: `Pay your deposit of ${m(q.depositMinor)}`, url: payUrl(link.token) } : undefined,
      outro: `We'll be in touch about the next steps. Any questions, just reply to this email to reach ${agent?.name ?? brand}.`,
    },
  });
}

/** The lead agent (or the business email, with no agent) hears the answer, by email and phone as they've chosen. */
async function tellTeam(q: FullProposal, answer: "ACCEPTED" | "DECLINED") {
  const brand = brandOf(q);
  const accepted = answer === "ACCEPTED";
  const who = q.answerName || q.contact?.name || "The customer";
  const w = messageFor(q.agency.settings?.messageTemplates, "QUOTE_ANSWER", {
    name: who,
    event: q.title,
    answer: accepted ? "accepted" : "declined",
    business: brand,
  });
  if (!w.on) return;
  const t = proposalTotals(q.lines, q.bookingFeeMinor);
  const m = (x: number) => formatMoney(x, q.currency);
  const subject = w.subject ?? `Proposal ${accepted ? "accepted" : "declined"}: ${q.title} (${proposalRef(q)})`;
  const url = accepted && q.eventId ? `${appUrl()}/events/${q.eventId}` : `${appUrl()}/quotes/${q.id}`;
  const agent = q.agentId ? await prisma.user.findUnique({ where: { id: q.agentId }, select: { id: true, email: true, notifyPrefs: true } }) : null;
  const to = agent ? (wants(agent.notifyPrefs, "QUOTE", "email") ? agent.email : null) : q.agency.settings?.agencyEmail;
  const pending = q.lines.filter((l) => !l.artistId).length;
  // A wedding with a deposit: made, but on Hold until the deposit is in. The acts hear then.
  const held = accepted && holdsUntilDeposit(q);
  const base = { kind: "QUOTE" as const, agencyId: q.agencyId, bookingId: q.lines[0]?.bookingId ?? null };
  if (to) {
    await sendEmail({
      ...base,
      to,
      replyTo: q.sentTo || q.contact?.email,
      subject,
      email: {
        brand,
        title: subject,
        highlight: held
          ? { label: "Accepted", value: "On hold until the deposit is paid", tone: "good" }
          : accepted
            ? { label: "Accepted", value: "The bookings are made", tone: "good" }
            : { label: "Declined", value: q.answerNote ? "They left a reason" : "No reason given", tone: "bad" },
        intro:
          w.intro ??
          (held
            ? `${who} has accepted the proposal for ${q.title}. It's signed, and the wedding and its bookings are made and on hold until the deposit of ${m(q.depositMinor)} is in. The couple have been asked to pay it. Once it's in, the bookings are confirmed${q.tellActs ? " and the acts are told" : ". The acts won't be emailed, so tell them yourself then"}.${pending ? ` ${pending} line${pending === 1 ? " still needs" : "s still need"} an act.` : ""}`
            : accepted
              ? `${who} has accepted the proposal for ${q.title}. It's signed and locked in: the wedding or event and its bookings are made${q.tellActs ? ", and the acts have been told" : ". The acts haven't been emailed, so tell them yourself"}.${pending ? ` ${pending} line${pending === 1 ? " still needs" : "s still need"} an act.` : ""}`
              : `${who} has declined the proposal for ${q.title}.`),
        rows: [
          ["Proposal", proposalRef(q)],
          ["Total", m(t.totalMinor)],
          ["We make", m(t.agencyMinor)],
          ...(q.answerNote ? ([[accepted ? "Their message" : "Their reason", q.answerNote]] as [string, string][]) : []),
        ],
        cta: { label: accepted ? "Open the event" : "Open the proposal", url },
      },
    });
  }
  if (agent && wants(agent.notifyPrefs, "QUOTE", "push")) {
    await sendPush({
      ...base,
      userId: agent.id,
      payload: {
        title: subject,
        body: held ? "On hold until the deposit is paid." : accepted ? "The bookings are made." : q.answerNote.slice(0, 120) || "No reason given.",
        url: url.replace(appUrl(), ""),
        tag: `quote-${q.id}`,
      },
    });
  }
}

/** First time the customer opens their link (staff checking it don't count). */
export async function markViewed(q: { id: string; agencyId: string; number: string; version: number }) {
  const done = await prisma.quote.updateMany({ where: { id: q.id, status: "SENT" }, data: { status: "VIEWED", viewedAt: new Date() } });
  if (done.count)
    await prisma.activity.create({ data: { agencyId: q.agencyId, entity: "QUOTE", entityId: q.id, action: `customer opened proposal ${proposalRef(q)}` } });
}

/** A proposal out with the customer past its valid-until date is saved as Expired. */
export async function markExpired(q: { id: string; timezone: string }) {
  await prisma.quote.updateMany({ where: { id: q.id, status: { in: OPEN_STATUSES }, validUntil: { lt: todayIn(q.timezone) } }, data: { status: "EXPIRED" } });
}
