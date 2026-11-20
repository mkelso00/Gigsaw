import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  REFERENCE_MAX,
  changesSinceSent,
  groupByPayee,
  inWeek,
  lastWeekStart,
  mondayOf,
  bankPayments,
  paymentReference,
  progressLine,
  readWeek,
  recordsRows,
  runProgress,
  thisWeekStart,
  weekLabel,
  weekWindow,
  type RunInvoice,
} from "@/lib/pay-run";
import { invoicesPdf } from "@/lib/pay-run-pdf";
import { PRESETS, bankFile } from "@/lib/bank-file";

// The weekly pay run's rules (src/lib/pay-run.ts): the week, payees and their totals, the bank reference, what's
// changed since the records were sent, and the files. The database side is in tests/pay-run-db.test.ts.

const LONDON = "Europe/London";

let seq = 0;
function inv(over: Partial<RunInvoice> = {}): RunInvoice {
  seq++;
  return {
    id: `inv${seq}`,
    number: `SB-${String(seq).padStart(4, "0")}`,
    seq,
    status: "ISSUED",
    currency: "GBP",
    netMinor: 10_000,
    vatMinor: 0,
    totalMinor: 10_000,
    gigDate: new Date("2026-06-03T19:00:00Z"),
    paidAt: null,
    actName: "The Act",
    artistId: "act1",
    payeeName: "",
    payeePersonId: null,
    bookingId: `b${seq}`,
    bookingRef: `BK-${seq}`,
    bankAccountName: "J Smith",
    bankSortCode: "12-34-56",
    bankAccountNumber: "12345678",
    payments: [],
    ...over,
  };
}

