import { describe, expect, it } from "vitest";
import {
  BANK_PRESETS,
  PRESETS,
  SAMPLE_PAYMENTS,
  bankFile,
  bankText,
  cleanAccountNumber,
  cleanSortCode,
  paymentProblems,
  readBankFile,
  templateOf,
  type BankPayment,
} from "@/lib/bank-file";

// The pay run's bank file (src/lib/bank-file.ts): each bank preset's columns, the custom layout builder, and the
// UK bank rules every file follows.

const DAY = "2026-06-08";
const pay = (over: Partial<BankPayment> = {}): BankPayment => ({
  key: "k1",
  payeeName: "Jo Bloggs",
  accountName: "J BLOGGS",
  sortCode: "12-34-56",
  accountNumber: "12345678",
  amountMinor: 45_000,
  currency: "GBP",
  reference: "Suave SB-0012/0019",
  email: "jo@example.com",
  artistId: "act1",
  ...over,
});
const lines = (text: string) => text.trimEnd().split("\r\n");

describe("presets", () => {
  // Each preset's file for one payment: the header row (if any) and the row.
  const expected: Record<Exclude<(typeof BANK_PRESETS)[number], "CUSTOM">, string[]> = {
    GENERIC: ["Name,Sort code,Account number,Amount,Reference", "J BLOGGS,123456,12345678,450.00,Suave SB-0012/0019"],
    STARLING: ["Name,Sort Code,Account Number,Reference,Amount", "J BLOGGS,123456,12345678,Suave SB-0012/0019,450.00"],
    TIDE: ["Name,Sort code,Account number,Amount,Reference", "J BLOGGS,123456,12345678,450.00,Suave SB-0012/0019"],
    REVOLUT: [
      "Name,Recipient type,Account number,Sort code,Recipient bank country,Currency,Amount,Payment reference",
      "J BLOGGS,INDIVIDUAL,12345678,123456,GB,GBP,450.00,Suave SB-0012/0019",
    ],
    MONZO: [
      "Payee name,Sort code,Bank account number,Bank account type,Payment reference,Amount",
      "J BLOGGS,123456,12345678,Personal,Suave SB-0012/0019,450.00",
    ],
    BANKLINE: ["123456,12345678,J BLOGGS,450.00,Suave SB-0012/0019"],
    LLOYDS: ["123456,12345678,J BLOGGS,450.00,Suave SB-0012/0019"],
    BARCLAYS: ["Name,Sort code,Account number,Amount,Reference", "J BLOGGS,123456,12345678,450.00,Suave SB-0012/0019"],
    HSBC: ["Beneficiary name,Beneficiary sort code,Beneficiary account number,Amount,Payment reference", "J BLOGGS,123456,12345678,450.00,Suave SB-0012/0019"],
  };

  it.each(Object.entries(expected))("%s", (preset, want) => {
    const file = bankFile(PRESETS[preset as keyof typeof expected].template!, [pay()], DAY);
    expect(lines(file.text)).toEqual(want);
  });

  it("a value holding the separator is quoted, so it stays one column", () => {
    const t = { ...PRESETS.GENERIC.template!, columns: [{ field: "email" as const, header: "Email" }] };
    expect(lines(bankFile(t, [pay({ email: 'a,"b"@example.com' })], DAY).text)[1]).toBe('"a,""b""@example.com"');
  });

  it("only Generic is marked confirmed; every other bank says to check its template", () => {
    expect(BANK_PRESETS.filter((p) => PRESETS[p].confirmed)).toEqual(["GENERIC"]);
  });

  it("Bacs-style files cut names to 18 characters, the others to 40", () => {
    const long = pay({ accountName: "THE VERY LONG NAMED BAND OF MUSICIANS LIMITED" });
    expect(bankFile(PRESETS.BANKLINE.template!, [long], DAY).rows[0][2]).toBe("THE VERY LONG NAME");
    expect(bankFile(PRESETS.GENERIC.template!, [long], DAY).rows[0][0]).toBe("THE VERY LONG NAMED BAND OF MUSICIANS LI");
  });

  it("Bankline's file is a .txt", () => {
    expect(PRESETS.BANKLINE.template!.extension).toBe("txt");
    expect(PRESETS.GENERIC.template!.extension).toBe("csv");
  });
});

