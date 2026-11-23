import { describe, expect, it } from "vitest";
import { dealBreakdown } from "@/lib/money";
import {
  balanceDueFor,
  balancePlan,
  balancePlans,
  chosenOption,
  defaultPayOptions,
  DEFAULT_PAY_NOTE,
  holdsUntilDeposit,
  parsePayOptions,
  payChoices,
  payNoteText,
  payProblem,
  payPromise,
  pickOption,
  PLAN_FOR,
  proposalDeposit,
} from "@/lib/proposal-pay";
import { formatMoney } from "@/lib/money";

// The business's own example: an evening band at £1,500, the band's fee £1,100, 20% VAT, no booking fee.
const band: { saleMinor: number; costMinor: number | null; vatPct: number } = { saleMinor: 150_000, costMinor: 110_000, vatPct: 20 };
const wedding = (
  o: Partial<{ lines: (typeof band & { costMinor: number | null })[]; bookingFeeMinor: number; payOptions: string[]; depositMinor: number }> = {},
) => ({
  eventType: "WEDDING",
  payOptions: ["CASH", "TRANSFER"],
  depositMinor: 0,
  bookingFeeMinor: 0,
  lines: [band],
  ...o,
});
const m = (x: number) => formatMoney(x, "GBP");

describe("how the couple pay a wedding proposal", () => {
  it("asks for the business's share plus VAT as the deposit, then the band's fee in cash with no VAT", () => {
    expect(balancePlan(wedding(), "CASH")).toMatchObject({
      depositMinor: 48_000, // £400 share + £80 VAT
      depositVatMinor: 8_000,
      balanceMinor: 110_000, // £1,100 in cash
      balanceVatMinor: 0,
      totalMinor: 158_000,
      vatMinor: 8_000,
      lineDeposits: [48_000],
      vatPct: 20,
    });
  });

  it("adds VAT to the balance paid by bank transfer, so the total is the price plus VAT on all of it", () => {
    expect(balancePlan(wedding(), "TRANSFER")).toMatchObject({
      depositMinor: 48_000,
      balanceMinor: 132_000, // £1,100 + £220 VAT
      balanceVatMinor: 22_000,
      totalMinor: 180_000,
      vatMinor: 30_000,
    });
  });

  it("puts the booking fee in the deposit, and shares the deposit across the lines", () => {
    const singer = { saleMinor: 50_000, costMinor: 35_000, vatPct: 20 };
    const q = wedding({ bookingFeeMinor: 10_000, lines: [band, singer] });
    const cash = balancePlan(q, "CASH");
    // Line 1: (£400 + £100 fee) × 1.2 = £600. Line 2: £150 × 1.2 = £180.
    expect(cash.lineDeposits).toEqual([60_000, 18_000]);
    expect(cash.depositMinor).toBe(78_000);
    expect(cash.balanceMinor).toBe(145_000);
    expect(balancePlan(q, "TRANSFER")).toMatchObject({ depositMinor: 78_000, balanceMinor: 174_000, totalMinor: 252_000 });
    expect(proposalDeposit(q)).toBe(78_000);
  });

  it("has no VAT anywhere for a business that isn't VAT registered", () => {
    const q = wedding({ lines: [{ ...band, vatPct: 0 }] });
    expect(balancePlan(q, "CASH")).toMatchObject({ depositMinor: 40_000, balanceMinor: 110_000, totalMinor: 150_000 });
    expect(balancePlan(q, "TRANSFER")).toMatchObject({ depositMinor: 40_000, balanceMinor: 110_000, totalMinor: 150_000 });
  });

  it("matches the bookings it becomes: dealBreakdown with VAT on the share for cash, on everything for transfer", () => {
    const deal = { dealType: "BUY_SELL", feeMinor: 150_000, artistFeeMinor: 110_000, commissionPct: 0, vatPct: 20 };
    expect(dealBreakdown({ ...deal, vatOnShare: true })).toMatchObject({ vatMinor: 8_000, totalDueMinor: 158_000, agencyMinor: 40_000, artistMinor: 110_000 });
    expect(dealBreakdown(deal)).toMatchObject({ vatMinor: 30_000, totalDueMinor: 180_000 });
    expect(dealBreakdown({ ...deal, vatOnShare: true, bookingFeeMinor: 5_000 })).toMatchObject({ vatMinor: 9_000, totalDueMinor: 164_000 });
  });

  it("offers both on a new wedding, nothing on other events, and checks what the editor and the couple send", () => {
    expect(defaultPayOptions("WEDDING")).toEqual(["CASH", "TRANSFER"]);
    expect(defaultPayOptions("CORPORATE")).toEqual([]);
    expect(parsePayOptions(["TRANSFER", "nonsense"], "WEDDING")).toEqual(["TRANSFER"]);
    expect(parsePayOptions([], "CORPORATE")).toEqual([]);
    expect(() => parsePayOptions([], "WEDDING")).toThrow(/at least one/);
    expect(payChoices({ eventType: "CORPORATE", payOptions: ["CASH"] })).toEqual([]);
    expect(pickOption(wedding(), "CASH")).toBe("CASH");
    expect(pickOption(wedding(), "FULL")).toBeNull();
    expect(pickOption(wedding({ payOptions: ["TRANSFER"] }), null)).toBe("TRANSFER");
    expect(chosenOption({ ...wedding(), payPlan: "TRANSFER" })).toBe("TRANSFER");
    expect(chosenOption({ ...wedding(), payPlan: null })).toBeNull();
    expect(PLAN_FOR).toEqual({ CASH: "BALANCE_CASH", TRANSFER: "FULL" });
    expect(balancePlans(wedding()).map((p) => p.option)).toEqual(["CASH", "TRANSFER"]);
  });

  it("keeps a proposal sent before couples chose (and anything not a wedding) on its own deposit", () => {
    const old = wedding({ payOptions: [], depositMinor: 30_000 });
    expect(proposalDeposit(old)).toBe(30_000);
    expect(holdsUntilDeposit(old)).toBe(true);
    expect(holdsUntilDeposit(wedding({ payOptions: [], depositMinor: 0 }))).toBe(false);
    expect(holdsUntilDeposit(wedding())).toBe(true);
    expect(holdsUntilDeposit({ ...wedding(), eventType: "CORPORATE", depositMinor: 30_000 })).toBe(false);
  });

  it("won't send a wedding proposal without each act's fee, or with a fee above the price", () => {
    expect(payProblem(wedding())).toBeNull();
    expect(payProblem(wedding({ lines: [{ ...band, costMinor: null }] }))).toMatch(/^Put in the act's fee\./);
    expect(payProblem(wedding({ lines: [band, { ...band, costMinor: 200_000 }] }))).toMatch(/act's fee on line 2 is more than the price/);
    expect(payProblem(wedding({ payOptions: [], lines: [{ ...band, costMinor: null }] }))).toBeNull();
  });

  it("words the note, the tick and the balance date plainly", () => {
    const note = payNoteText("", { business: "Suave Weddings", cashAddress: "63 Boverton Road\nLlantwit Major\nCF61 1YA" });
    expect(note).toContain("collected by Suave Weddings");
    expect(note).toContain("delivered to the following address: 63 Boverton Road, Llantwit Major, CF61 1YA.");
    expect(note).not.toMatch(/[{}]/);
    expect(payNoteText("Our own words for {business}.", { business: "Suave", cashAddress: "" })).toBe("Our own words for Suave.");
    expect(DEFAULT_PAY_NOTE).not.toMatch(/—|sorry|apolog/i);
    expect(payPromise(balancePlan(wedding(), "CASH"), m)).toBe("I'll pay the deposit of £480.00 now, and the balance of £1,100.00 in cash, with no VAT");
    expect(payPromise(balancePlan(wedding(), "TRANSFER"), m)).toBe("I'll pay the deposit of £480.00 now, and the balance of £1,320.00 by bank transfer");
    expect(balanceDueFor([{ date: "2027-08-14" }, { date: "2027-08-13" }])).toBe("2027-05-13");
  });
});