describe("the week", () => {
  it("runs Monday to Sunday", () => {
    expect(mondayOf("2026-06-01")).toBe("2026-06-01"); // a Monday
    expect(mondayOf("2026-06-07")).toBe("2026-06-01"); // Sunday
    expect(mondayOf("2026-06-08")).toBe("2026-06-08");
    expect(mondayOf("2027-01-02")).toBe("2026-12-28");
  });

  it("defaults to last week, in the business's time zone", () => {
    // Monday 00:30 in London (BST) is still Sunday in UTC: it's already a new week here.
    const mondayJustAfterMidnight = new Date("2026-06-07T23:30:00Z");
    expect(thisWeekStart(mondayJustAfterMidnight, LONDON)).toBe("2026-06-08");
    expect(lastWeekStart(mondayJustAfterMidnight, LONDON)).toBe("2026-06-01");
    expect(lastWeekStart(mondayJustAfterMidnight, "UTC")).toBe("2026-05-25");
  });

  it("reads any day in a week from the address, and nothing else", () => {
    expect(readWeek("2026-06-04")).toBe("2026-06-01");
    expect(readWeek("2026-02-30")).toBeNull();
    expect(readWeek("nonsense")).toBeNull();
    expect(readWeek(undefined)).toBeNull();
  });

  it("counts a gig by its date in the business's time zone, so a late Sunday gig is in its week", () => {
    const w = weekWindow("2026-06-01", LONDON);
    expect(w.gte.toISOString()).toBe("2026-05-31T23:00:00.000Z");
    expect(w.lt.toISOString()).toBe("2026-06-07T23:00:00.000Z");
    const sundayLate = new Date("2026-06-07T22:30:00Z"); // 23:30 BST on Sunday
    const mondayEarly = new Date("2026-06-07T23:30:00Z"); // 00:30 BST on Monday
    expect(inWeek(sundayLate, "2026-06-01", LONDON)).toBe(true);
    expect(sundayLate >= w.gte && sundayLate < w.lt).toBe(true);
    expect(inWeek(mondayEarly, "2026-06-01", LONDON)).toBe(false);
    expect(mondayEarly < w.lt).toBe(false);
    // In winter (GMT) the week starts at midnight UTC.
    expect(weekWindow("2026-11-09", LONDON).gte.toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });

  it("says which week in plain words", () => {
    expect(weekLabel("2026-11-09")).toBe("Mon 9 to Sun 15 November 2026");
    expect(weekLabel("2026-10-26")).toBe("Mon 26 October to Sun 1 November 2026");
    expect(weekLabel("2026-12-28")).toBe("Mon 28 December 2026 to Sun 3 January 2027");
  });
});

describe("payment reference", () => {
  it("is the business and the invoice numbers, never more than 18 characters", () => {
    expect(paymentReference("Suave Agency", ["SB-0012"])).toBe("Suave SB-0012");
    expect(paymentReference("Suave Agency", ["SB-0019", "SB-0012"])).toBe("Suave SB-0012/0019");
    const many = paymentReference("Suave Agency", ["SB-0012", "SB-0019", "SB-0023"]);
    expect(many).toBe("Suave SB-0012/0019");
    expect(many.length).toBeLessThanOrEqual(REFERENCE_MAX);
    // Only characters banks take, and a long name never squeezes the number out.
    expect(paymentReference("Rock'n'Roll! Ltd", ["SB-0001"])).toBe("RocknRol SB-0001");
    expect(paymentReference("", ["SB-0001", "SB-0002"])).toBe("SB-0001/0002");
    expect(paymentReference("Suave", ["SB-10000", "SB-9999"])).toBe("Suave SB-9999");
  });
});

describe("payees", () => {
  it("one per person or act for the week, totalled across all their gigs and acts", () => {
    const jo1 = inv({ payeePersonId: "jo", payeeName: "Jo Bloggs", actName: "Jo Solo", artistId: "solo", totalMinor: 20_000 });
    const jo2 = inv({
      payeePersonId: "jo",
      payeeName: "Jo Bloggs",
      actName: "The Band",
      artistId: "band",
      totalMinor: 45_000,
      netMinor: 37_500,
      vatMinor: 7_500,
    });
    const act = inv({ actName: "Act Itself", artistId: "act2", totalMinor: 30_000 });
    const voided = inv({ payeePersonId: "jo", status: "VOID", totalMinor: 99_900 });
    const payees = groupByPayee([jo1, jo2, act, voided], "Suave Agency");
    expect(payees.map((p) => p.name)).toEqual(["Act Itself", "Jo Bloggs"]);
    const jo = payees[1];
    expect(jo).toMatchObject({ totalMinor: 65_000, owedMinor: 65_000, paid: false, acts: ["Jo Solo", "The Band"] });
    expect(jo.invoices.map((i) => i.id)).toEqual([jo1.id, jo2.id]);
    expect(jo.reference).toBe(paymentReference("Suave", [jo1.number, jo2.number]));
    expect(jo.key).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("knows what's paid, part paid and how far the week has got", () => {
    const paid = inv({ payeePersonId: "a", payeeName: "Amy", status: "PAID", paidAt: new Date("2026-06-09T10:00:00Z") });
    const part = inv({ payeePersonId: "b", payeeName: "Ben", totalMinor: 10_000, payments: [{ direction: "OUT", amountMinor: 4_000 }] });
    const open = inv({ payeePersonId: "b", payeeName: "Ben", totalMinor: 5_000 });
    const payees = groupByPayee([paid, part, open], "Suave");
    expect(payees[0]).toMatchObject({ name: "Amy", paid: true, owedMinor: 0, paidAt: paid.paidAt });
    expect(payees[1]).toMatchObject({ name: "Ben", paid: false, owedMinor: 11_000, paidMinor: 4_000, totalMinor: 15_000 });
    const p = runProgress(payees);
    expect(p).toMatchObject({ payees: 2, paidPayees: 1, invoices: 3, totalMinor: 25_000, paidMinor: 14_000, owedMinor: 11_000, done: false });
    expect(progressLine(p, "GBP")).toBe("1 of 2 paid · £140.00 of £250.00");
    expect(runProgress(groupByPayee([paid], "Suave")).done).toBe(true);
    expect(runProgress([]).done).toBe(false);
  });

  it("pays into the newest unpaid invoice's account, and flags unpaid ones that disagree", () => {
    const older = inv({ payeePersonId: "c", bankAccountNumber: "11111111" });
    const newer = inv({ payeePersonId: "c", bankAccountNumber: "22222222" });
    const [c] = groupByPayee([older, newer], "Suave");
    expect(c.bank.accountNumber).toBe("22222222");
    expect(c.bankMismatch).toBe(true);
  });
});

describe("since the records were sent", () => {
  it("lists invoices made or reissued since, and those voided", () => {
    const live = [
      { id: "a", number: "SB-0001" },
      { id: "c", number: "SB-0003" },
    ];
    expect(changesSinceSent(null, live)).toMatchObject({ sent: false, changed: false });
    const same = changesSinceSent({ sentInvoiceIds: ["a", "c"], sentNumbers: ["SB-0001", "SB-0003"] }, live);
    expect(same).toMatchObject({ sent: true, changed: false, added: [], removed: [] });
    const d = changesSinceSent({ sentInvoiceIds: ["a", "b"], sentNumbers: ["SB-0001", "SB-0002"] }, live);
    expect(d.changed).toBe(true);
    expect(d.added).toEqual([{ id: "c", number: "SB-0003" }]);
    expect(d.removed).toEqual([{ id: "b", number: "SB-0002" }]);
  });
});

describe("files", () => {
  it("a plain payment list for a bank upload: name, sort code, account, amount, reference", () => {
    const { rows } = bankFile(
      PRESETS.GENERIC.template!,
      bankPayments(
        groupByPayee(
          [
            inv({
              payeePersonId: "z",
              payeeName: "Zed",
              bankAccountName: "Z ZED",
              bankSortCode: "40-11-22",
              bankAccountNumber: "8765 4321",
              totalMinor: 123_450,
            }),
            inv({ payeePersonId: "y", payeeName: "Yan", status: "PAID" }),
          ],
          "Suave Agency",
        ),
      ),
      "2026-06-08",
    );
    expect(rows).toEqual([["Z ZED", "401122", "87654321", "1234.50", expect.stringMatching(/^Suave SB-\d{4}$/)]]);
  });

  it("the records list every invoice, with no bank details", () => {
    const rows = recordsRows([inv({ netMinor: 10_000, vatMinor: 2_000, totalMinor: 12_000, actName: "Band", payeeName: "Lead Person" })], LONDON);
    expect(rows[0]).toEqual([
      expect.stringMatching(/^SB-/),
      "To pay",
      "2026-06-03",
      "Band",
      "Lead Person",
      expect.any(String),
      "100.00",
      "20.00",
      "120.00",
      "GBP",
      "",
    ]);
    expect(rows[0].join(",")).not.toContain("12345678");
  });

  it("one PDF with a page per invoice, whatever characters the names have", async () => {
    const base = {
      vatPct: 0,
      issuedAt: new Date(),
      voidedAt: null,
      note: "",
      description: "Live performance by Zoë & the Ünicorns 🎸 at The Crown on Sat 6 Jun 2026",
      actAddress: "1 High Street\nLeeds",
      actVatNumber: "",
    };
    const pdf = await invoicesPdf(
      [
        { ...inv({ actName: "Zoë 🎸", payeeName: "Zoë Smith" }), ...base },
        { ...inv({ status: "PAID", paidAt: new Date(), vatMinor: 2_000, totalMinor: 12_000 }), ...base, vatPct: 20, actVatNumber: "GB123456789" },
      ],
      { agencyName: "Suave Agency", agencyAddress: "2 Office Row", defaultTimezone: LONDON },
    );
    expect(Buffer.from(pdf).toString("latin1", 0, 5)).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
  });
});
