// Card payments from venues and customers ("Pay now" links): what a link asks for, how a card
// payment is shared across the gigs it pays for, and the Stripe Checkout Session it opens.
// Plain functions with no database, so they can be tested on their own.

import { dealBreakdown, paymentTotals, type DealInput, type PaymentLike } from "./money";

export const PAY_KINDS = ["DEPOSIT", "BALANCE"] as const;
export type PayKind = (typeof PAY_KINDS)[number];

export const PAY_KIND_LABELS: Record<PayKind, string> = { DEPOSIT: "Deposit", BALANCE: "Balance" };

export const isPayKind = (s: unknown): s is PayKind => s === "DEPOSIT" || s === "BALANCE";

/** A gig as a pay link sees it: what the venue or client pays, its deposit and what's come in. */
export type PayGig = DealInput & { id: string; depositMinor: number; payments: PaymentLike[] };

/** What's still owed on one gig, in all (VAT and booking fee included) and towards its deposit. */
export function gigOwed(g: PayGig) {
  const due = dealBreakdown(g).totalDueMinor;
  const paid = paymentTotals(g.payments);
  const total = Math.max(0, due - paid.receivedMinor);
  const deposit = Math.min(total, Math.max(0, g.depositMinor - paid.depositReceivedMinor));
  return { total, deposit };
}

/**
 * What a link asks for right now. A deposit link asks for whatever's left of the deposits; a
 * balance link for everything still owed (any unpaid deposit included).
 */
export function amountDue(kind: PayKind, gigs: PayGig[]) {
  return gigs.reduce((sum, g) => sum + (kind === "DEPOSIT" ? gigOwed(g).deposit : gigOwed(g).total), 0);
}

export type PaymentPart = { bookingId: string; kind: PayKind; amountMinor: number };

/**
 * Share a card payment across the gigs it's for, soonest first (pass them in date order), the
 * same way as a payment recorded by hand for a wedding or event. Unpaid deposits are filled
 * first and logged as deposits, so a balance paid in one go still marks the deposit as paid.
 * Anything over what's owed (e.g. the fee went down after the client paid) goes on the last gig.
 */
export function allocate(kind: PayKind, amountMinor: number, gigs: PayGig[]): PaymentPart[] {
  if (amountMinor <= 0 || !gigs.length) return [];
  const owed = gigs.map(gigOwed);
  const parts = new Map<string, PaymentPart>();
  const add = (bookingId: string, k: PayKind, amount: number) => {
    if (amount <= 0) return;
    const key = `${bookingId}|${k}`;
    const p = parts.get(key);
    if (p) p.amountMinor += amount;
    else parts.set(key, { bookingId, kind: k, amountMinor: amount });
  };
  let left = amountMinor;
  // Deposits first.
  gigs.forEach((g, i) => {
    const part = Math.min(left, owed[i].deposit);
    add(g.id, "DEPOSIT", part);
    owed[i].total -= part;
    left -= part;
  });
  // Then the rest of what's owed.
  gigs.forEach((g, i) => {
    const part = Math.min(left, owed[i].total);
    add(g.id, kind, part);
    left -= part;
  });
  add(gigs[gigs.length - 1].id, kind, left);
  return [...parts.values()];
}

/**
 * Money received, split for an invoice: each card payment once (an event's is shared across its
 * gigs, so it's added back up), and the total of everything else.
 */
export function receivedOnInvoice(payments: { direction: string; amountMinor: number; paidAt: Date; cardPaymentId: string | null }[]) {
  const card = new Map<string, { paidAt: Date; amountMinor: number }>();
  let otherMinor = 0;
  for (const p of payments) {
    if (p.direction !== "IN") continue;
    if (!p.cardPaymentId) {
      otherMinor += p.amountMinor;
      continue;
    }
    const c = card.get(p.cardPaymentId);
    if (c) c.amountMinor += p.amountMinor;
    else card.set(p.cardPaymentId, { paidAt: p.paidAt, amountMinor: p.amountMinor });
  }
  return { card: [...card.values()].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime()), otherMinor };
}

/**
 * Gigsaw's cut of a card payment, taken by Stripe as an application fee. Nothing for now: this
 * is the one place to change when Gigsaw starts charging for card payments.
 */
export function applicationFeeMinor(amountMinor: number, currency: string): number {
  void amountMinor;
  void currency;
  return 0;
}

/** The Stripe Checkout Session for a pay link, made on the agency's own connected account. */
export function checkoutParams(o: {
  amountMinor: number;
  currency: string;
  description: string;
  linkId: string;
  kind: PayKind;
  agencyId: string;
  email?: string | null;
  successUrl: string;
  cancelUrl: string;
}) {
  const fee = applicationFeeMinor(o.amountMinor, o.currency);
  const metadata = { gigsaw_link: o.linkId, gigsaw_kind: o.kind, gigsaw_agency: o.agencyId };
  return {
    mode: "payment",
    line_items: [{ quantity: 1, price_data: { currency: o.currency.toLowerCase(), unit_amount: o.amountMinor, product_data: { name: o.description } } }],
    client_reference_id: o.linkId,
    customer_email: o.email || undefined,
    metadata,
    payment_intent_data: { description: o.description, metadata, ...(fee > 0 ? { application_fee_amount: fee } : {}) },
    success_url: o.successUrl,
    cancel_url: o.cancelUrl,
  };
}
