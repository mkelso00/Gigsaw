// How a wedding or event's customer pays, chosen per wedding or event (Event.payPlan):
//   FULL              everything to the business, VAT included (corporate clients, and the default)
//   DEPOSIT_CASH      the deposit to the business; each act's fee in cash to the act on the day
//   DEPOSIT_TRANSFER  the deposit to the business; each act's fee by bank transfer straight to the act
// With a deposit plan the business's share is what's left once the act's fee is taken off (the deposit),
// and staff mark each act's part paid when it's in: that's logged as paid in by the customer and paid out
// to the act, both with DIRECT_NOTE, so neither shows as owed and the act's invoice reads paid.
// Plain functions, no database.

import { dealBreakdown, paymentTotals, type DealInput } from "./money";

export const PAY_PLANS = ["FULL", "DEPOSIT_CASH", "DEPOSIT_TRANSFER"] as const;
export type PayPlan = (typeof PAY_PLANS)[number];

export const PAY_PLAN_LABELS: Record<PayPlan, string> = {
  FULL: "Pay us in full (plus VAT)",
  DEPOSIT_CASH: "Deposit to us, then cash to the act on the day",
  DEPOSIT_TRANSFER: "Deposit to us, then bank transfer straight to the act",
};

export const PAY_PLAN_HINTS: Record<PayPlan, string> = {
  FULL: "Everything comes to you, by card link or bank transfer. Right for corporate clients.",
  DEPOSIT_CASH: "You take the deposit. Each act is paid their fee in cash on the day.",
  DEPOSIT_TRANSFER: "You take the deposit. The couple's page shows each act's bank details and how much to send them.",
};

export const isPayPlan = (s: unknown): s is PayPlan => typeof s === "string" && (PAY_PLANS as readonly string[]).includes(s);
export const isDirectPlan = (p: string): p is "DEPOSIT_CASH" | "DEPOSIT_TRANSFER" => p === "DEPOSIT_CASH" || p === "DEPOSIT_TRANSFER";

/** On the payments the customer makes straight to an act, in and out. */
export const DIRECT_NOTE = "Paid by the customer straight to the act";

type Pay = { direction: string; kind: string; amountMinor: number; note?: string | null };
export type PlanGig = DealInput & { depositMinor: number; payments: Pay[] };

/**
 * One gig's money under a deposit plan: the act's part (their fee, paid to them direct) and the business's
 * (everything else: the deposit), each with what's still to come in.
 */
export function directSplit(g: PlanGig) {
  const d = dealBreakdown(g);
  const t = paymentTotals(g.payments);
  const direct = g.payments.filter((p) => p.direction === "IN" && p.note === DIRECT_NOTE).reduce((s, p) => s + p.amountMinor, 0);
  const toAct = d.artistMinor;
  const toUs = Math.max(0, d.totalDueMinor - toAct);
  return {
    toAct,
    actLeft: Math.max(0, toAct - t.paidOutMinor),
    toUs,
    usLeft: Math.max(0, toUs - (t.receivedMinor - direct)),
  };
}

/** The customer's money for a whole wedding or event under a deposit plan. */
export function directTotals(gigs: PlanGig[]) {
  return gigs.reduce(
    (t, g) => {
      const s = directSplit(g);
      return { toAct: t.toAct + s.toAct, actLeft: t.actLeft + s.actLeft, toUs: t.toUs + s.toUs, usLeft: t.usLeft + s.usLeft };
    },
    { toAct: 0, actLeft: 0, toUs: 0, usLeft: 0 },
  );
}
