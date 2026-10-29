import { describe, expect, it } from "vitest";
import { dayReminderAt, partOfDay, weeklyReminderWeek } from "@/lib/reminder-time";

const tz = "Europe/London";

describe("weeklyReminderWeek", () => {
  it("covers next Monday to Sunday when sent on a Sunday evening", () => {
    // Sun 1 Nov 2026, 18:05 GMT
    expect(weeklyReminderWeek(new Date("2026-11-01T18:05:00Z"), tz, 7, "18:00")).toBe("2026-11-02");
  });
  it("waits until the chosen time", () => {
    expect(weeklyReminderWeek(new Date("2026-11-01T17:59:00Z"), tz, 7, "18:00")).toBeNull();
  });
  it("only goes on the chosen day", () => {
    expect(weeklyReminderWeek(new Date("2026-11-02T18:05:00Z"), tz, 7, "18:00")).toBeNull();
  });
  it("covers the same week when sent on a Monday", () => {
    expect(weeklyReminderWeek(new Date("2026-11-02T08:00:00Z"), tz, 1, "07:30")).toBe("2026-11-02");
  });
  it("covers the next week when sent on a Friday", () => {
    expect(weeklyReminderWeek(new Date("2026-11-06T12:00:00Z"), tz, 5, "09:00")).toBe("2026-11-09");
  });
  it("uses the agency's local time, including summer time", () => {
    // Sun 25 Oct 2026 is after the clocks go back; Sun 18 Oct is BST (UTC+1).
    expect(weeklyReminderWeek(new Date("2026-10-18T17:05:00Z"), tz, 7, "18:00")).toBe("2026-10-19");
    expect(weeklyReminderWeek(new Date("2026-10-18T16:55:00Z"), tz, 7, "18:00")).toBeNull();
  });
});

describe("dayReminderAt", () => {
  it("sends at the chosen time for an evening gig", () => {
    expect(dayReminderAt(new Date("2026-11-06T18:30:00Z"), tz, "12:00").toISOString()).toBe("2026-11-06T12:00:00.000Z");
  });
  it("sends 3 hours before the call time for an afternoon gig", () => {
    expect(dayReminderAt(new Date("2026-11-06T14:00:00Z"), tz, "12:00").toISOString()).toBe("2026-11-06T11:00:00.000Z");
  });
  it("never sends before 7am", () => {
    expect(dayReminderAt(new Date("2026-11-06T09:00:00Z"), tz, "12:00").toISOString()).toBe("2026-11-06T07:00:00.000Z");
  });
});

describe("partOfDay", () => {
  it("names the time of day", () => {
    expect(partOfDay(new Date("2026-11-06T19:00:00Z"), tz)).toBe("this evening");
    expect(partOfDay(new Date("2026-11-06T14:00:00Z"), tz)).toBe("this afternoon");
    expect(partOfDay(new Date("2026-11-06T10:00:00Z"), tz)).toBe("this morning");
  });
});
