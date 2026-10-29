import { describe, expect, it } from "vitest";
import { localDateKey, localTime, zonedToUtc, addDaysToKey, formatMinutes } from "@/lib/time";

describe("zonedToUtc", () => {
  it("converts London winter time (GMT)", () => {
    expect(zonedToUtc("2026-12-01", "19:30", "Europe/London").toISOString()).toBe("2026-12-01T19:30:00.000Z");
  });
  it("converts London summer time (BST)", () => {
    expect(zonedToUtc("2026-07-01", "19:30", "Europe/London").toISOString()).toBe("2026-07-01T18:30:00.000Z");
  });
  it("converts New York time", () => {
    expect(zonedToUtc("2026-11-10", "20:00", "America/New_York").toISOString()).toBe("2026-11-11T01:00:00.000Z");
  });
  it("converts a time east of UTC across midnight", () => {
    expect(zonedToUtc("2026-11-10", "08:00", "Australia/Sydney").toISOString()).toBe("2026-11-09T21:00:00.000Z");
  });
  it("handles the day the clocks go back in London", () => {
    // 25 Oct 2026: 02:00 BST becomes 01:00 GMT. 12:00 that day is GMT.
    expect(zonedToUtc("2026-10-25", "12:00", "Europe/London").toISOString()).toBe("2026-10-25T12:00:00.000Z");
  });
  it("round trips through localDateKey and localTime", () => {
    const d = zonedToUtc("2026-03-29", "23:15", "Europe/Berlin");
    expect(localDateKey(d, "Europe/Berlin")).toBe("2026-03-29");
    expect(localTime(d, "Europe/Berlin")).toBe("23:15");
  });
  it("rejects nonsense", () => {
    expect(() => zonedToUtc("not-a-date", "19:00", "UTC")).toThrow();
  });
});

describe("helpers", () => {
  it("adds days to a date key across a month end", () => {
    expect(addDaysToKey("2026-01-31", 1)).toBe("2026-02-01");
  });
  it("formats minutes", () => {
    expect(formatMinutes(12)).toBe("12 min");
    expect(formatMinutes(65)).toBe("1 h 5 min");
    expect(formatMinutes(-120)).toBe("2 h");
  });
});
