import "server-only";
import { queueCalendarSync } from "./calendar-sync/queue";
import { onConfirmed } from "./confirmations";
import { prisma } from "./db";
import { eventTotals } from "./events";
import { messageFor } from "./message-templates";
import { sendEmail } from "./messaging";
import { formatMoney, paymentTotals } from "./money";
import { isDirectPlan } from "./pay-plan";
import { claimReminder } from "./reminders";
import { formatDate, localDateKey, localTime } from "./time";
import { log } from "@/server/log";

// The gate a wedding passes through to be booked. The couple's terms say a booking is confirmed only
// when the contract is agreed (the proposal accepted, or a contract signed) AND the deposit is in. Until
// then the wedding's gigs are on Hold: the date is kept for them, but the acts aren't told. Once both
// are true, secureEvent moves the held gigs on (Confirmed with an act, Pending without), tells the acts
// as a confirmation always does, and sends the couple one "you're booked" email.
//
// It's called after anything that could tip the balance: the proposal being accepted, a contract being
// signed, and every payment in from the customer. It's safe to call as often as you like, from
// anywhere, at the same time: the event row is locked while its gigs are moved, and the email is
// claimed once in the Reminder table (EV_SECURED, alongside the other wedding emails).

/** The key the couple's "you're booked" email is claimed under (src/lib/events.ts reads EV_* as sent emails). */
export const SECURED_KIND = "EV_SECURED";

export type SecureResult = {
  /** The contract is agreed and the deposit is in (or none was asked for). */
  secured: boolean;
  /** Gigs this call moved off Hold. */
  moved: string[];
  /** This call sent the couple their "you're booked" email (so a plain payment receipt isn't needed as well). */
  told: boolean;
};

const NOTHING: SecureResult = { secured: false, moved: [], told: false };

/** Booked once the contract is agreed (proposal accepted or contract signed) and payments in cover the deposit. */
export function isSecured(s: { agreed: boolean; depositMinor: number; receivedMinor: number }) {
  return s.agreed && s.receivedMinor >= Math.max(0, s.depositMinor);
}

/** A day key a number of months earlier, e.g. the balance date 3 months before the wedding (31 May less 3 months is 28 Feb). */
export function monthsBefore(key: string, months: number) {
  const [y, m, d] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** When the balance is due: three months before the wedding, as the terms say. */
export const BALANCE_MONTHS_BEFORE = 3;

/**
 * Check a wedding against the gate and, if it's now secured, book it. `announce` sends the couple's
 * email even when no gig was on Hold: the proposal has just been accepted with no deposit to wait for.
 * Anything else (an older wedding that was booked long ago taking a payment) never hears it.
 */
export async function secureEvent(eventId: string, opts: { announce?: boolean } = {}): Promise<SecureResult> {
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
        bookings: { include: { payments: { select: { direction: true, kind: true, amountMinor: true } } } },
        quotes: { where: { status: "ACCEPTED" }, select: { id: true, tellActs: true } },
        contracts: { where: { status: "SIGNED" }, select: { id: true } },
      },
    });
    if (!e || e.status !== "ACTIVE" || e.type !== "WEDDING") return null;
    const live = e.bookings.filter((b) => b.status !== "CANCELLED" && !b.archivedAt);
    const depositMinor = live.reduce((n, b) => n + b.depositMinor, 0);
    const receivedMinor = e.bookings.reduce((n, b) => n + paymentTotals(b.payments).receivedMinor, 0);
    const agreed = e.quotes.length > 0 || e.contracts.length > 0;
    if (!isSecured({ agreed, depositMinor, receivedMinor })) return { secured: false, moved: [] as { id: string; artistId: string | null }[], tellActs: true };

    const held = live.filter((b) => b.status === "HOLD");
    const withAct = held.filter((b) => b.artistId).map((b) => b.id);
    const noAct = held.filter((b) => !b.artistId).map((b) => b.id);
    // The couple's email lists every act, so they aren't sent the per-act "confirmed" email as well.
    if (withAct.length) await tx.booking.updateMany({ where: { id: { in: withAct }, status: "HOLD" }, data: { status: "CONFIRMED", customerToldAt: now } });
    if (noAct.length) await tx.booking.updateMany({ where: { id: { in: noAct }, status: "HOLD" }, data: { status: "PENDING" } });
    if (held.length) {
      const why = depositMinor > 0 ? "deposit received" : "contract agreed";
      await tx.activity.createMany({
        data: [
          { agencyId: e.agencyId, entity: "EVENT", entityId: e.id, action: "booked: contract agreed and deposit in", detail: why, createdAt: now },
          ...held.map((b, i) => ({
            agencyId: e.agencyId,
            entity: "BOOKING",
            entityId: b.id,
            action: b.artistId ? "confirmed" : "booked, pending: act to be confirmed",
            detail: why,
            createdAt: new Date(now.getTime() + 1 + i),
          })),
        ],
      });
    }
    // Staff unticked "tell the acts" on the proposal: they tell them themselves.
    const tellActs = e.quotes.length ? e.quotes.some((q) => q.tellActs) : true;
    return { secured: true, moved: held.map((b) => ({ id: b.id, artistId: b.artistId })), tellActs };
  });
  if (!result) return NOTHING;
  if (!result.secured) return NOTHING;

  const moved = result.moved.map((b) => b.id);
  queueCalendarSync(moved);
  for (const b of result.tellActs ? result.moved : []) {
    if (!b.artistId) continue;
    try {
      await onConfirmed(b.id);
    } catch (e) {
      log.error("Wedding booked, but telling an act failed", { err: e, bookingId: b.id });
    }
  }

  let told = false;
  if (moved.length || opts.announce) {
    try {
      told = await tellCoupleBooked(eventId);
    } catch (e) {
      log.error("Wedding booked, but the couple's email failed", { err: e, eventId });
    }
  }
  return { secured: true, moved, told };
}

