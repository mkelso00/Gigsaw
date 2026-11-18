import "server-only";
import { queueCalendarSync } from "./calendar-sync/queue";
import { onConfirmed } from "./confirmations";
import { contractUrl } from "./contracts";
import { prisma } from "./db";
import { eventTotals } from "./events";
import { messageFor } from "./message-templates";
import { sendEmail } from "./messaging";
import { formatMoney, paymentTotals } from "./money";
import { DIRECT_NOTE, isDirectPlan } from "./pay-plan";
import { balanceDueDate, GATE_KIND, isSecured as hasSecuredGig, JOURNEY_LIVE } from "./event-plan";
import { claimReminder } from "./reminders";
import { formatDate, localDateKey, localTime } from "./time";
import { log } from "@/server/log";

// The gate a wedding passes through to be booked. The couple's terms say a booking is confirmed only
// when the contract is agreed (the proposal accepted, or a contract signed) AND the deposit is in. Until
// then the wedding's gigs are on Hold: the date is kept for them, but the acts aren't told. Once both
// are true, secureEvent moves on the gigs the journey held (and only those: a gig staff pencilled in as
// On hold stays as it is), tells the acts as a confirmation always does, and sends the couple one
// "you're booked" email.
//
// It's called after anything that could tip the balance: the proposal being accepted, a contract being
// signed, and every payment in from the customer. It's safe to call as often as you like, from
// anywhere, at the same time: the event row is locked while its gigs are moved.
//
// What it remembers is kept as Reminder rows, alongside the other wedding emails:
//  - GATE_KIND for "event:<id>": the wedding has passed the gate. Its createdAt is when it was secured, which
//    the scheduled emails (src/lib/events.ts) go by;
//  - HELD_KIND for "booking:<id>", keyed by how it was held ("proposal" or "contract"): a gig the journey put
//    on Hold, for the gate to move on;
//  - EV_SECURED for "event:<id>": the couple's "you're booked" email, claimed once.

/** The key the couple's "you're booked" email is claimed under (src/lib/events.ts reads EV_* as sent emails). */
export const SECURED_KIND = "EV_SECURED";
/** A gig the journey put on Hold until the wedding is secured. */
export const HELD_KIND = "EV_HELD";
export const heldRecipient = (bookingId: string) => `booking:${bookingId}`;
/**
 * How a gig came to be held. A proposal names each act and its price, so its gigs with an act are Confirmed
 * at the gate. A contract signed for gigs staff set up hasn't been put to the act yet, so they're Pending at
 * the gate, as signing made them before weddings had a gate: staff then offer the gig to the act as usual.
 */
export type HeldBy = "proposal" | "contract";

/** Remember the gigs the journey has just put on Hold, in the same transaction that held them. */
export async function recordHeld(tx: Pick<Parameters<Parameters<typeof prisma.$transaction>[0]>[0], "reminder">, bookingIds: string[], by: HeldBy) {
  if (!bookingIds.length) return;
  await tx.reminder.createMany({ data: bookingIds.map((id) => ({ kind: HELD_KIND, recipient: heldRecipient(id), key: by })), skipDuplicates: true });
}

export type SecureResult = {
  /** The contract is agreed and the deposit is in (or none was asked for). */
  secured: boolean;
  /** This call is the one that found it secured for the first time (it claimed the GATE_KIND row). */
  first: boolean;
  /** Gigs this call moved off Hold. */
  moved: string[];
  /** This call sent the couple their "you're booked" email (so a plain payment receipt isn't needed as well). */
  told: boolean;
};

const NOTHING: SecureResult = { secured: false, first: false, moved: [], told: false };

/** Booked once the contract is agreed (proposal accepted or contract signed) and payments in cover the deposit. */
export function isSecured(s: { agreed: boolean; depositMinor: number; receivedMinor: number }) {
  return s.agreed && s.receivedMinor >= Math.max(0, s.depositMinor);
}

/** Money in from the customer to the business: a payment the couple made straight to an act isn't the business's deposit. */
export const receivedByUs = (payments: { direction: string; kind: string; amountMinor: number; note?: string | null }[]) =>
  paymentTotals(payments.filter((p) => !(p.direction === "IN" && p.note === DIRECT_NOTE))).receivedMinor;

