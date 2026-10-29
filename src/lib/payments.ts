// What's still to come in from the venue or client, and still to go out to the act, on a gig.

import { dealBreakdown, paymentTotals, type DealInput, type PaymentLike } from "./money";

export function outstanding(b: DealInput & { payments: PaymentLike[] }) {
  const d = dealBreakdown(b);
  const t = paymentTotals(b.payments);
  return {
    /** Still owed by the venue or client, VAT and booking fee included. */
    toCollect: Math.max(0, d.totalDueMinor - t.receivedMinor),
    /** Still to pay the act. */
    toPay: Math.max(0, d.artistMinor - t.paidOutMinor),
    due: d.totalDueMinor,
    actPay: d.artistMinor,
  };
}