/** The same, never throwing: for the places a payment or signature is saved, which mustn't fail because of it. */
export async function secureEventQuietly(eventId: string | null | undefined, opts: { announce?: boolean } = {}): Promise<SecureResult> {
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

/** "Deposit received, you're booked", once per wedding (claimed), with what happens next. */
async function tellCoupleBooked(eventId: string) {
  const e = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      customer: true,
      agency: { include: { settings: true } },
      quotes: { where: { status: "ACCEPTED" }, orderBy: { answeredAt: "desc" }, take: 1, select: { sentTo: true, answerName: true, agentId: true } },
      bookings: {
        where: { archivedAt: null, status: { notIn: ["CANCELLED", "ENQUIRY"] } },
        include: { artist: { select: { name: true } }, payments: true, agent: { select: { email: true, name: true } } },
        orderBy: { setStart: "asc" },
      },
    },
  });
  if (!e || e.demo) return false;
  const quote = e.quotes[0];
  const to = e.customer?.email || quote?.sentTo || "";
  if (!to) return false;
  const brand = e.agency.settings?.agencyName || e.agency.name;
  const first = (quote?.answerName || e.customer?.name || "").split(" ")[0];
  const day = dayOf(e.date);
  const w = messageFor(e.agency.settings?.messageTemplates, "EVENT_SECURED", { first_name: first, event: e.name, date: day, business: brand });
  // Claimed first, so two callers at the same moment send one email. Switched off: claimed, and nothing goes.
  if (!(await claimReminder(SECURED_KIND, `event:${e.id}`, ""))) return false;
  if (!w.on) return false;

  const t = eventTotals(e.bookings);
  const m = (x: number) => formatMoney(x, t.currency);
  const deposit = e.bookings.reduce((n, b) => n + b.depositMinor, 0);
  const balanceDue = monthsBefore(e.date, BALANCE_MONTHS_BEFORE);
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
      title: deposit > 0 ? "Deposit received, you're booked" : "Thank you, you're booked",
      highlight: { label: "Booked", value: `${e.name}, ${day}`, tone: "good" },
      intro:
        w.intro ??
        (deposit > 0
          ? `Hi ${first}, thank you: your deposit has arrived, so ${e.name} on ${day} is booked with ${brand}. Here's what's booked:`
          : `Hi ${first}, thank you for accepting your proposal. ${e.name} on ${day} is booked with ${brand}. Here's what's booked:`),
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
      outro: `What happens next: ${balance} Nearer the day we'll ask you for your running order and a few details through your wedding planner, so everyone knows exactly what you'd like. Any questions, just reply to this email to reach ${who}.`,
    },
  });
  return true;
}
