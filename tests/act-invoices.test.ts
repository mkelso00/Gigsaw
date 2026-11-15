import { describe, expect, it } from "vitest";
import {
  actSnapshot,
  detailsMissing,
  formatSortCode,
  gigFinished,
  invoiceAmounts,
  invoiceChange,
  invoiceNumber,
  issueDecision,
  maskAccount,
  owedOnInvoice,
  type ActDetails,
  type InvoiceableBooking,
} from "@/lib/act-invoice-rules";

// The rules for acts' self-billing invoices (src/lib/act-invoice-rules.ts). The database side,
// including making each one once, is in act-invoices-db.test.ts.

const HOUR = 3_600_000;
const now = new Date("2026-12-12T23:00:00Z");

const act = (over: Partial<ActDetails> = {}): ActDetails => ({
  name: "Ellie Rose",
  address: "1 High Street\nLeeds LS1 1AA",
  vatRegistered: false,
  vatNumber: "",
  bankAccountName: "E Rose",
  bankSortCode: "12-34-56",
  bankAccountNumber: "12345678",
  detailsCompletedAt: new Date("2026-11-01T10:00:00Z"),
  ...over,
});

const gig = (over: Partial<InvoiceableBooking> = {}): InvoiceableBooking => ({
  dealType: "BUY_SELL",
  feeMinor: 90_000,
  artistFeeMinor: 60_000,
  commissionPct: 15,
  vatPct: 20,
  bookingFeeMinor: 5_000,
  status: "CONFIRMED",
  demo: false,
  artistId: "act1",
  setStart: new Date(now.getTime() - 4 * HOUR),
  setEnd: new Date(now.getTime() - 2 * HOUR),
  checkIns: [],
  payments: [],
  artist: act(),
  ...over,
});

describe("when a gig is finished", () => {
  it("is over once the set's end time has passed", () => {
    expect(gigFinished(gig(), now)).toBe(true);
    expect(gigFinished(gig({ setEnd: new Date(now.getTime() + HOUR) }), now)).toBe(false);
  });
  it("is over three hours after the start when there's no end time", () => {
    expect(gigFinished(gig({ setStart: new Date(now.getTime() - 2 * HOUR), setEnd: null }), now)).toBe(false);
    expect(gigFinished(gig({ setStart: new Date(now.getTime() - 3 * HOUR), setEnd: null }), now)).toBe(true);
  });
  it("is over as soon as the act says they've left", () => {
    expect(gigFinished(gig({ setEnd: new Date(now.getTime() + HOUR), checkIns: [{ kind: "DEPARTED" }] }), now)).toBe(true);
  });
});

describe("whether to make an invoice", () => {
  it("makes one for the act's fee (the cost), not the sale price", () => {
    expect(issueDecision(gig(), now)).toEqual({ issue: true, netMinor: 60_000 });
    // Commission deals: what's left for the act after commission.
    expect(issueDecision(gig({ dealType: "STANDARD_COMMISSION", artistFeeMinor: null, feeMinor: 100_000, commissionPct: 15 }), now)).toEqual({
      issue: true,
      netMinor: 85_000,
    });
  });
  it("not before the gig is over", () => {
    expect(issueDecision(gig({ setEnd: new Date(now.getTime() + HOUR) }), now)).toMatchObject({ issue: false });
  });
  it("not for gigs that aren't on, demo data, no act or no fee", () => {
    for (const status of ["PENDING", "HOLD", "AWAITING", "CANCELLED", "ENQUIRY"]) expect(issueDecision(gig({ status }), now).issue).toBe(false);
    expect(issueDecision(gig({ status: "SETTLED" }), now).issue).toBe(true);
    expect(issueDecision(gig({ demo: true }), now).issue).toBe(false);
    expect(issueDecision(gig({ artistId: null, artist: null }), now).issue).toBe(false);
    expect(issueDecision(gig({ artistFeeMinor: 0 }), now).issue).toBe(false);
  });
  it("waits for the act's details, and for a VAT number from a VAT-registered act", () => {
    expect(issueDecision(gig({ artist: act({ detailsCompletedAt: null }) }), now)).toEqual({
      issue: false,
      reason: "Waiting for the act's details",
      waiting: true,
    });
    expect(issueDecision(gig({ artist: act({ vatRegistered: true }) }), now)).toMatchObject({ waiting: true, reason: "Waiting for the act's VAT number" });
  });
  it("by itself only for the last 30 days and acts not paid already; staff can make older ones", () => {
    const old = gig({ setStart: new Date(now.getTime() - 40 * 24 * HOUR), setEnd: new Date(now.getTime() - 40 * 24 * HOUR + HOUR) });
    expect(issueDecision(old, now).issue).toBe(false);
    expect(issueDecision(old, now, true).issue).toBe(true);
    const paid = gig({ payments: [{ direction: "OUT", amountMinor: 60_000 }] });
    expect(issueDecision(paid, now)).toMatchObject({ issue: false, reason: "The act has been paid already" });
    // Money in from the venue doesn't count as paying the act.
    expect(issueDecision(gig({ payments: [{ direction: "IN", amountMinor: 999_999 }] }), now).issue).toBe(true);
  });
});