export { monthsBefore } from "./event-plan";

/** When the balance is due: three months before the wedding, as the terms say. */
export const BALANCE_MONTHS_BEFORE = 3;

type Moved = { id: string; artistId: string | null; status: "CONFIRMED" | "PENDING" };

/**
 * Check a wedding against the gate and, if it's now secured, book it. The couple's "you're booked" email goes
 * only the first time it's found secured; `announce` also sends it when it was already secured but the couple
 * haven't had it (a proposal accepted with no deposit to wait for). A later payment never sends it again.
 * `signed` says a contract has just been signed, for the email's wording.
 */
export async function secureEvent(eventId: string, opts: { announce?: boolean; signed?: boolean } = {}): Promise<SecureResult> {
  const pre = await prisma.event.findUnique({ where: { id: eventId }, select: { type: true, status: true } });
  // Weddings only: other events are booked as they always were.
  if (!pre || pre.type !== "WEDDING" || pre.status !== "ACTIVE") return NOTHING;

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    // One at a time per event: a second caller waits here, then finds nothing left on Hold.
    await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
    const e = await tx.event.findUnique({
      where: { id: eventId },
      include: {
        bookings: {
          include: {
            payments: { select: { direction: true, kind: true, amountMinor: true, note: true } },
            quoteLines: { where: { quote: { status: "ACCEPTED" } }, select: { id: true } },
          },
        },
        quotes: { where: { status: "ACCEPTED" }, select: { id: true, tellActs: true } },
        contracts: { where: { status: "SIGNED" }, select: { id: true } },
      },
    });
    if (!e || e.status !== "ACTIVE" || e.type !== "WEDDING") return null;
    const live = e.bookings.filter((b) => b.status !== "CANCELLED" && !b.archivedAt);
    const depositMinor = live.reduce((n, b) => n + b.depositMinor, 0);
    const receivedMinor = e.bookings.reduce((n, b) => n + receivedByUs(b.payments), 0);
    const agreed = e.quotes.length > 0 || e.contracts.length > 0;
    if (!isSecured({ agreed, depositMinor, receivedMinor })) return { secured: false as const };

    const recipient = `event:${e.id}`;
    const gate = await tx.reminder.findUnique({ where: { kind_recipient_key: { kind: GATE_KIND, recipient, key: "" } }, select: { id: true } });

    // Only the gigs the journey held move on. A gig staff put On hold themselves stays On hold.
    const onHold = live.filter((b) => b.status === "HOLD");
    const how = new Map<string, string>();
    if (onHold.length) {
      const rows = await tx.reminder.findMany({
        where: { kind: HELD_KIND, recipient: { in: onHold.map((b) => heldRecipient(b.id)) } },
        select: { recipient: true, key: true },
      });
      for (const r of rows) {
        const id = r.recipient.replace(/^booking:/, "");
        if (!how.has(id) || r.key === "proposal") how.set(id, r.key);
      }
      // A proposal accepted before held gigs were recorded: its own gigs (the accepted proposal's lines), until the first booking.
      if (!gate) for (const b of onHold) if (!how.has(b.id) && b.quoteLines.length) how.set(b.id, "proposal");
    }
    const release = onHold.filter((b) => how.has(b.id));
    const moved: Moved[] = release.map((b) => ({
      id: b.id,
      artistId: b.artistId,
      status: b.artistId && how.get(b.id) === "proposal" ? "CONFIRMED" : "PENDING",
    }));
    const confirm = moved.filter((b) => b.status === "CONFIRMED").map((b) => b.id);
    const pending = moved.filter((b) => b.status === "PENDING").map((b) => b.id);
    // The couple's email lists every act, so they aren't sent the per-act "confirmed" email as well.
    if (confirm.length) await tx.booking.updateMany({ where: { id: { in: confirm }, status: "HOLD" }, data: { status: "CONFIRMED", customerToldAt: now } });
    if (pending.length) await tx.booking.updateMany({ where: { id: { in: pending }, status: "HOLD" }, data: { status: "PENDING" } });
    if (moved.length) await tx.reminder.deleteMany({ where: { kind: HELD_KIND, recipient: { in: moved.map((b) => heldRecipient(b.id)) } } });

    // The first time it's secured, remembered with when. A wedding from before the journey that was already
    // booked (a gig past On hold) and has nothing held isn't newly secured: it's just taking a payment.
    const booked = !gate && e.createdAt < JOURNEY_LIVE && hasSecuredGig(live) && !moved.length;
    const first = !gate && !booked;
    if (first) await tx.reminder.create({ data: { kind: GATE_KIND, recipient, key: "", createdAt: now } });

    if (moved.length) {
      const why = depositMinor > 0 ? "deposit received" : "contract agreed";
      await tx.activity.createMany({
        data: [
          { agencyId: e.agencyId, entity: "EVENT", entityId: e.id, action: "booked: contract agreed and deposit in", detail: why, createdAt: now },
          ...moved.map((b, i) => ({
            agencyId: e.agencyId,
            entity: "BOOKING",
            entityId: b.id,
            action:
              b.status === "CONFIRMED" ? "confirmed" : b.artistId ? "booked, pending: offer it to the act to confirm" : "booked, pending: act to be confirmed",
            detail: why,
            createdAt: new Date(now.getTime() + 1 + i),
          })),
        ],
      });
    }
    // Staff unticked "tell the acts" on the proposal: they tell them themselves.
    const tellActs = e.quotes.length ? e.quotes.some((q) => q.tellActs) : true;
    return { secured: true as const, first, moved, tellActs };
  });
  if (!result?.secured) return NOTHING;

  const moved = result.moved.map((b) => b.id);
  queueCalendarSync(moved);
  for (const b of result.tellActs ? result.moved : []) {
    if (b.status !== "CONFIRMED") continue;
    try {
      await onConfirmed(b.id);
    } catch (e) {
      log.error("Wedding booked, but telling an act failed", { err: e, bookingId: b.id });
    }
  }

  let told = false;
  if (result.first || opts.announce) {
    try {
      told = await tellCoupleBooked(eventId, { signed: !!opts.signed });
    } catch (e) {
      log.error("Wedding booked, but the couple's email failed", { err: e, eventId });
    }
  }
  return { secured: true, first: result.first, moved, told };
}

