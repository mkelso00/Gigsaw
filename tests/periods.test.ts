import { describe, expect, it } from "vitest";
import { periodBuckets, periodRange, shiftPeriod, weekStart } from "@/lib/periods";

describe("report periods", () => {
  it("weeks run Monday to Sunday", () => {
    expect(weekStart("2026-10-29")).toBe("2026-10-26"); // Thursday
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // Sunday
    expect(weekStart("2026-10-26")).toBe("2026-10-26"); // Monday
    expect(periodRange("week", "2026-10-29")).toMatchObject({ from: "2026-10-26", to: "2026-11-01" });
  });

  it("months and years cover the whole period", () => {
    expect(periodRange("month", "2026-02-14")).toMatchObject({ from: "2026-02-01", to: "2026-02-28", label: "February 2026" });
    expect(periodRange("year", "2026-06-01")).toMatchObject({ from: "2026-01-01", to: "2026-12-31", label: "2026" });
  });

  it("steps back and forward", () => {
    expect(shiftPeriod("week", "2026-10-29", -1)).toBe("2026-10-19");
    expect(shiftPeriod("month", "2026-01-31", -1)).toBe("2025-12-01");
    expect(shiftPeriod("month", "2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftPeriod("year", "2026-05-05", 1)).toBe("2027-01-01");
  });

  it("breaks a month into weeks cut to the month", () => {
    const b = periodBuckets("month", "2026-10-10");
    expect(b[0]).toMatchObject({ from: "2026-10-01", to: "2026-10-04" });
    expect(b[1]).toMatchObject({ from: "2026-10-05", to: "2026-10-11" });
    expect(b.at(-1)).toMatchObject({ from: "2026-10-26", to: "2026-10-31" });
    expect(periodBuckets("week", "2026-10-29")).toHaveLength(7);
    expect(periodBuckets("year", "2026-10-29")).toHaveLength(12);
  });
});
