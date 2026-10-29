import { describe, expect, it } from "vitest";
import { dealBreakdown, defaultBookingFee, paymentTotals, toMinor, minorToInput, formatMoney } from "@/lib/money";

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
    expect(d).toEqual({ grossMinor: 100000, bookingFeeMinor: 0, vatMinor: 20000, totalDueMinor: 120000, agencyMinor: 15000, artistMinor: 85000 });
  });
  it("buy / sell keeps the margin", () => {
    const d = dealBreakdown({ dealType: "BUY_SELL", feeMinor: 500000, artistFeeMinor: 400000, commissionPct: 15, vatPct: 0 });
    expect(d.agencyMinor).toBe(100000);
    expect(d.artistMinor).toBe(400000);
  });
  it("booking fee goes on top, all ours, with VAT, and never touches the act's pay", () => {
    const d = dealBreakdown({ dealType: "BUY_SELL", feeMinor: 25000, artistFeeMinor: 15000, commissionPct: 15, vatPct: 20, bookingFeeMinor: 5000 });
    expect(d).toEqual({ grossMinor: 25000, bookingFeeMinor: 5000, vatMinor: 6000, totalDueMinor: 36000, agencyMinor: 15000, artistMinor: 15000 });
    const c = dealBreakdown({ dealType: "STANDARD_COMMISSION", feeMinor: 100000, artistFeeMinor: null, commissionPct: 10, vatPct: 0, bookingFeeMinor: 5000 });
    expect(c.agencyMinor).toBe(15000); // 10% commission on the fee only, plus the booking fee
    expect(c.artistMinor).toBe(90000);
  });
  it("default booking fee: weddings and private events once per event, or every booking", () => {
    const events = { bookingFeeMinor: 7500, bookingFeeFor: "EVENTS" };
    expect(defaultBookingFee(events, { eventType: "WEDDING" })).toBe(7500);
    expect(defaultBookingFee(events, { eventType: "GIG" })).toBe(0);
    expect(defaultBookingFee(events, { eventType: "WEDDING", eventHasFee: true })).toBe(0);
    expect(defaultBookingFee({ bookingFeeMinor: 2000, bookingFeeFor: "ALL" }, { eventType: "GIG" })).toBe(2000);
    expect(defaultBookingFee({ bookingFeeMinor: 0, bookingFeeFor: "ALL" }, { eventType: "WEDDING" })).toBe(0);
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