/** The same, never throwing: for the places a payment or signature is saved, which mustn't fail because of it. */
export async function secureEventQuietly(eventId: string | null | undefined, opts: { announce?: boolean; signed?: boolean } = {}): Promise<SecureResult> {
  if (!eventId) return NOTHING;
  try {
    return await secureEvent(eventId, opts);
  } catch (e) {
    log.error("Couldn't check whether a wedding is booked", { err: e, eventId });
    return NOTHING;
  }
}

/** Run the gate for each wedding these bookings belong to. */
export async function secureEventsOf(bookingIds: string[]) {
  if (!bookingIds.length) return [];
  const rows = await prisma.booking.findMany({ where: { id: { in: bookingIds }, eventId: { not: null } }, select: { eventId: true } });
  const out: SecureResult[] = [];
  for (const id of new Set(rows.map((r) => r.eventId!))) out.push(await secureEventQuietly(id));
  return out;
}

const dayOf = (key: string) => formatDate(new Date(`${key}T12:00:00Z`), "UTC");

/**
 * "Deposit received, you're booked", once per wedding (claimed), with what happens next. When it's booked as
 * the contract is signed (`signed`), this is the only email the couple get then, so it thanks them for signing
 * and links to their signed copy (src/actions/contracts.ts leaves out the usual signed-copy email).
 */
