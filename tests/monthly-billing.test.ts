import { describe, expect, it } from "vitest";
import {
  billKey,
  billName,
  billStep,
  billWarnings,
  billingReminderDue,
  groupBills,
  parseBillKey,
  readMonth,
  summarise,
  summaryLine,
  usualPayerOf,
  type BillGig,
  type BillSteps,
  type Payer,
} from "@/lib/monthly-billing";

const rekom: Payer = { id: "rekom", name: "Accounts", company: "Rekom", email: "ap@rekom.test", billing: "COMBINED" };
const levy: Payer = { id: "levy", name: "Levy UK", company: "", email: "", billing: "PER_VENUE" };
const venue = (id: string, name = id) => ({ id, name, timezone: "Europe/London" });

let n = 0;
function gig(over: Partial<BillGig> & { venue: BillGig["venue"] }): BillGig {
  n++;
  return {
    id: `g${n}`,
    reference: `GS-${n}`,
    status: "CONFIRMED",
    arriveBy: new Date(`2026-10-${String(n % 28 || 1).padStart(2, "0")}T18:00:00Z`),
    setStart: new Date(`2026-10-${String(n % 28 || 1).padStart(2, "0")}T19:00:00Z`),
    setEnd: null,
    timezone: "Europe/London",
    currency: "GBP",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    dealType: "BUY_SELL",
    feeMinor: 30000,
    artistFeeMinor: 20000,
    commissionPct: 15,
    vatPct: 20,
    bookingFeeMinor: 0,
    promoter: null,
    artist: { name: "The Act" },
    ...over,
  };
}

const steps = (over: Partial<BillSteps> = {}): BillSteps => ({
  poRequestedAt: null,
  poNumber: "",
  poReceivedAt: null,
  invoicedAt: null,
  invoicedTotalMinor: null,
  paidAt: null,
  nothingToBill: false,
  ...over,
});

describe("grouping a month's gigs into bills", () => {
  it("puts a COMBINED company's venues on one bill", () => {
    const gigs = [
      gig({ venue: venue("a", "Pryzm"), promoter: rekom }),
      gig({ venue: venue("b", "Atik"), promoter: rekom }),
      gig({ venue: venue("a", "Pryzm"), promoter: rekom }),
    ];
    const bills = groupBills(gigs, new Map());
    expect(bills).toHaveLength(1);
    const b = bills[0];
    expect(b).toMatchObject({ key: "c:rekom", contactId: "rekom", venueId: null });
    expect(b.venues.map((v) => v.name)).toEqual(["Atik", "Pryzm"]);
    // £300 a gig plus 20% VAT, three times. Never the act's fee.
    expect(b.totals).toEqual({ gigs: 3, exVat: 90000, vat: 18000, total: 108000 });
    expect(billName(b)).toBe("Rekom: 2 venues");
  });

  it("gives a PER_VENUE company one bill for each venue", () => {
    const gigs = [gig({ venue: venue("a", "Stadium bar"), promoter: levy }), gig({ venue: venue("b", "Arena bar"), promoter: levy })];
    const bills = groupBills(gigs, new Map());
    expect(bills.map((b) => b.key).sort()).toEqual(["cv:levy:a", "cv:levy:b"]);
    expect(bills.every((b) => b.contactId === "levy" && b.venueId)).toBe(true);
    expect(billName(bills.find((b) => b.key === "cv:levy:a")!)).toBe("Levy UK: Stadium bar");
  });

  it("bills the venue itself when nobody pays for the gig", () => {
    const bills = groupBills([gig({ venue: venue("crown", "The Crown") })], new Map());
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({ key: "v:crown", contactId: null, venueId: "crown", payer: null });
    expect(billName(bills[0])).toBe("The Crown");
  });

  it("uses the venue's usual payer when the gig has no promoter, and the gig's own promoter first", () => {
    const usual = new Map([["a", rekom]]);
    const other: Payer = { ...rekom, id: "other", company: "Other Ltd" };
    const bills = groupBills([gig({ venue: venue("a") }), gig({ venue: venue("a"), promoter: other })], usual);
    expect(bills.map((b) => b.key).sort()).toEqual(["c:other", "c:rekom"]);
  });

  it("finds the usual payer from the venue's slots, active ones first", () => {
    expect(usualPayerOf([])).toBeNull();
    expect(
      usualPayerOf([
        { promoter: levy, active: false },
        { promoter: levy, active: false },
        { promoter: rekom, active: true },
        { promoter: null, active: true },
      ]),
    ).toBe(rekom);
  });

  it("counts gigs that aren't confirmed yet", () => {
    const bills = groupBills(
      [gig({ venue: venue("a"), status: "HOLD" }), gig({ venue: venue("a"), status: "AWAITING" }), gig({ venue: venue("a"), status: "SETTLED" })],
      new Map(),
    );
    expect(bills[0].unconfirmed).toHaveLength(2);
  });

  it("keys round trip", () => {
    expect(parseBillKey(billKey(rekom, "a"))).toEqual({ contactId: "rekom", venueId: null });
    expect(parseBillKey(billKey(levy, "a"))).toEqual({ contactId: "levy", venueId: "a" });
    expect(parseBillKey(billKey(null, "a"))).toEqual({ contactId: null, venueId: "a" });
    expect(parseBillKey("x:1")).toBeNull();
  });
});

