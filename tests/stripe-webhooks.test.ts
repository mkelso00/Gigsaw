import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { idempotencyKey, stripe } = await import("@/lib/stripe");
const { shouldApplySubscription, stripeStatusEnded } = await import("@/lib/subscription");

describe("which subscription a business's billing follows", () => {
  const rule = (storedId: string | null, storedEnded: boolean, incomingId: string, incomingEnded: boolean) =>
    shouldApplySubscription({ storedId, storedEnded, incomingId, incomingEnded });

  it("always follows the business's own subscription, whatever it says", () => {
    expect(rule("sub_new", false, "sub_new", false)).toBe(true);
    expect(rule("sub_new", false, "sub_new", true)).toBe(true); // it really was cancelled
  });

  it("takes the first subscription a business has", () => {
    expect(rule(null, true, "sub_1", false)).toBe(true);
  });

  it("ignores a late cancellation of an old subscription while the new one is live", () => {
    expect(rule("sub_new", false, "sub_old", true)).toBe(false);
  });

  it("ignores a second live subscription (another Checkout tab) while the first is live", () => {
    expect(rule("sub_first", false, "sub_second", false)).toBe(false);
  });

  it("moves to a new live subscription once the stored one has ended or gone", () => {
    expect(rule("sub_old", true, "sub_new", false)).toBe(true);
  });

  it("never swaps one ended subscription for another", () => {
    expect(rule("sub_old", true, "sub_older", true)).toBe(false);
  });

  it("treats cancelled and never-started subscriptions as ended, and the rest as live", () => {
    expect(stripeStatusEnded("canceled")).toBe(true);
    expect(stripeStatusEnded("incomplete_expired")).toBe(true);
    for (const s of ["active", "trialing", "past_due", "unpaid", "incomplete"]) expect(stripeStatusEnded(s)).toBe(false);
  });

  it("ends on the right subscription however the events are ordered", () => {
    // What Stripe says now: the old subscription was cancelled and the business re-subscribed.
    const stripeNow: Record<string, string> = { sub_old: "canceled", sub_new: "active" };
    const orders = [
      ["sub_old", "sub_new", "sub_old"],
      ["sub_new", "sub_old", "sub_old"],
      ["sub_new", "sub_new", "sub_old"],
      ["sub_old", "sub_old", "sub_new", "sub_old"],
    ];
    for (const events of orders) {
      let stored: { id: string | null; status: string } = { id: "sub_old", status: "active" };
      for (const id of events) {
        // Each event re-reads both subscriptions from Stripe, like applySubscription.
        const storedEnded = !stored.id || stripeStatusEnded(stripeNow[stored.id]);
        if (stored.id === id || rule(stored.id, storedEnded, id, stripeStatusEnded(stripeNow[id]))) stored = { id, status: stripeNow[id] };
      }
      expect(stored, events.join(" > ")).toEqual({ id: "sub_new", status: "active" });
    }
  });
});

describe("idempotency keys", () => {
  const params = { mode: "subscription", customer: "cus_1", line_items: [{ price: "p_growth", quantity: 1 }] };
  const now = Date.parse("2026-11-04T10:15:00Z");

  it("gives a repeat of the same request the same key", () => {
    const a = idempotencyKey(["checkout", "ag_1", "GROWTH", "month"], params, now);
    expect(a).toBe(idempotencyKey(["checkout", "ag_1", "GROWTH", "month"], { ...params }, now + 30 * 60_000));
    expect(a).toMatch(/^gigsaw-checkout-ag_1-GROWTH-month-\d+-[0-9a-f]{16}$/);
    expect(a.length).toBeLessThanOrEqual(255);
  });

  it("gives a different business, plan, interval or set of parameters its own key", () => {
    const a = idempotencyKey(["checkout", "ag_1", "GROWTH", "month"], params, now);
    expect(idempotencyKey(["checkout", "ag_2", "GROWTH", "month"], params, now)).not.toBe(a);
    expect(idempotencyKey(["checkout", "ag_1", "STARTER", "month"], params, now)).not.toBe(a);
    expect(idempotencyKey(["checkout", "ag_1", "GROWTH", "year"], params, now)).not.toBe(a);
    // e.g. a user was added since, so there's an extra-user line: Stripe would refuse the old key.
    expect(
      idempotencyKey(["checkout", "ag_1", "GROWTH", "month"], { ...params, line_items: [...params.line_items, { price: "p_extra", quantity: 1 }] }, now),
    ).not.toBe(a);
  });

  it("starts a new key after the hour, so a repeat much later can't get an expired Checkout page back", () => {
    const a = idempotencyKey(["checkout", "ag_1", "GROWTH", "month"], params, now);
    expect(idempotencyKey(["checkout", "ag_1", "GROWTH", "month"], params, now + 60 * 60_000)).not.toBe(a);
  });

  it("sends the key to Stripe on POSTs only", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const calls: Record<string, string>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(init.headers as Record<string, string>);
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    });
    await stripe("POST", "checkout/sessions", params, { idempotencyKey: "key_1" });
    await stripe("GET", "subscriptions/sub_1", {}, { idempotencyKey: "key_2" });
    await stripe("POST", "customers", {});
    expect(calls[0]["Idempotency-Key"]).toBe("key_1");
    expect(calls[1]["Idempotency-Key"]).toBeUndefined();
    expect(calls[2]["Idempotency-Key"]).toBeUndefined();
    vi.unstubAllGlobals();
    delete process.env.STRIPE_SECRET_KEY;
  });
});
