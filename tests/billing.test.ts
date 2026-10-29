import { describe, expect, it } from "vitest";
import { billableGigs, gigMonth, isMonthKey, monthIsOver, monthSearchWindow, shiftMonth } from "@/lib/billing";

const gig = (reference: string, iso: string, status = "CONFIRMED", timezone = "Europe/London", demo = false) => ({
  reference,
  arriveBy: new Date(iso),
  status,
  timezone,
  demo,
});

describe("billableGigs", () => {
  it("counts confirmed and settled gigs only, and never demo data", () => {
    const list = [
      gig("GS-1", "2026-10-05T18:00:00Z", "CONFIRMED"),
      gig("GS-2", "2026-10-06T18:00:00Z", "SETTLED"),
      gig("GS-3", "2026-10-07T18:00:00Z", "HOLD"),
      gig("GS-4", "2026-10-08T18:00:00Z", "CANCELLED"),
      gig("GS-5", "2026-10-09T18:00:00Z", "ENQUIRY"),
      gig("GS-6", "2026-10-10T18:00:00Z", "PENDING"),
      gig("GS-7", "2026-10-11T18:00:00Z", "CONFIRMED", "Europe/London", true),
    ];
    expect(billableGigs(list, "2026-10").map((g) => g.reference)).toEqual(["GS-1", "GS-2"]);
  });

  it("uses the venue's local date to pick the month", () => {
    // 23:30 UTC on 31 Oct is already 1 Nov in Amsterdam, but still 31 Oct in New York.
    const ams = gig("GS-A", "2026-10-31T23:30:00Z", "CONFIRMED", "Europe/Amsterdam");
    const ny = gig("GS-N", "2026-10-31T23:30:00Z", "CONFIRMED", "America/New_York");
    expect(gigMonth(ams)).toBe("2026-11");
    expect(gigMonth(ny)).toBe("2026-10");
    expect(billableGigs([ams, ny], "2026-10").map((g) => g.reference)).toEqual(["GS-N"]);
  });
});

describe("month helpers", () => {
  it("shifts months across a year end", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  it("validates month keys", () => {
    expect(isMonthKey("2026-10")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("26-10")).toBe(false);
  });
  it("pads the search window so edge-of-month gigs in any time zone are found", () => {
    const w = monthSearchWindow("2026-10");
    expect(w.gte.toISOString()).toBe("2026-09-29T00:00:00.000Z");
    expect(w.lt.toISOString()).toBe("2026-11-03T00:00:00.000Z");
  });
  it("only treats past months as over", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    expect(monthIsOver("2026-09", now)).toBe(true);
    expect(monthIsOver("2026-10", now)).toBe(false);
  });
});
