import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { appUrl, sendEmail } from "./messaging";
import { dealBreakdown, formatMoney, paymentTotals } from "./money";
import { wants } from "./notify-prefs";
import { allocate, amountDue, isPayKind, PAY_KIND_LABELS, type PayGig, type PayKind } from "./pay-links";
import { stripe, stripeConfigured } from "./stripe";
import { formatDate } from "./time";

// Card payments into the agency's own Stripe account (Stripe Connect, Standard accounts).
// Gigsaw's platform key makes the account and its onboarding link; every Checkout Session is
// then made on the agency's account (the Stripe-Account header), so the money is theirs.

/** An agency can take card payments: Stripe is set up for Gigsaw and the agency's account can charge cards. */
export async function cardPaymentsReady(a: { stripeAccountId: string | null; stripeChargesEnabled: boolean }) {
  return (await stripeConfigured()) && !!a.stripeAccountId && a.stripeChargesEnabled;
}

/** The client sees the act's name, or a polite placeholder while the gig has no act yet. */
const actFor = (b: { artist: { name: string } | null }) => b.artist?.name ?? "Act to be confirmed";

export function payUrl(token: string) {
  return `${appUrl()}/pay/${token}`;
}

export type StripeAccount = { id: string; charges_enabled?: boolean; details_submitted?: boolean };

/** Keep an agency's card payment status in step with its Stripe account. */
export async function applyAccount(a: StripeAccount) {
  await prisma.agency.updateMany({
    where: { stripeAccountId: a.id },
    data: { stripeChargesEnabled: !!a.charges_enabled, stripeDetailsDone: !!a.details_submitted },
  });
}

/** Look the account up in Stripe and save what it says. */
export async function refreshAccount(accountId: string) {
  const a = await stripe<StripeAccount>("GET", `accounts/${accountId}`);
  await applyAccount(a);
  return a;
}

