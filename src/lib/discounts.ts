// Discount codes: the rules for making one, what it's sent to Stripe as (a coupon, which says how
// much comes off and for how long, and a promotion code, the word customers type), and how it reads.
// Pure functions, so they can be tested without Stripe.

import { formatMoney } from "./money";

export type Duration = "once" | "forever" | "repeating";

export type DiscountSpec = {
  code: string;
  /** Exactly one of these. Percent can have up to two decimal places. */
  percentOff: number | null;
  amountOffMinor: number | null;
  currency: string;
  duration: Duration;
  /** For "repeating": how many months. */
  durationMonths: number | null;
  expiresAt: Date | null;
  maxRedemptions: number | null;
  /** Empty means every plan. */
  planKeys: string[];
};

export class DiscountError extends Error {}

export type DiscountInput = {
  code: string;
  kind: string; // "percent" | "amount"
  percent: string;
  amount: string; // pounds, e.g. "10" or "9.50"
  duration: string;
  months: string;
  expires: string; // YYYY-MM-DD, or ""
  maxRedemptions: string;
  planKeys: string[];
};

/** Check what the owner typed and turn it into a discount. Throws a DiscountError with a plain message. */
export function parseDiscount(input: DiscountInput, now = new Date()): DiscountSpec {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new DiscountError("Type a code, like LAUNCH20");
  if (!/^[A-Z0-9]{3,30}$/.test(code)) throw new DiscountError("Codes are 3 to 30 letters and numbers, with no spaces or symbols");

  let percentOff: number | null = null;
  let amountOffMinor: number | null = null;
  if (input.kind === "amount") {
    const pounds = Number(input.amount.replace(/[£,\s]/g, ""));
    if (!input.amount.trim() || !Number.isFinite(pounds) || pounds <= 0) throw new DiscountError("Enter how much comes off, like 10 or 9.50");
    amountOffMinor = Math.round(pounds * 100);
    if (Math.abs(pounds * 100 - amountOffMinor) > 1e-6) throw new DiscountError("Amounts can only go down to the penny");
  } else {
    const pct = Number(input.percent.replace(/%/g, "").trim());
    if (!input.percent.trim() || !Number.isFinite(pct) || pct <= 0 || pct > 100) throw new DiscountError("Enter a percentage between 1 and 100");
    if (Math.round(pct * 100) !== pct * 100) throw new DiscountError("Percentages can have up to two decimal places");
    percentOff = pct;
  }

  const duration: Duration = input.duration === "forever" ? "forever" : input.duration === "repeating" ? "repeating" : "once";
  let durationMonths: number | null = null;
  if (duration === "repeating") {
    const n = Number(input.months);
    if (!Number.isInteger(n) || n < 1 || n > 36) throw new DiscountError("Enter how many months the discount lasts, from 1 to 36");
    durationMonths = n;
  }

  let expiresAt: Date | null = null;
  if (input.expires.trim()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expires.trim())) throw new DiscountError("Choose the last day the code can be used");
    // Usable until the end of that day, UK time near enough.
    expiresAt = new Date(`${input.expires.trim()}T23:59:00Z`);
    if (Number.isNaN(expiresAt.getTime())) throw new DiscountError("Choose the last day the code can be used");
    if (expiresAt.getTime() <= now.getTime()) throw new DiscountError("The last day has to be in the future");
  }

  let maxRedemptions: number | null = null;
  if (input.maxRedemptions.trim()) {
    const n = Number(input.maxRedemptions);
    if (!Number.isInteger(n) || n < 1) throw new DiscountError("The most times it can be used has to be a whole number, 1 or more");
    maxRedemptions = n;
  }

  return { code, percentOff, amountOffMinor, currency: "GBP", duration, durationMonths, expiresAt, maxRedemptions, planKeys: [...new Set(input.planKeys)] };
}

/** The Stripe coupon: how much comes off, and for how long. `productIds` limits it to those plans' products. */
export function couponParams(d: DiscountSpec, productIds: string[]) {
  return {
    name: d.code,
    duration: d.duration,
    ...(d.duration === "repeating" ? { duration_in_months: d.durationMonths } : {}),
    ...(d.percentOff !== null ? { percent_off: d.percentOff } : { amount_off: d.amountOffMinor, currency: d.currency.toLowerCase() }),
    ...(productIds.length ? { applies_to: { products: productIds } } : {}),
    metadata: { gigsaw_code: d.code },
  };
}

/** The Stripe promotion code customers type, with its expiry and how many times it can be used. */
export function promotionCodeParams(d: DiscountSpec, couponId: string) {
  return {
    coupon: couponId,
    code: d.code,
    ...(d.expiresAt ? { expires_at: Math.floor(d.expiresAt.getTime() / 1000) } : {}),
    ...(d.maxRedemptions ? { max_redemptions: d.maxRedemptions } : {}),
  };
}

type Describable = Pick<DiscountSpec, "percentOff" | "amountOffMinor" | "currency" | "durationMonths"> & { duration: string };

/** "20% off for 3 months", "£10 off the first payment", "15% off for as long as they're subscribed". */
export function describeDiscount(d: Describable) {
  const off = d.percentOff !== null ? `${trimNumber(d.percentOff)}% off` : `${formatMoney(d.amountOffMinor ?? 0, d.currency)} off`;
  if (d.duration === "forever") return `${off} for as long as they're subscribed`;
  if (d.duration === "repeating") return `${off} for ${d.durationMonths} month${d.durationMonths === 1 ? "" : "s"}`;
  return `${off} the first payment`;
}

/** What a price comes to with the discount, never below nothing. */
export function discountedMinor(priceMinor: number, d: Pick<DiscountSpec, "percentOff" | "amountOffMinor">) {
  if (d.percentOff !== null) return Math.max(0, Math.round(priceMinor * (1 - d.percentOff / 100)));
  return Math.max(0, priceMinor - (d.amountOffMinor ?? 0));
}

/** A coupon from Stripe in the same shape, to describe a discount that's on a subscription. */
export function fromStripeCoupon(c: {
  percent_off?: number | null;
  amount_off?: number | null;
  currency?: string | null;
  duration: string;
  duration_in_months?: number | null;
}): Describable {
  return {
    percentOff: c.percent_off ?? null,
    amountOffMinor: c.percent_off ? null : (c.amount_off ?? 0),
    currency: (c.currency ?? "gbp").toUpperCase(),
    duration: c.duration === "forever" ? "forever" : c.duration === "repeating" ? "repeating" : "once",
    durationMonths: c.duration_in_months ?? null,
  };
}

/** Where a code stands, from what Stripe says. */
export function codeStatus(
  d: { active: boolean; expiresAt: Date | null; maxRedemptions: number | null },
  timesRedeemed: number,
  stripeActive: boolean | null,
  now = new Date(),
): { label: string; tone: "green" | "grey" | "amber" } {
  if (!d.active || stripeActive === false) return { label: "Switched off", tone: "grey" };
  if (d.expiresAt && d.expiresAt.getTime() <= now.getTime()) return { label: "Expired", tone: "grey" };
  if (d.maxRedemptions && timesRedeemed >= d.maxRedemptions) return { label: "Used up", tone: "amber" };
  return { label: "On", tone: "green" };
}

const trimNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
