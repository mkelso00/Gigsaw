import { describe, expect, it } from "vitest";
import {
  bankChanged,
  completedAt,
  formatNi,
  maskAccount,
  maskNi,
  missingDetails,
  needsDetails,
  parseAccountNumber,
  parseNiNumber,
  parseSortCode,
  parseVatNumber,
  readPayFields,
  type PayFields,
} from "@/lib/act-details";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

const EMPTY: PayFields = {
  bankAccountName: "",
  bankSortCode: "",
  bankAccountNumber: "",
  address: "",
  niNumber: "",
  phone: "",
  vatRegistered: false,
  vatNumber: "",
};
const FULL: PayFields = {
  ...EMPTY,
  bankAccountName: "Ellie Hart",
  bankSortCode: "12-34-56",
  bankAccountNumber: "12345678",
  address: "1 High Street\nLeeds\nLS1 1AA",
  niNumber: "AB123456C",
};

describe("sort codes and account numbers", () => {
  it("formats a sort code as 00-00-00", () => {
    expect(parseSortCode("123456")).toBe("12-34-56");
    expect(parseSortCode("12 34 56")).toBe("12-34-56");
    expect(parseSortCode("12-34-56")).toBe("12-34-56");
    expect(parseSortCode("12-34-5")).toBeNull();
    expect(parseSortCode("1234567")).toBeNull();
    expect(parseSortCode("12-34-5a")).toBeNull();
  });

  it("wants exactly 8 digits for an account number", () => {
    expect(parseAccountNumber("1234 5678")).toBe("12345678");
    expect(parseAccountNumber("1234567")).toBeNull();
    expect(parseAccountNumber("123456789")).toBeNull();
    expect(parseAccountNumber("1234567a")).toBeNull();
  });

  it("masks all but the last digits", () => {
    expect(maskAccount("12345678")).toBe("••••5678");
    expect(maskAccount("")).toBe("");
  });
});

describe("National Insurance numbers", () => {
  it("accepts the UK format in any spacing or case, and stores it compact", () => {
    expect(parseNiNumber("AB 12 34 56 C")).toBe("AB123456C");
    expect(parseNiNumber("ab123456c")).toBe("AB123456C");
    expect(parseNiNumber("JG-10-37-26-A")).toBe("JG103726A");
  });

  it("rejects what HMRC never gives out", () => {
    for (const bad of [
      "QQ 12 34 56 C",
      "AB123456E",
      "AB12345C",
      "A1123456C",
      "DA123456C",
      "AO123456C",
      "BG123456A",
      "GB123456A",
      "ZZ123456A",
      "NT123456A",
      "",
    ]) {
      expect(parseNiNumber(bad), bad).toBeNull();
    }
  });

  it("is shown spaced, or masked to the last three characters", () => {
    expect(formatNi("AB123456C")).toBe("AB 12 34 56 C");
    expect(maskNi("AB123456C")).toBe("•• •• •• 56 C");
    expect(maskNi("AB123456C")).not.toContain("1234");
  });
});

it("reads UK VAT numbers", () => {
  expect(parseVatNumber("GB 123 4567 89")).toBe("GB123456789");
  expect(parseVatNumber("123456789")).toBe("GB123456789");
  expect(parseVatNumber("12345")).toBeNull();
});

describe("what's missing", () => {
  it("lists bank details, address and NI number", () => {
    expect(missingDetails(EMPTY)).toEqual(["bank details", "address", "National Insurance number"]);
    expect(missingDetails(FULL)).toEqual([]);
    expect(missingDetails({ ...FULL, bankSortCode: "" })).toEqual(["bank details"]);
  });

  it("needs details until they're complete and marked so", () => {
    expect(needsDetails({ ...FULL, detailsCompletedAt: null })).toBe(true);
    expect(needsDetails({ ...FULL, detailsCompletedAt: new Date() })).toBe(false);
    expect(needsDetails({ ...FULL, address: "", detailsCompletedAt: new Date() })).toBe(true);
  });

  it("keeps the first completed date, and clears it when something is taken out", () => {
    const then = new Date("2026-01-01");
    expect(completedAt(FULL, then)).toBe(then);
    expect(completedAt(FULL, null, new Date("2026-02-02"))?.toISOString()).toBe("2026-02-02T00:00:00.000Z");
    expect(completedAt({ ...FULL, niNumber: "" }, then)).toBeNull();
  });
});

describe("the act's form", () => {
  const all = {
    bankAccountName: "Ellie Hart",
    bankSortCode: "123456",
    bankAccountNumber: "12345678",
    address: " 1 High Street \n\n Leeds ",
    niNumber: "ab 12 34 56 c",
    vatNumber: "",
  };

  it("saves tidy values", () => {
    expect(readPayFields(form(all), EMPTY, { required: true })).toMatchObject({
      bankSortCode: "12-34-56",
      bankAccountNumber: "12345678",
      address: "1 High Street\nLeeds",
      niNumber: "AB123456C",
      vatRegistered: false,
    });
  });

  it("requires address, NI number and bank details", () => {
    expect(() => readPayFields(form({ ...all, address: "" }), EMPTY, { required: true })).toThrow(/postal address/);
    expect(() => readPayFields(form({ ...all, niNumber: "" }), EMPTY, { required: true })).toThrow(/National Insurance/);
    expect(() => readPayFields(form({ ...all, bankAccountName: "" }), EMPTY, { required: true })).toThrow(/name on the bank account/);
  });

  it("says what's wrong with a number", () => {
    expect(() => readPayFields(form({ ...all, bankSortCode: "12-34" }), EMPTY, { required: true })).toThrow(/sort code/);
    expect(() => readPayFields(form({ ...all, bankAccountNumber: "1234567" }), EMPTY, { required: true })).toThrow(/8 numbers/);
    expect(() => readPayFields(form({ ...all, niNumber: "QQ 12 34 56 C" }), EMPTY, { required: true })).toThrow(/National Insurance/);
    expect(() => readPayFields(form({ ...all, vatRegistered: "on", vatNumber: "123" }), EMPTY, { required: true })).toThrow(/VAT number/);
  });

  it("keeps bank details and NI number on file when they weren't changed", () => {
    const out = readPayFields(form({ address: "2 New Road", vatNumber: "" }), FULL, { required: true });
    expect(out).toMatchObject({ bankAccountNumber: "12345678", niNumber: "AB123456C", address: "2 New Road" });
  });

  it("lets an admin clear a field, but not type a wrong one", () => {
    const out = readPayFields(form({ niNumber: "", bankAccountName: "", bankSortCode: "", bankAccountNumber: "" }), FULL, { required: false });
    expect(out).toMatchObject({ niNumber: "", bankAccountNumber: "", address: FULL.address });
    expect(() => readPayFields(form({ niNumber: "nope" }), FULL, { required: false })).toThrow(/National Insurance/);
  });
});

it("spots a change of bank account, but not the first time one is added", () => {
  expect(bankChanged(EMPTY, FULL)).toBe(false);
  expect(bankChanged(FULL, FULL)).toBe(false);
  expect(bankChanged(FULL, { ...FULL, bankAccountNumber: "87654321" })).toBe(true);
  expect(bankChanged(FULL, { ...FULL, bankSortCode: "65-43-21" })).toBe(true);
});
