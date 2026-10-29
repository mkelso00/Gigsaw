import { describe, expect, it } from "vitest";
import { outstanding } from "@/lib/payments";

describe("outstanding", () => {
  const gig = { dealType: "BUY_SELL", feeMinor: 25000, artistFeeMinor: 15000, commissionPct: 15, vatPct: 20, bookingFeeMinor: 5000 };
  it("owed both ways before anything is paid", () => {
    expect(outstanding({ ...gig, payments: [] })).toMatchObject({ toCollect: 36000, toPay: 15000 });
  });
  it("part payments reduce what's owed, and never go below zero", () => {
    const o = outstanding({
      ...gig,
      payments: [
        { direction: "IN", kind: "DEPOSIT", amountMinor: 10000 },
        { direction: "OUT", kind: "SETTLEMENT", amountMinor: 20000 },
      ],
    });
    expect(o).toMatchObject({ toCollect: 26000, toPay: 0 });
  });
});
