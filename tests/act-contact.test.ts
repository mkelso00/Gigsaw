import { describe, expect, it } from "vitest";
import { actContactLine } from "@/lib/act-calendar";

describe("who acts call about a gig", () => {
  const promoter = { name: "The Crown", phone: "0161 000 0000" };
  it("is the business's contact for acts when it has one, instead of the promoter", () => {
    expect(actContactLine(promoter, { name: "Lucy", phone: "07700 900123" })).toEqual(["Contact", "Lucy, 07700 900123"]);
    expect(actContactLine(null, { name: "", phone: "07700 900123" })).toEqual(["Contact", "07700 900123"]);
  });
  it("is the promoter when the business hasn't set one", () => {
    expect(actContactLine(promoter, { name: " ", phone: "" })).toEqual(["Promoter", "The Crown, 0161 000 0000"]);
    expect(actContactLine(promoter, undefined)).toEqual(["Promoter", "The Crown, 0161 000 0000"]);
    expect(actContactLine(null, undefined)).toBeNull();
  });
});
