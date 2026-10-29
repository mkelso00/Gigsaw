import { describe, expect, it } from "vitest";
import { dealBreakdown, paymentTotals, toMinor, minorToInput, formatMoney } from "@/lib/money";

describe("money parsing", () => {
  it("parses amounts with commas and symbols", () => {
    expect(toMinor("1,250.50")).toBe(125050);
    expect(toMinor("£99.99")).toBe(9999);
    expect(toMinor("")).toBe(0);
    expect(toMinor("5000", "JPY")).toBe(5000);
  });
  it("rejects bad input", () => {
    expect(() => toMinor("abc")).toThrow();
  });
  it("formats for inputs and display", () => {
    expect(minorToInput(125050)).toBe("1250.50");
    expect(formatMoney(125050, "GBP")).toBe("£1,250.50");
  });
});

describe("dealBreakdown", () => {
  it("standard commission with VAT", () => {
    const d = dealBreakdown({ dealType: "STANDARD_COMMISSION", feeMinor: 100000, artistFeeMinor: null, commissionPct: 15, vatPct: 20 });
    expect(d).toEqual({ grossMinor: 100000, vatMinor: 20000, totalDueMinor: 120000, agencyMinor: 15000, artistMinor: 85000 });
  });
  it("buy / sell keeps the margin", () => {
    const d = dealBreakdown({ dealType: "BUY_SELL", feeMinor: 500000, artistFeeMinor: 400000, commissionPct: 15, vatPct: 0 });
    expect(d.agencyMinor).toBe(100000);
    expect(d.artistMinor).toBe(400000);
  });
  it("flat fee takes no commission", () => {
    const d = dealBreakdown({ dealType: "FLAT", feeMinor: 30000, artistFeeMinor: null, commissionPct: 15, vatPct: 0 });
    expect(d.agencyMinor).toBe(0);
    expect(d.artistMinor).toBe(30000);
  });
});

describe("paymentTotals", () => {
  it("sums in and out separately", () => {
    const t = paymentTotals([
      { direction: "IN", kind: "DEPOSIT", amountMinor: 5000 },
      { direction: "IN", kind: "BALANCE", amountMinor: 15000 },
      { direction: "OUT", kind: "SETTLEMENT", amountMinor: 17000 },
    ]);
    expect(t).toEqual({ receivedMinor: 20000, paidOutMinor: 17000, depositReceivedMinor: 5000 });
  });
});