describe("custom layout", () => {
  it("has the chosen columns, in order, with their own headings, separator and date format", () => {
    const s = readBankFile({
      preset: "CUSTOM",
      custom: {
        columns: [
          { field: "payment_date", header: "Date" },
          { field: "sort_code_dashes", header: "SC" },
          { field: "account_number", header: "Acc" },
          { field: "payee_name", header: "Who" },
          { field: "amount_pence", header: "Pence" },
          { field: "reference", header: "Ref" },
          { field: "email", header: "Email" },
          { field: "made_up", header: "Ignored" },
        ],
        header: true,
        separator: ";",
        dateFormat: "YYYY-MM-DD",
        referenceMax: 10,
        nameMax: 6,
      },
    });
    const file = bankFile(templateOf(s), [pay()], DAY);
    expect(lines(file.text)).toEqual(["Date;SC;Acc;Who;Pence;Ref;Email", "2026-06-08;12-34-56;12345678;Jo Blo;45000;Suave SB-0;jo@example.com"]);
  });

  it("can leave the header row off, and use a comma with pounds and other date formats", () => {
    const s = readBankFile({
      preset: "CUSTOM",
      custom: {
        columns: [
          { field: "account_name", header: "N" },
          { field: "amount", header: "A" },
          { field: "payment_date", header: "D" },
        ],
        header: false,
        dateFormat: "DDMMYYYY",
      },
    });
    expect(lines(bankFile(templateOf(s), [pay({ amountMinor: 125_050 })], DAY).text)).toEqual(["J BLOGGS,1250.50,08062026"]);
  });

  it("falls back to the generic layout for anything unreadable", () => {
    const s = readBankFile({ preset: "NOPE", custom: { columns: "x", separator: "|", referenceMax: 9999 } });
    expect(s.preset).toBe("GENERIC");
    expect(s.custom.columns).toEqual(PRESETS.GENERIC.template!.columns);
    expect(s.custom).toMatchObject({ separator: ",", referenceMax: 18, header: true });
    expect(readBankFile(null).preset).toBe("GENERIC");
  });

  it("the sample has made-up payees in the chosen layout", () => {
    const file = bankFile(PRESETS.MONZO.template!, SAMPLE_PAYMENTS, DAY);
    expect(file.rows).toHaveLength(2);
    expect(file.rows[1]).toEqual(["BLUEBIRDS MUSIC LTD", "203040", "00123456", "Personal", "Suave SB-0020", "1250.50"]);
  });
});

describe("UK bank rules", () => {
  it("a sort code is 6 digits", () => {
    expect(cleanSortCode("12-34-56")).toBe("123456");
    expect(cleanSortCode(" 12 34 56 ")).toBe("123456");
    expect(cleanSortCode("12-34-5")).toBeNull();
    expect(cleanSortCode("12-34-567")).toBeNull();
    expect(cleanSortCode("AB-CD-EF")).toBeNull();
  });

  it("an account number is 8 digits, padded with zeros in front", () => {
    expect(cleanAccountNumber("12345678")).toBe("12345678");
    expect(cleanAccountNumber("1234567")).toBe("01234567");
    expect(cleanAccountNumber("123456")).toBe("00123456");
    expect(cleanAccountNumber("12345")).toBeNull();
    expect(cleanAccountNumber("1234567890")).toBeNull();
    expect(cleanAccountNumber("1234 567X")).toBeNull();
  });

  it("references and names keep only letters, numbers, space and - . / &, cut to fit", () => {
    expect(bankText("Zoë's Band (Live!) £100", 40)).toBe("Zoe s Band Live 100");
    expect(bankText("R&B/Soul - No.1", 40)).toBe("R&B/Soul - No.1");
    expect(bankText("Suave SB-0012,0019,0023", 18)).toBe("Suave SB-0012 0019");
  });

  it("leaves out payees with a bad sort code or account number, to fix before paying", () => {
    const file = bankFile(
      PRESETS.GENERIC.template!,
      [
        pay({ key: "ok" }),
        pay({ key: "sc", payeeName: "Bad Sort", sortCode: "12-34" }),
        pay({ key: "acc", payeeName: "No Acc", accountNumber: "" }),
        pay({ key: "zero", amountMinor: 0 }),
      ],
      DAY,
    );
    expect(file.rows).toHaveLength(1);
    expect(file.problems).toEqual([
      { key: "sc", payeeName: "Bad Sort", artistId: "act1", problems: ["Sort code 12-34 isn't 6 digits"] },
      { key: "acc", payeeName: "No Acc", artistId: "act1", problems: ["No account number"] },
    ]);
    expect(paymentProblems({ sortCode: "", accountNumber: "1" })).toEqual(["No sort code", "Account number 1 isn't 8 digits"]);
  });
});
