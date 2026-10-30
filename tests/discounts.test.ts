import { describe, expect, it, vi } from "vitest";
import {
  codeStatus,
  couponParams,
  describeDiscount,
  DiscountError,
  discountedMinor,
  fromStripeCoupon,
  parseDiscount,
  promotionCodeParams,
  type DiscountInput,
} from "@/lib/discounts";

vi.mock("server-only", () => ({}));
const { encodeForm } = await import("@/lib/stripe");

const now = new Date("2026-11-01T12:00:00Z");
const base: DiscountInput = {
  code: "launch20",
  kind: "percent",
  percent: "20",
  amount: "",
  duration: "once",
  months: "",
  expires: "",
  maxRedemptions: "",
  planKeys: [],
};

describe("making a discount code", () => {
  it("reads a percentage off, once", () => {
    expect(parseDiscount(base, now)).toEqual({
      code: "LAUNCH20",
      percentOff: 20,
      amountOffMinor: null,
      currency: "GBP",
      duration: "once",
      durationMonths: null,
      expiresAt: null,
      maxRedemptions: null,
      planKeys: [],
    });
  });

  it("reads pounds off for a number of months, with an end date, limit and plans", () => {
    const d = parseDiscount(
      {
        ...base,
        kind: "amount",
        amount: "£9.50",
        duration: "repeating",
        months: "3",
        expires: "2026-12-31",
        maxRedemptions: "50",
        planKeys: ["GROWTH", "GROWTH", "AGENCY"],
      },
      now,
    );
    expect(d).toMatchObject({
      percentOff: null,
      amountOffMinor: 950,
      duration: "repeating",
      durationMonths: 3,
      maxRedemptions: 50,
      planKeys: ["GROWTH", "AGENCY"],
    });
    expect(d.expiresAt?.toISOString()).toBe("2026-12-31T23:59:00.000Z");
  });

  it("refuses what Stripe would refuse, in plain words", () => {
    const bad: [Partial<DiscountInput>, RegExp][] = [
      [{ code: "" }, /Type a code/],
      [{ code: "LAUNCH 20" }, /letters and numbers/],
      [{ code: "AB" }, /3 to 30/],
      [{ percent: "0" }, /between 1 and 100/],
      [{ percent: "120" }, /between 1 and 100/],
      [{ percent: "12.345" }, /two decimal places/],
      [{ kind: "amount", amount: "" }, /how much comes off/],
      [{ kind: "amount", amount: "1.005" }, /penny/],
      [{ duration: "repeating", months: "" }, /how many months/],
      [{ duration: "repeating", months: "40" }, /1 to 36/],
      [{ expires: "2026-10-01" }, /future/],
      [{ maxRedemptions: "0" }, /1 or more/],
    ];
    for (const [change, message] of bad) {
      expect(() => parseDiscount({ ...base, ...change }, now)).toThrow(DiscountError);
      expect(() => parseDiscount({ ...base, ...change }, now)).toThrow(message);
    }
  });
});

describe("what's sent to Stripe", () => {
  it("makes a percent coupon for every plan", () => {
    const d = parseDiscount({ ...base, duration: "forever" }, now);
    expect(couponParams(d, [])).toEqual({ name: "LAUNCH20", duration: "forever", percent_off: 20, metadata: { gigsaw_code: "LAUNCH20" } });
  });

  it("makes an amount coupon for some months, limited to some plans' products", () => {
    const d = parseDiscount({ ...base, kind: "amount", amount: "10", duration: "repeating", months: "6", planKeys: ["GROWTH"] }, now);
    const params = couponParams(d, ["gigsaw_growth"]);
    expect(params).toEqual({
      name: "LAUNCH20",
      duration: "repeating",
      duration_in_months: 6,
      amount_off: 1000,
      currency: "gbp",
      applies_to: { products: ["gigsaw_growth"] },
      metadata: { gigsaw_code: "LAUNCH20" },
    });
    expect(decodeURIComponent(encodeForm(params))).toContain("applies_to[products][0]=gigsaw_growth");
  });

  it("puts the expiry and limit on the promotion code", () => {
    const d = parseDiscount({ ...base, expires: "2026-12-31", maxRedemptions: "25" }, now);
    expect(promotionCodeParams(d, "co_123")).toEqual({
      coupon: "co_123",
      code: "LAUNCH20",
      expires_at: Math.floor(Date.UTC(2026, 11, 31, 23, 59) / 1000),
      max_redemptions: 25,
    });
    expect(promotionCodeParams(parseDiscount(base, now), "co_1")).toEqual({ coupon: "co_1", code: "LAUNCH20" });
  });
});

describe("discount maths and wording", () => {
  it("takes money off, never below nothing", () => {
    expect(discountedMinor(9900, { percentOff: 20, amountOffMinor: null })).toBe(7920);
    expect(discountedMinor(4900, { percentOff: 12.5, amountOffMinor: null })).toBe(4288);
    expect(discountedMinor(4900, { percentOff: null, amountOffMinor: 1000 })).toBe(3900);
    expect(discountedMinor(500, { percentOff: null, amountOffMinor: 1000 })).toBe(0);
    expect(discountedMinor(4900, { percentOff: 100, amountOffMinor: null })).toBe(0);
  });

  it("says what a discount is in plain words", () => {
    const d = { percentOff: 20, amountOffMinor: null, currency: "GBP", durationMonths: null };
    expect(describeDiscount({ ...d, duration: "once" })).toBe("20% off the first payment");
    expect(describeDiscount({ ...d, percentOff: 12.5, duration: "forever" })).toBe("12.5% off for as long as they're subscribed");
    expect(describeDiscount({ ...d, percentOff: null, amountOffMinor: 1000, duration: "repeating", durationMonths: 3 })).toBe("£10.00 off for 3 months");
    expect(describeDiscount({ ...d, duration: "repeating", durationMonths: 1 })).toBe("20% off for 1 month");
  });

  it("reads a Stripe coupon back", () => {
    expect(describeDiscount(fromStripeCoupon({ percent_off: 15, duration: "repeating", duration_in_months: 2 }))).toBe("15% off for 2 months");
    expect(describeDiscount(fromStripeCoupon({ amount_off: 500, currency: "gbp", duration: "once" }))).toBe("£5.00 off the first payment");
  });

  it("says where a code stands", () => {
    const c = { active: true, expiresAt: null, maxRedemptions: null };
    expect(codeStatus(c, 3, true, now)).toEqual({ label: "On", tone: "green" });
    expect(codeStatus({ ...c, active: false }, 0, true, now).label).toBe("Switched off");
    expect(codeStatus(c, 0, false, now).label).toBe("Switched off");
    expect(codeStatus({ ...c, expiresAt: new Date("2026-10-01") }, 0, true, now).label).toBe("Expired");
    expect(codeStatus({ ...c, maxRedemptions: 3 }, 3, true, now).label).toBe("Used up");
  });
});