async function tellCoupleBooked(eventId: string, opts: { signed: boolean }) {
  const e = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      customer: true,
      agency: { include: { settings: true } },
      quotes: { where: { status: "ACCEPTED" }, orderBy: { answeredAt: "desc" }, take: 1, select: { sentTo: true, answerName: true, agentId: true } },
      contracts: { where: { status: "SIGNED" }, orderBy: { signedAt: "desc" }, take: 1, select: { token: true, signedName: true } },
      // What's booked: not a gig still On hold (one staff pencilled in), an enquiry or a cancelled one.
      bookings: {
        where: { archivedAt: null, status: { notIn: ["CANCELLED", "ENQUIRY", "HOLD"] } },
        include: { artist: { select: { name: true } }, payments: true, agent: { select: { email: true, name: true } } },
        orderBy: { setStart: "asc" },
      },
    },
  });
  if (!e || e.demo) return false;
  const quote = e.quotes[0];
  const contract = e.contracts[0];
  const to = e.customer?.email || quote?.sentTo || "";
  if (!to) return false;
  const brand = e.agency.settings?.agencyName || e.agency.name;
  const first = (quote?.answerName || e.customer?.name || (opts.signed ? contract?.signedName : "") || "").split(" ")[0];
  const day = dayOf(e.date);
  const w = messageFor(e.agency.settings?.messageTemplates, "EVENT_SECURED", { first_name: first, event: e.name, date: day, business: brand });
  // Claimed first, so two callers at the same moment send one email. Switched off: claimed, and nothing goes.
  if (!(await claimReminder(SECURED_KIND, `event:${e.id}`, ""))) return false;
  if (!w.on) return false;

  const t = eventTotals(e.bookings);
  const m = (x: number) => formatMoney(x, t.currency);
  const deposit = e.bookings.reduce((n, b) => n + b.depositMinor, 0);
  const balanceDue = balanceDueDate(e.date);
  const today = localDateKey(new Date(), e.timezone);
  const direct = isDirectPlan(e.payPlan);
  const agent = quote?.agentId ? await prisma.user.findUnique({ where: { id: quote.agentId }, select: { email: true, name: true } }) : null;
  const replyTo = agent?.email || e.bookings.find((b) => b.agent?.email)?.agent?.email || e.agency.settings?.agencyEmail;
  const who = agent?.name || e.bookings.find((b) => b.agent?.name)?.agent?.name || brand;

  const balance =
    t.outstanding <= 0
      ? "Everything is paid, so there's nothing more to pay."
      : direct
        ? "The rest is paid straight to your acts, as agreed. We'll send you the details nearer the time."
        : balanceDue > today
          ? `The balance of ${m(t.outstanding)} is due by ${dayOf(balanceDue)}, three months before your wedding. We'll send you a reminder.`
          : `The balance of ${m(t.outstanding)} is due now, as your wedding is less than three months away.`;
  await sendEmail({
    kind: "EVENT",
    agencyId: e.agencyId,
    to,
    replyTo,
    subject: w.subject ?? `You're booked: ${e.name}`,
    email: {
      brand,
      title: deposit > 0 && !opts.signed ? "Deposit received, you're booked" : "Thank you, you're booked",
      highlight: { label: "Booked", value: `${e.name}, ${day}`, tone: "good" },
      intro:
        w.intro ??
        (opts.signed
          ? `Hi ${first}, thank you for signing your contract.${deposit > 0 ? " Your deposit is in too, so" : ""} ${e.name} on ${day} is booked with ${brand}. Here's what's booked:`
          : deposit > 0
            ? `Hi ${first}, thank you: your deposit has arrived, so ${e.name} on ${day} is booked with ${brand}. Here's what's booked:`
            : quote
              ? `Hi ${first}, thank you for accepting your proposal. ${e.name} on ${day} is booked with ${brand}. Here's what's booked:`
              : `Hi ${first}, thank you. ${e.name} on ${day} is booked with ${brand}. Here's what's booked:`),
      rows: [
        ...e.bookings.map(
          (b) =>
            [b.artist?.name ?? "Act to be confirmed", `${localTime(b.setStart, b.timezone)}${b.setEnd ? ` to ${localTime(b.setEnd, b.timezone)}` : ""}`] as [
              string,
              string,
            ],
        ),
        ["Total", m(t.total)],
        ["Paid so far", m(t.received)],
        ...(t.outstanding > 0 && !direct
          ? ([["Balance", `${m(t.outstanding)}, ${balanceDue > today ? `due by ${dayOf(balanceDue)}` : "due now"}`]] as [string, string][])
          : []),
      ],
      rowsTitle: "Your booking",
      cta: opts.signed && contract ? { label: "See your signed copy", url: contractUrl(contract.token) } : undefined,
      outro: `What happens next: ${balance} Nearer the day we'll ask you for your running order and a few details through your wedding planner, so everyone knows exactly what you'd like. Any questions, just reply to this email to reach ${who}.`,
    },
  });
  return true;
}
