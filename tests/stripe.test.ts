import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { encodeForm, parseLookupKey, priceLookupKey, stripe, verifyWebhook } = await import("@/lib/stripe");
const { billingState, fromStripeStatus } = await import("@/lib/subscription");

describe("Stripe helpers", () => {
  it("form-encodes nested params the way Stripe expects", () => {
    expect(decodeURIComponent(encodeForm({ mode: "subscription", line_items: [{ price: "p_1", quantity: 2 }], meta: { a: "b" }, skip: undefined }))).toBe(
      "mode=subscription&line_items[0][price]=p_1&line_items[0][quantity]=2&meta[a]=b",
    );
  });

  it("checks webhook signatures and refuses old or forged ones", () => {
    const secret = "whsec_test";
    const body = '{"type":"x"}';
    const t = 1_800_000_000;
    const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(verifyWebhook(body, `t=${t},v1=${sig}`, secret, t * 1000)).toBe(true);
    expect(verifyWebhook(body, `t=${t},v1=${sig}`, "wrong", t * 1000)).toBe(false);
    expect(verifyWebhook(body + " ", `t=${t},v1=${sig}`, secret, t * 1000)).toBe(false);
    expect(verifyWebhook(body, `t=${t},v1=${sig}`, secret, (t + 3600) * 1000)).toBe(false);
    expect(verifyWebhook(body, null, secret)).toBe(false);
  });

  it("names prices so they can be found again, and reads them back", () => {
    const key = priceLookupKey("GROWTH", "year");
    expect(key).toMatch(/^gigsaw_growth_year_\d+$/);
    expect(parseLookupKey(key)).toEqual({ kind: "GROWTH", interval: "year" });
    expect(parseLookupKey(priceLookupKey("EXTRA_USER", "month"))).toEqual({ kind: "EXTRA_USER", interval: "month" });
    expect(parseLookupKey("something_else")).toBeNull();
  });
});

describe("subscription state", () => {
  const base = {
    billingMode: "STRIPE",
    plan: "GROWTH",
    billingInterval: "month",
    subscriptionStatus: "NONE",
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
  };
  const now = new Date("2026-11-01T12:00:00Z");
  it("is open during the trial and locked after it, unless subscribed", () => {
    expect(billingState({ ...base, trialEndsAt: new Date("2026-11-10T12:00:00Z") }, now)).toMatchObject({ locked: false, trialDaysLeft: 9 });
    expect(billingState({ ...base, trialEndsAt: new Date("2026-10-30T12:00:00Z") }, now)).toMatchObject({ locked: true, label: "Trial ended" });
    expect(billingState({ ...base, trialEndsAt: null, subscriptionStatus: "ACTIVE", stripeSubscriptionId: "sub_1" }, now)).toMatchObject({
      locked: false,
      subscribed: true,
    });
    expect(billingState({ ...base, trialEndsAt: null, subscriptionStatus: "PAST_DUE", stripeSubscriptionId: "sub_1" }, now).locked).toBe(false);
    expect(billingState({ ...base, trialEndsAt: null, subscriptionStatus: "CANCELED", stripeSubscriptionId: "sub_1" }, now).locked).toBe(true);
  });
  it("never locks businesses billed by invoice", () => {
    expect(billingState({ ...base, billingMode: "INVOICE", trialEndsAt: null }, now).locked).toBe(false);
  });
  it("maps Stripe's statuses", () => {
    expect(fromStripeStatus("trialing")).toBe("TRIALING");
    expect(fromStripeStatus("unpaid")).toBe("PAST_DUE");
    expect(fromStripeStatus("incomplete_expired")).toBe("CANCELED");
  });
});

describe("calls on an agency's own Stripe account", () => {
  it("adds the Stripe-Account header only when asked", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const calls: Record<string, string>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(init.headers as Record<string, string>);
      return new Response(JSON.stringify({ id: "cs_1" }), { status: 200 });
    });
    await stripe("POST", "checkout/sessions", { mode: "payment" }, { account: "acct_123" });
    await stripe("GET", "accounts/acct_123");
    expect(calls[0]["Stripe-Account"]).toBe("acct_123");
    expect(calls[1]["Stripe-Account"]).toBeUndefined();
    vi.unstubAllGlobals();
    delete process.env.STRIPE_SECRET_KEY;
  });
});
