import { describe, expect, it } from "vitest";
import { allocate, amountDue, applicationFeeMinor, checkoutParams, gigOwed, receivedOnInvoice, type PayGig } from "@/lib/pay-links";

const gig = (id: string, o: Partial<PayGig> = {}): PayGig => ({
  id,
  dealType: "BUY_SELL",
  feeMinor: 50000,
  artistFeeMinor: 40000,
  commissionPct: 15,
  vatPct: 20,
  bookingFeeMinor: 5000,
  depositMinor: 10000,
  payments: [],
  ...o,
});

describe("what a pay link asks for", () => {
  it("asks for the total the client sees on the invoice, VAT and booking fee included", () => {
    // £500 + £50 booking fee + 20% VAT = £660
    expect(gigOwed(gig("a"))).toEqual({ total: 66000, deposit: 10000 });
    expect(amountDue("BALANCE", [gig("a")])).toBe(66000);
    expect(amountDue("DEPOSIT", [gig("a")])).toBe(10000);
  });

  it("takes off what's been paid, and never what the act is paid", () => {
    const g = gig("a", {
      payments: [
        { direction: "IN", kind: "DEPOSIT", amountMinor: 4000 },
        { direction: "OUT", kind: "SETTLEMENT", amountMinor: 40000 },
      ],
    });
    expect(amountDue("DEPOSIT", [g])).toBe(6000);
    expect(amountDue("BALANCE", [g])).toBe(62000);
  });

  it("asks for nothing once paid, and no deposit when none is set", () => {
    expect(amountDue("BALANCE", [gig("a", { payments: [{ direction: "IN", kind: "BALANCE", amountMinor: 70000 }] })])).toBe(0);
    expect(amountDue("DEPOSIT", [gig("a", { depositMinor: 0 })])).toBe(0);
    // A deposit can't ask for more than is still owed.
    expect(amountDue("DEPOSIT", [gig("a", { payments: [{ direction: "IN", kind: "BALANCE", amountMinor: 60000 }] })])).toBe(6000);
  });

  it("adds up an event's gigs", () => {
    expect(amountDue("DEPOSIT", [gig("a"), gig("b", { depositMinor: 20000 })])).toBe(30000);
    expect(amountDue("BALANCE", [gig("a"), gig("b")])).toBe(132000);
  });
});

describe("sharing a card payment across gigs", () => {
  it("logs a deposit as a deposit", () => {
    expect(allocate("DEPOSIT", 10000, [gig("a")])).toEqual([{ bookingId: "a", kind: "DEPOSIT", amountMinor: 10000 }]);
  });

  it("marks the deposit paid when the whole balance is paid in one go", () => {
    expect(allocate("BALANCE", 66000, [gig("a")])).toEqual([
      { bookingId: "a", kind: "DEPOSIT", amountMinor: 10000 },
      { bookingId: "a", kind: "BALANCE", amountMinor: 56000 },
    ]);
  });

  it("fills each gig's deposit, then the rest soonest first", () => {
    const gigs = [gig("a"), gig("b", { depositMinor: 20000 })];
    expect(allocate("DEPOSIT", 30000, gigs)).toEqual([
      { bookingId: "a", kind: "DEPOSIT", amountMinor: 10000 },
      { bookingId: "b", kind: "DEPOSIT", amountMinor: 20000 },
    ]);
    expect(allocate("BALANCE", 100000, gigs)).toEqual([
      { bookingId: "a", kind: "DEPOSIT", amountMinor: 10000 },
      { bookingId: "b", kind: "DEPOSIT", amountMinor: 20000 },
      { bookingId: "a", kind: "BALANCE", amountMinor: 56000 },
      { bookingId: "b", kind: "BALANCE", amountMinor: 14000 },
    ]);
  });

  it("puts anything over what's owed on the last gig, and never loses money", () => {
    const parts = allocate("BALANCE", 70000, [gig("a"), gig("b", { payments: [{ direction: "IN", kind: "BALANCE", amountMinor: 66000 }] })]);
    expect(parts.reduce((s, p) => s + p.amountMinor, 0)).toBe(70000);
    expect(parts.at(-1)).toEqual({ bookingId: "b", kind: "BALANCE", amountMinor: 4000 });
    expect(allocate("BALANCE", 500, [])).toEqual([]);
    expect(allocate("BALANCE", 0, [gig("a")])).toEqual([]);
  });
});

describe("Stripe Checkout for a pay link", () => {
  const base = {
    amountMinor: 10000,
    currency: "GBP",
    description: "Deposit: Ellie Rose at The Crown",
    linkId: "link_1",
    kind: "DEPOSIT" as const,
    agencyId: "ag_1",
    email: "venue@example.com",
    successUrl: "https://x/pay/t?paid=1",
    cancelUrl: "https://x/pay/t",
  };

  it("charges the amount due in the gig's currency and labels the session so the webhook can find the link", () => {
    const p = checkoutParams(base);
    expect(p.mode).toBe("payment");
    expect(p.line_items[0].price_data).toMatchObject({ currency: "gbp", unit_amount: 10000 });
    expect(p.metadata).toEqual({ gigsaw_link: "link_1", gigsaw_kind: "DEPOSIT", gigsaw_agency: "ag_1" });
    expect(p.client_reference_id).toBe("link_1");
  });

  it("takes no application fee for now", () => {
    expect(applicationFeeMinor(10000, "GBP")).toBe(0);
    expect("application_fee_amount" in checkoutParams(base).payment_intent_data).toBe(false);
  });
});

describe("card payments on an invoice", () => {
  it("shows each card payment once, even when it was shared across an event's gigs", () => {
    const d1 = new Date("2026-11-01T10:00:00Z");
    const d2 = new Date("2026-11-05T10:00:00Z");
    const r = receivedOnInvoice([
      { direction: "IN", amountMinor: 3000, paidAt: d2, cardPaymentId: "c2" },
      { direction: "IN", amountMinor: 10000, paidAt: d1, cardPaymentId: "c1" },
      { direction: "IN", amountMinor: 5000, paidAt: d1, cardPaymentId: "c1" },
      { direction: "IN", amountMinor: 2000, paidAt: d1, cardPaymentId: null },
      { direction: "OUT", amountMinor: 9999, paidAt: d1, cardPaymentId: null },
    ]);
    expect(r).toEqual({
      card: [
        { paidAt: d1, amountMinor: 15000 },
        { paidAt: d2, amountMinor: 3000 },
      ],
      otherMinor: 2000,
    });
  });
});
