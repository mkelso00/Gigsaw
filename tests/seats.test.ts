import { describe, expect, it } from "vitest";
import { userCharge } from "@/lib/seats";

describe("internal user charge", () => {
  const plan = { includedUsers: 2, extraUserYearlyMinor: 50000 };
  it("is free up to the included number", () => {
    expect(userCharge(plan, 2)).toEqual({ users: 2, extra: 0, yearlyMinor: 0, monthlyMinor: 0 });
  });
  it("charges each extra user a twelfth of the yearly price a month", () => {
    expect(userCharge(plan, 3)).toEqual({ users: 3, extra: 1, yearlyMinor: 50000, monthlyMinor: 4167 });
    expect(userCharge(plan, 5).monthlyMinor).toBe(12500);
  });
});