describe("amounts and numbers", () => {
  it("adds VAT at 20% only for a VAT-registered act", () => {
    expect(invoiceAmounts(60_000, "")).toEqual({ netMinor: 60_000, vatPct: 0, vatMinor: 0, totalMinor: 60_000 });
    expect(invoiceAmounts(60_050, "GB123456789")).toEqual({ netMinor: 60_050, vatPct: 20, vatMinor: 12_010, totalMinor: 72_060 });
  });
  it("only carries the VAT number when the act is registered", () => {
    expect(actSnapshot(act({ vatNumber: "GB1" })).actVatNumber).toBe("");
    expect(actSnapshot(act({ vatRegistered: true, vatNumber: " GB1 " })).actVatNumber).toBe("GB1");
    expect(detailsMissing(act())).toBeNull();
  });
  it("numbers SB-0001 and up", () => {
    expect(invoiceNumber(1)).toBe("SB-0001");
    expect(invoiceNumber(12345)).toBe("SB-12345");
  });
  it("masks account numbers and tidies sort codes", () => {
    expect(maskAccount("12 34 56 78")).toBe("••••5678");
    expect(maskAccount("")).toBe("");
    expect(formatSortCode("123456")).toBe("12-34-56");
  });
  it("owes the total less what's been paid out to the act", () => {
    expect(
      owedOnInvoice({ status: "ISSUED", totalMinor: 72_000 }, [
        { direction: "OUT", amountMinor: 10_000 },
        { direction: "IN", amountMinor: 5 },
      ]),
    ).toBe(62_000);
    expect(owedOnInvoice({ status: "PAID", totalMinor: 72_000 }, [])).toBe(0);
    expect(owedOnInvoice({ status: "VOID", totalMinor: 72_000 }, [])).toBe(0);
  });
});

describe("changes after an invoice is issued", () => {
  const inv = { artistId: "act1", currency: "GBP", netMinor: 60_000, vatMinor: 0, ...actSnapshot(act()) };
  const b = (over: Partial<InvoiceableBooking> & { currency?: string } = {}) => ({ currency: "GBP", ...gig(), ...over });
  it("leaves it alone when nothing that's on it has changed", () => {
    expect(invoiceChange(inv, b())).toBeNull();
    // The sale price isn't on it.
    expect(invoiceChange(inv, b({ feeMinor: 120_000 }))).toBeNull();
  });
  it("replaces it when the fee or the act's details change", () => {
    expect(invoiceChange(inv, b({ artistFeeMinor: 65_000 }))).toEqual({ keep: true, reason: "The fee changed" });
    expect(invoiceChange(inv, b({ artist: act({ bankAccountNumber: "87654321" }) }))?.reason).toBe("The act's bank details changed");
    expect(invoiceChange(inv, b({ artist: act({ vatRegistered: true, vatNumber: "GB9" }) }))?.reason).toBe("The act's VAT registration changed");
    expect(invoiceChange(inv, b({ artist: act({ address: "2 Low Road" }) }))?.reason).toBe("The act's name or address changed");
  });
  it("voids it when the gig no longer needs one", () => {
    expect(invoiceChange(inv, b({ status: "CANCELLED" }))).toEqual({ keep: false, reason: "The gig was cancelled" });
    expect(invoiceChange(inv, b({ artistId: "act2" }))?.keep).toBe(false);
    expect(invoiceChange(inv, null)?.keep).toBe(false);
  });
  it("waits while the act is part way through changing their details", () => {
    expect(invoiceChange(inv, b({ artist: act({ detailsCompletedAt: null, bankAccountNumber: "1" }) }))).toBeNull();
  });
});
