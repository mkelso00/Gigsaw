import { describe, expect, it } from "vitest";
import { COUNTABLE, readStatuses, statusesLabel, statusParams } from "@/lib/count-statuses";

describe("which bookings the money figures count", () => {
  it("counts everything but cancelled when nothing is picked", () => {
    expect(readStatuses(undefined)).toEqual(COUNTABLE);
    expect(readStatuses([])).toEqual(COUNTABLE);
    expect(COUNTABLE).not.toContain("CANCELLED");
    expect(statusesLabel(readStatuses(undefined))).toBe("All except cancelled");
    expect(statusParams(COUNTABLE)).toEqual([]);
  });

  it("keeps only real statuses, in a fixed order, and never cancelled", () => {
    expect(readStatuses(["SETTLED", "CANCELLED", "nonsense", "CONFIRMED"])).toEqual(["CONFIRMED", "SETTLED"]);
    expect(readStatuses("PENDING")).toEqual(["PENDING"]);
    expect(readStatuses("CANCELLED")).toEqual(COUNTABLE); // nothing valid left, so everything
    expect(statusesLabel(["CONFIRMED", "SETTLED"])).toBe("Confirmed, Settled");
    expect(statusParams(["CONFIRMED", "SETTLED"])).toEqual([
      ["st", "CONFIRMED"],
      ["st", "SETTLED"],
    ]);
  });
});
