import { describe, expect, it } from "vitest";
import { formatSortCode, parseActProfile, parseMembers } from "@/lib/act-profile";

const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

describe("act profile", () => {
  it("tidies links, sort codes and fees", () => {
    const p = parseActProfile(
      form([
        ["actType", "band"],
        ["videoUrl", "youtube.com/watch?v=x"],
        ["instagram", "@theband"],
        ["usualFee", "150"],
        ["bankSortCode", "123456"],
        ["bankAccountNumber", "1234 5678"],
        ["vatNumber", "GB123"],
      ]),
    );
    expect(p).toMatchObject({
      actType: "BAND",
      videoUrl: "https://youtube.com/watch?v=x",
      instagram: "theband",
      usualFeeMinor: 15000,
      bankSortCode: "12-34-56",
      bankAccountNumber: "12345678",
      vatRegistered: false,
      vatNumber: "",
    });
  });

  it("rejects bad bank details", () => {
    expect(() => parseActProfile(form([["bankSortCode", "12-34"]]))).toThrow(/sort code/);
    expect(() => parseActProfile(form([["bankAccountNumber", "12ab"]]))).toThrow(/account number/);
    expect(formatSortCode("12 34 56")).toBe("12-34-56");
  });

  it("reads member rows and skips blank ones", () => {
    const m = parseMembers(
      form([
        ["member_name", "Dev Sharma"],
        ["member_email", "DEV@x.com"],
        ["member_phone", "077"],
        ["member_role", "Drums"],
        ["member_name", ""],
        ["member_email", ""],
        ["member_phone", ""],
        ["member_role", ""],
      ]),
    );
    expect(m).toEqual([{ name: "Dev Sharma", email: "dev@x.com", phone: "077", role: "Drums" }]);
  });
});