/** A one-off link to Stripe's onboarding for the agency's account. They expire after a few minutes. */
export async function onboardingLink(accountId: string) {
  const base = `${appUrl()}/settings/card-payments`;
  const link = await stripe<{ url: string }>("POST", "account_links", {
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${base}/refresh`,
    return_url: `${base}?connected=1`,
  });
  return link.url;
}

/** The booking's or event's link for this kind, made the first time it's asked for. */
export async function ensurePayLink(agencyId: string, target: { bookingId: string } | { eventId: string }, kind: PayKind) {
  const where = "bookingId" in target ? { bookingId_kind: { bookingId: target.bookingId, kind } } : { eventId_kind: { eventId: target.eventId, kind } };
  const found = await prisma.payLink.findUnique({ where });
  if (found) return found;
  try {
    return await prisma.payLink.create({ data: { agencyId, ...target, kind, token: randomBytes(18).toString("base64url") } });
  } catch (e) {
    // Made by someone else at the same moment.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return prisma.payLink.findUniqueOrThrow({ where });
    throw e;
  }
}

const gigInclude = { artist: { select: { name: true } }, payments: true } satisfies Prisma.BookingInclude;

export const payLinkInclude = {
  agency: { include: { settings: true } },
  booking: {
    include: {
      ...gigInclude,
      venue: { select: { name: true, city: true } },
      promoter: true,
    },
  },
  event: {
    include: {
      customer: true,
      venue: { select: { name: true, city: true } },
      // The same gigs as the customer's invoice.
      bookings: {
        where: { archivedAt: null, status: { not: "CANCELLED" } },
        include: gigInclude,
        orderBy: { setStart: "asc" },
      },
    },
  },
} satisfies Prisma.PayLinkInclude;
type FullPayLink = Prisma.PayLinkGetPayload<{ include: typeof payLinkInclude }>;

/**
 * Everything a pay link shows the venue or customer, worked out afresh: the invoice lines (what
 * they pay, never what the acts are paid), what's been paid and what's due now.
 */
export function payTarget(link: FullPayLink) {
  const kind: PayKind = isPayKind(link.kind) ? link.kind : "BALANCE";
  const agency = link.agency;
  const brand = agency.settings?.agencyName || agency.name;
  const live = agency.status === "ACTIVE";
  if (link.booking) {
    const b = link.booking;
    const d = dealBreakdown(b);
    const where = b.venue ? ` at ${b.venue.name}${b.venue.city ? `, ${b.venue.city}` : ""}` : "";
    const day = formatDate(b.arriveBy, b.timezone);
    const gigs: PayGig[] = [b];
    const lines: [string, number][] = [[`Performance by ${actFor(b)}${where} on ${day}${b.eventName ? ` (${b.eventName})` : ""}`, d.grossMinor]];
    if (d.bookingFeeMinor) lines.push(["Booking fee", d.bookingFeeMinor]);
    return {
      link,
      kind,
      brand,
      agency,
      currency: b.currency,
      what: `${actFor(b)}${where}, ${day}`,
      reference: b.reference,
      lines,
      vatMinor: d.vatMinor,
      vatLabel: d.vatMinor ? `VAT at ${b.vatPct}%` : "",
      totalMinor: d.totalDueMinor,
      paidMinor: paymentTotals(b.payments).receivedMinor,
      dueMinor: amountDue(kind, gigs),
      depositMinor: b.depositMinor,
      gigs,
      payer: b.promoter ? { name: b.promoter.name, email: b.promoter.email } : null,
      agentId: b.agentId,
      open: live && !b.archivedAt && b.status !== "CANCELLED",
      staffUrl: `${appUrl()}/bookings/${b.id}`,
    };
  }
  const e = link.event!;
  const gigs: PayGig[] = e.bookings;
  let vat = 0;
  let fees = 0;
  let total = 0;
  let paid = 0;
  let deposits = 0;
  const lines: [string, number][] = [];
  for (const b of e.bookings) {
    const d = dealBreakdown(b);
    lines.push([actFor(b), d.grossMinor]);
    vat += d.vatMinor;
    fees += d.bookingFeeMinor;
    total += d.totalDueMinor;
    paid += paymentTotals(b.payments).receivedMinor;
    deposits += b.depositMinor;
  }
  if (fees) lines.push(["Booking fee", fees]);
  const day = formatDate(new Date(`${e.date}T12:00:00Z`), "UTC");
  return {
    link,
    kind,
    brand,
    agency,
    currency: e.bookings[0]?.currency ?? agency.settings?.defaultCurrency ?? "GBP",
    what: `${e.name}, ${day}`,
    reference: e.bookings[0]?.reference ?? "",
    lines,
    vatMinor: vat,
    vatLabel: vat ? "VAT" : "",
    totalMinor: total,
    paidMinor: paid,
    dueMinor: amountDue(kind, gigs),
    depositMinor: deposits,
    gigs,
    payer: e.customer ? { name: e.customer.name, email: e.customer.email } : null,
    // The event's lead agent, or failing that the first act's.
    agentId: e.agentId ?? e.bookings.find((b) => b.agentId)?.agentId ?? null,
    open: live && e.status === "ACTIVE" && e.bookings.length > 0,
    staffUrl: `${appUrl()}/events/${e.id}`,
  };
}
export type PayTarget = ReturnType<typeof payTarget>;

export async function loadPayLink(where: { token: string } | { id: string }) {
  const link = await prisma.payLink.findUnique({ where, include: payLinkInclude });
  return link ? payTarget(link) : null;
}

type CheckoutSession = {
  id: string;
  payment_status?: string;
  amount_total?: number | null;
  currency?: string | null;
  payment_intent?: string | { id: string } | null;
  customer_details?: { email?: string | null } | null;
  metadata?: Record<string, string> | null;
};

export type CardPaymentResult = "recorded" | "unmatched" | "duplicate" | "ignored";

/** Why a card payment couldn't be put against a booking, as staff are told. */
export const UNMATCHED_REASONS = {
  NOT_CONNECTED: "It was paid into a Stripe account that's no longer connected to Gigsaw.",
  NO_LINK: "The payment link, or the booking or event it was for, was deleted before the payment came in.",
  NO_BOOKINGS: "There were no bookings left on the link to put it against.",
} as const;

const paymentIntentOf = (pi: string | { id: string } | null | undefined) => (typeof pi === "string" ? pi : (pi?.id ?? ""));

/**
 * The business a Stripe account belonged to before it was disconnected: from the card payments
 * already logged from it, or from when it was connected (each account is made for one business).
 * Never from the session's own metadata, which the account's owner could have written.
 */
async function formerAgency(accountId: string) {
  const paid = await prisma.cardPayment.findFirst({
    where: { stripeAccountId: accountId, status: "MATCHED", agencyId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { agencyId: true },
  });
  if (paid?.agencyId) return paid.agencyId;
  const connected = await prisma.activity.findFirst({
    where: { entity: "SETTINGS", action: { in: ["connected a Stripe account", "disconnected Stripe"] }, detail: accountId, agencyId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { agencyId: true },
  });
  return connected?.agencyId ?? null;
}

/**
 * A venue or customer has paid on the agency's connected account: log it as payments on the
 * gigs (like a payment entered by hand), once only however often Stripe tells us, and tell the
 * lead agent. Money Stripe has taken is never dropped: if it can't be put against a booking, it's
 * kept as an unmatched card payment for staff (or, if Gigsaw can't tell whose it is, the owner)
 * to sort out, and they're told. Anything that fails throws, so Stripe tries again.
 */
export async function recordCardPayment(s: CheckoutSession, accountId: string): Promise<CardPaymentResult> {
  if (s.payment_status !== "paid" || !s.amount_total || !s.currency) return "ignored";
  // Only sessions Gigsaw made: the agency may sell other things through the same Stripe account.
  const linkId = s.metadata?.gigsaw_link;
  if (!linkId) return "ignored";
  if (await prisma.cardPayment.findUnique({ where: { stripeSessionId: s.id }, select: { id: true } })) return "duplicate";
  const agency = await prisma.agency.findUnique({ where: { stripeAccountId: accountId }, select: { id: true } });
  if (!agency) return keepUnmatched(s, accountId, await formerAgency(accountId), "NOT_CONNECTED");
  const raw = await prisma.payLink.findFirst({ where: { id: linkId, agencyId: agency.id }, include: payLinkInclude });
  if (!raw) return keepUnmatched(s, accountId, agency.id, "NO_LINK");
  const t = payTarget(raw);
  // Cancelled gigs aren't on the event's invoice, but money paid for an event must land somewhere.
  let gigs = t.gigs;
  // Archived ones too (archivedAt: undefined), or money paid for an event whose bookings are all archived would have nowhere to go.
  if (!gigs.length && raw.eventId) {
    gigs = await prisma.booking.findMany({ where: { eventId: raw.eventId, archivedAt: undefined }, include: gigInclude, orderBy: { setStart: "asc" } });
  }
  const amount = s.amount_total;
  const currency = s.currency.toUpperCase();
  const paidAt = new Date();
  const parts = allocate(t.kind, amount, gigs);
  const money = formatMoney(amount, currency);
  try {
    await prisma.$transaction(async (tx) => {
      const card = await tx.cardPayment.create({
        data: {
          agencyId: agency.id,
          payLinkId: raw.id,
          stripeSessionId: s.id,
          stripePaymentId: paymentIntentOf(s.payment_intent),
          stripeAccountId: accountId,
          kind: t.kind,
          amountMinor: amount,
          currency,
          email: s.customer_details?.email ?? "",
          paidAt,
          ...(parts.length ? {} : { status: "UNMATCHED", problem: UNMATCHED_REASONS.NO_BOOKINGS }),
        },
      });
      await tx.payment.createMany({
        data: parts.map((p) => ({
          bookingId: p.bookingId,
          direction: "IN",
          kind: p.kind,
          amountMinor: p.amountMinor,
          paidAt,
          note: "Paid by card",
          cardPaymentId: card.id,
        })),
      });
      await tx.activity.createMany({
        data: [
          ...parts.map((p, i) => ({
            agencyId: agency.id,
            entity: "BOOKING",
            entityId: p.bookingId,
            action: "payment received",
            detail: `${p.kind.toLowerCase()} ${formatMoney(p.amountMinor, currency)} by card`,
            createdAt: new Date(paidAt.getTime() + i),
          })),
          ...(raw.eventId ? [{ agencyId: agency.id, entity: "EVENT", entityId: raw.eventId, action: "customer paid by card", detail: money }] : []),
        ],
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate";
    throw e;
  }
  if (!parts.length) {
    await tellUnmatched(agency.id, t.agentId, { amount, currency, email: s.customer_details?.email ?? "", problem: UNMATCHED_REASONS.NO_BOOKINGS });
    return "unmatched";
  }
  await tellAgent(t, amount, currency, s.customer_details?.email ?? "");
  return "recorded";
}

/** Keep a paid session that can't be put against a booking, and tell someone. */
async function keepUnmatched(s: CheckoutSession, accountId: string, agencyId: string | null, why: keyof typeof UNMATCHED_REASONS): Promise<CardPaymentResult> {
  const amount = s.amount_total!;
  const currency = s.currency!.toUpperCase();
  const kind = isPayKind(s.metadata?.gigsaw_kind) ? s.metadata.gigsaw_kind : "BALANCE";
  try {
    await prisma.cardPayment.create({
      data: {
        agencyId,
        stripeSessionId: s.id,
        stripePaymentId: paymentIntentOf(s.payment_intent),
        stripeAccountId: accountId,
        kind,
        amountMinor: amount,
        currency,
        email: s.customer_details?.email ?? "",
        paidAt: new Date(),
        status: "UNMATCHED",
        problem: UNMATCHED_REASONS[why],
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate";
    throw e;
  }
  await tellUnmatched(agencyId, null, { amount, currency, email: s.customer_details?.email ?? "", problem: UNMATCHED_REASONS[why], accountId });
  return "unmatched";
}

/** Who hears about money to sort out: the lead agent if there is one, else the business email, else its admins. */
async function businessContacts(agencyId: string, agentId: string | null) {
  const agent = agentId ? await prisma.user.findUnique({ where: { id: agentId }, select: { email: true } }) : null;
  if (agent?.email) return [agent.email];
  const settings = await prisma.settings.findUnique({ where: { agencyId }, select: { agencyEmail: true } });
  if (settings?.agencyEmail) return [settings.agencyEmail];
  const admins = await prisma.user.findMany({ where: { agencyId, role: "ADMIN", demo: false }, select: { email: true } });
  return admins.map((a) => a.email);
}

/**
 * Tell the business (or, when Gigsaw can't tell whose it is, the owner) that a card payment needs
 * putting against a booking. It's in the Outbox either way.
 */
async function tellUnmatched(
  agencyId: string | null,
  agentId: string | null,
  p: { amount: number; currency: string; email: string; problem: string; accountId?: string },
) {
  const agency = agencyId ? await prisma.agency.findUnique({ where: { id: agencyId }, include: { settings: true } }) : null;
  const to = agency
    ? await businessContacts(agency.id, agentId)
    : (await prisma.user.findMany({ where: { isOwner: true }, select: { email: true } })).map((u) => u.email);
  const money = formatMoney(p.amount, p.currency);
  const subject = `Card payment to sort out: ${money}`;
  for (const address of new Set(to)) {
    await sendEmail({
      kind: "PAYMENT",
      agencyId: agency?.id ?? null,
      to: address,
      subject,
      email: {
        brand: agency ? agency.settings?.agencyName || agency.name : "Gigsaw",
        title: subject,
        highlight: { label: "Paid by card, not yet on a booking", value: money, tone: "warn" },
        intro: agency
          ? `${p.problem} The money is in the Stripe account. Please put it against the right booking in Gigsaw.`
          : `${p.problem} Gigsaw can't tell which business it's for. Please pass it on to the right one in the Owner area.`,
        rows: [
          ...(p.email ? ([["Paid by", p.email]] as [string, string][]) : []),
          ...(!agency && p.accountId ? ([["Stripe account", p.accountId]] as [string, string][]) : []),
        ],
        cta: agency ? { label: "Open Payments", url: `${appUrl()}/payments` } : { label: "Open the Owner area", url: `${appUrl()}/owner/stripe` },
      },
    });
  }
}

type StripeCharge = { id: string; payment_intent?: string | { id: string } | null; amount_refunded?: number; currency?: string };

/**
 * A card payment was refunded in Stripe (charge.refunded). Gigsaw notes how much on the card
 * payment and its payments, logs it on the bookings and tells the business; it doesn't change
 * what's been paid, so staff adjust the booking's payments by hand if the money shouldn't count.
 */
export async function recordCardRefund(c: StripeCharge, accountId: string): Promise<"recorded" | "duplicate" | "ignored"> {
  const pi = paymentIntentOf(c.payment_intent);
  if (!pi) return "ignored";
  const card = await prisma.cardPayment.findFirst({
    where: { stripeAccountId: accountId, stripePaymentId: pi },
    include: { payments: { select: { bookingId: true } } },
  });
  if (!card) return "ignored";
  // Stripe sends the total refunded so far, so a late or repeated event never counts twice.
  const refunded = Math.min(card.amountMinor, c.amount_refunded ?? 0);
  if (refunded <= card.refundedMinor) return "duplicate";
  const saved = await prisma.cardPayment.updateMany({
    where: { id: card.id, refundedMinor: card.refundedMinor },
    data: { refundedMinor: refunded, refundedAt: new Date() },
  });
  if (!saved.count) return "duplicate";
  const money = formatMoney(refunded, card.currency);
  const bookingIds = [...new Set(card.payments.map((p) => p.bookingId))];
  await prisma.payment.updateMany({ where: { cardPaymentId: card.id }, data: { note: `Paid by card, ${money} refunded in Stripe` } });
  if (card.agencyId) {
    await prisma.activity.createMany({
      data: bookingIds.map((bookingId) => ({
        agencyId: card.agencyId,
        entity: "BOOKING",
        entityId: bookingId,
        action: "card payment refunded",
        detail: money,
      })),
    });
    const agency = await prisma.agency.findUnique({ where: { id: card.agencyId }, include: { settings: true } });
    const [to] = await businessContacts(card.agencyId, null);
    if (agency && to) {
      const subject = `Card payment refunded: ${money} of ${formatMoney(card.amountMinor, card.currency)}`;
      await sendEmail({
        kind: "PAYMENT",
        agencyId: card.agencyId,
        bookingId: bookingIds[0] ?? null,
        to,
        subject,
        email: {
          brand: agency.settings?.agencyName || agency.name,
          title: subject,
          highlight: { label: "Refunded in Stripe", value: money, tone: "warn" },
          intro: "Gigsaw still shows the full payment on the booking. If the refunded money shouldn't count, change or remove the payment on the booking.",
          rows: card.email ? [["Paid by", card.email]] : [],
          cta:
            bookingIds.length === 1
              ? { label: "Open the booking", url: `${appUrl()}/bookings/${bookingIds[0]}` }
              : { label: "Open Payments", url: `${appUrl()}/payments` },
        },
      });
    }
  }
  return "recorded";
}

/** The lead agent hears about it (unless they've turned it off); with no agent, the business email does. */
async function tellAgent(t: PayTarget, amount: number, currency: string, payerEmail: string) {
  const agent = t.agentId ? await prisma.user.findUnique({ where: { id: t.agentId }, select: { email: true, notifyPrefs: true } }) : null;
  const to = agent ? (wants(agent.notifyPrefs, "PAID", "email") ? agent.email : null) : t.agency.settings?.agencyEmail;
  if (!to) return;
  const money = formatMoney(amount, currency);
  const left = Math.max(0, t.totalMinor - t.paidMinor - amount);
  const subject = `Paid by card: ${money} for ${t.what}`;
  await sendEmail({
    kind: "PAYMENT",
    agencyId: t.agency.id,
    bookingId: t.link.bookingId,
    to,
    subject,
    email: {
      brand: t.brand,
      title: subject,
      highlight: { label: `${PAY_KIND_LABELS[t.kind]} paid by card`, value: money, tone: "good" },
      rows: [
        ["For", t.what],
        ...(t.payer ? ([["Paid by", [t.payer.name, payerEmail].filter(Boolean).join(", ")]] as [string, string][]) : []),
        ["Still to pay", formatMoney(left, currency)],
      ],
      cta: { label: t.link.bookingId ? "Open the booking" : "Open the event", url: t.staffUrl },
      outro: "It's in your Stripe account and logged in Gigsaw as a payment.",
    },
  });
}