describe("a bill's step and warnings", () => {
  it("moves through the steps, and can be invoiced without a PO", () => {
    expect(billStep(null)).toBe("ASK_PO");
    expect(billStep(steps({ poRequestedAt: new Date() }))).toBe("WAITING_PO");
    expect(billStep(steps({ poRequestedAt: new Date(), poNumber: "PO1", poReceivedAt: new Date() }))).toBe("TO_INVOICE");
    expect(billStep(steps({ invoicedAt: new Date() }))).toBe("INVOICED");
    expect(billStep(steps({ invoicedAt: new Date(), paidAt: new Date() }))).toBe("PAID");
    expect(billStep(steps({ invoicedAt: new Date(), nothingToBill: true }))).toBe("NOTHING");
  });

  it("flags a bill whose total or gigs changed after it was invoiced", () => {
    const invoicedAt = new Date("2026-11-02T10:00:00Z");
    const g1 = gig({ venue: venue("a") });
    const g2 = gig({ venue: venue("a"), updatedAt: new Date("2026-11-03T10:00:00Z"), feeMinor: 40000 });
    const group = groupBills([g1, g2], new Map())[0];
    const w = billWarnings(group, steps({ invoicedAt, invoicedTotalMinor: 72000 }));
    expect(w.totalChanged).toEqual({ invoiced: 72000, now: 84000 });
    expect(w.changedGigs.map((g) => g.id)).toEqual([g2.id]);
    // The same total, nothing edited: no warning.
    const same = billWarnings(groupBills([g1], new Map())[0], steps({ invoicedAt, invoicedTotalMinor: 36000 }));
    expect(same.totalChanged).toBeNull();
    expect(same.changedGigs).toEqual([]);
  });

  it("lists gigs cancelled after invoicing, and a bill with no gigs left", () => {
    const invoicedAt = new Date("2026-11-02T10:00:00Z");
    const cancelled = [
      gig({ venue: venue("a"), status: "CANCELLED", updatedAt: new Date("2026-11-04T00:00:00Z") }),
      gig({ venue: venue("a"), status: "CANCELLED", updatedAt: new Date("2026-10-04T00:00:00Z") }),
    ];
    const w = billWarnings(null, steps({ invoicedAt, invoicedTotalMinor: 36000 }), cancelled);
    expect(w.cancelledSince).toHaveLength(1);
    expect(w.noGigs).toBe(true);
    expect(w.totalChanged).toEqual({ invoiced: 36000, now: 0 });
    expect(billWarnings(null, steps({ nothingToBill: true })).noGigs).toBe(false);
  });

  it("summarises the month in a line", () => {
    const s = summarise(["ASK_PO", "ASK_PO", "WAITING_PO", "TO_INVOICE", "INVOICED", "PAID", "NOTHING"]);
    expect(s).toMatchObject({ toBill: 5, askPo: 2, waitingPo: 1, toInvoice: 1, waitingPayment: 1, paid: 1, nothing: 1 });
    expect(summaryLine(s)).toBe("5 to bill · 2 POs to ask for · 1 waiting for PO · 1 to invoice · 1 waiting for payment");
    expect(summaryLine(summarise([]))).toBe("0 to bill");
  });
});

describe("months and reminders", () => {
  it("reads a month", () => {
    expect(readMonth("2026-10")).toBe("2026-10");
    expect(readMonth("2026-13")).toBeNull();
    expect(readMonth(undefined)).toBeNull();
  });

  it("sends the start-of-month note from the 1st and the reminder from the 5th, on weekdays in office hours", () => {
    expect(billingReminderDue({ day: 1, weekday: 2, time: "10:00" })).toBe("START");
    expect(billingReminderDue({ day: 1, weekday: 6, time: "10:00" })).toBeNull();
    expect(billingReminderDue({ day: 3, weekday: 1, time: "09:00" })).toBe("START");
    expect(billingReminderDue({ day: 1, weekday: 2, time: "08:59" })).toBeNull();
    expect(billingReminderDue({ day: 5, weekday: 4, time: "16:59" })).toBe("CHASE");
    expect(billingReminderDue({ day: 5, weekday: 4, time: "17:00" })).toBeNull();
    expect(billingReminderDue({ day: 12, weekday: 4, time: "12:00" })).toBeNull();
  });
});
