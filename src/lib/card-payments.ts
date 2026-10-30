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

/**
 * A venue or customer has paid on the agency's connected account: log it as payments on the
 * gigs (like a payment entered by hand), once only however often Stripe tells us, and tell the
 * lead agent.
 */
export async function recordCardPayment(s: CheckoutSession, accountId: string): Promise<"recorded" | "duplicate" | "ignored"> {
  if (s.payment_status !== "paid" || !s.amount_total || !s.currency) return "ignored";
  const agency = await prisma.agency.findUnique({ where: { stripeAccountId: accountId }, select: { id: true } });
  if (!agency) return "ignored";
  const raw = await prisma.payLink.findFirst({ where: { id: s.metadata?.gigsaw_link ?? "", agencyId: agency.id }, include: payLinkInclude });
  if (!raw) return "ignored";
  const t = payTarget(raw);
  // Cancelled gigs aren't on the event's invoice, but money paid for an event must land somewhere.
  let gigs = t.gigs;
  if (!gigs.length && raw.eventId) gigs = await prisma.booking.findMany({ where: { eventId: raw.eventId }, include: gigInclude, orderBy: { setStart: "asc" } });
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
          stripePaymentId: typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? ""),
          stripeAccountId: accountId,
          kind: t.kind,
          amountMinor: amount,
          currency,
          email: s.customer_details?.email ?? "",
          paidAt,
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
  await tellAgent(t, amount, currency, s.customer_details?.email ?? "", !parts.length);
  return "recorded";
}

/** The lead agent hears about it (unless they've turned it off); with no agent, the business email does. */
async function tellAgent(t: PayTarget, amount: number, currency: string, payerEmail: string, unmatched: boolean) {
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
      intro: unmatched ? "There were no gigs left to put it against, so please record it on the right gig by hand." : undefined,
      cta: { label: t.link.bookingId ? "Open the booking" : "Open the event", url: t.staffUrl },
      outro: "It's in your Stripe account and logged in Gigsaw as a payment.",
    },
  });
}
