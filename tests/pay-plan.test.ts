import { describe, expect, it } from "vitest";
import { DIRECT_NOTE, directSplit, directTotals, isDirectPlan } from "@/lib/pay-plan";

// £1,000 sale, £600 to the band, £400 deposit: the deposit is ours, the band's fee goes to them direct.
const gig = (payments: { direction: string; kind: string; amountMinor: number; note?: string }[] = []) => ({
  dealType: "BUY_SELL",
  feeMinor: 100_000,
  artistFeeMinor: 60_000,
  commissionPct: 0,
  vatPct: 0,
  bookingFeeMinor: 0,
  depositMinor: 40_000,
  payments,
});

describe("paying the acts direct", () => {
  it("splits a gig into the deposit (ours) and the band's fee (theirs)", () => {
    expect(directSplit(gig())).toEqual({ toAct: 60_000, actLeft: 60_000, toUs: 40_000, usLeft: 40_000 });
  });

  it("counts the deposit paid to us, and the band's part once staff mark it paid", () => {
    const paidDeposit = gig([{ direction: "IN", kind: "DEPOSIT", amountMinor: 40_000 }]);
    expect(directSplit(paidDeposit)).toMatchObject({ usLeft: 0, actLeft: 60_000 });
    const allPaid = gig([
      { direction: "IN", kind: "DEPOSIT", amountMinor: 40_000 },
      { direction: "IN", kind: "BALANCE", amountMinor: 60_000, note: DIRECT_NOTE },
      { direction: "OUT", kind: "SETTLEMENT", amountMinor: 60_000, note: DIRECT_NOTE },
    ]);
    expect(directSplit(allPaid)).toMatchObject({ usLeft: 0, actLeft: 0 });
  });

  it("doesn't count the band's money as paying our deposit", () => {
    const bandPaidFirst = gig([
      { direction: "IN", kind: "BALANCE", amountMinor: 60_000, note: DIRECT_NOTE },
      { direction: "OUT", kind: "SETTLEMENT", amountMinor: 60_000, note: DIRECT_NOTE },
    ]);
    expect(directSplit(bandPaidFirst)).toMatchObject({ usLeft: 40_000, actLeft: 0 });
  });

  it("adds up a wedding with two acts, and only the deposit plans pay acts direct", () => {
    expect(directTotals([gig(), gig([{ direction: "IN", kind: "DEPOSIT", amountMinor: 40_000 }])])).toEqual({
      toAct: 120_000,
      actLeft: 120_000,
      toUs: 80_000,
      usLeft: 40_000,
    });
    expect(isDirectPlan("FULL")).toBe(false);
    expect(isDirectPlan("DEPOSIT_CASH")).toBe(true);
    expect(isDirectPlan("DEPOSIT_TRANSFER")).toBe(true);
  });
});
