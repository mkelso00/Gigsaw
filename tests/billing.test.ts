import { describe, expect, it } from "vitest";
import { billableGigs, gigMonth, isMonthKey, isUnresolvedPast, monthIsOver, monthSearchWindow, shiftMonth } from "@/lib/billing";

const now = new Date("2026-10-20T12:00:00Z");
const gig = (reference: string, iso: string, status = "CONFIRMED", extra: { timezone?: string; demo?: boolean; arrived?: boolean } = {}) => ({
  reference,
  arriveBy: new Date(iso),
  status,
  timezone: extra.timezone ?? "Europe/London",
  demo: extra.demo ?? false,
  arrived: extra.arrived ?? false,
});

describe("billableGigs", () => {
  it("bills confirmed and settled gigs, whether past or future", () => {
    const list = [gig("GS-1", "2026-10-05T18:00:00Z", "CONFIRMED"), gig("GS-2", "2026-10-28T18:00:00Z", "SETTLED")];
    expect(billableGigs(list, "2026-10", now).map((g) => g.reference)).toEqual(["GS-1", "GS-2"]);
  });

  it("bills holds and pending bookings once their date has passed, but not before", () => {
    const list = [
      gig("GS-3", "2026-10-07T18:00:00Z", "HOLD"),
      gig("GS-4", "2026-10-08T18:00:00Z", "PENDING"),
      gig("GS-5", "2026-10-25T18:00:00Z", "HOLD"),
    ];
    expect(billableGigs(list, "2026-10", now).map((g) => g.reference)).toEqual(["GS-3", "GS-4"]);
  });

  it("bills any gig the artist checked in to, even an enquiry", () => {
    const list = [gig("GS-6", "2026-10-09T18:00:00Z", "ENQUIRY", { arrived: true }), gig("GS-7", "2026-10-10T18:00:00Z", "ENQUIRY")];
    expect(billableGigs(list, "2026-10", now).map((g) => g.reference)).toEqual(["GS-6"]);
  });

  it("never bills cancelled gigs or demo data", () => {
    const list = [
      gig("GS-8", "2026-10-11T18:00:00Z", "CANCELLED", { arrived: true }),
      gig("GS-9", "2026-10-12T18:00:00Z", "CONFIRMED", { demo: true }),
    ];
    expect(billableGigs(list, "2026-10", now)).toEqual([]);
  });

  it("uses the venue's local date to pick the month", () => {
    // 23:30 UTC on 31 Oct is already 1 Nov in Amsterdam, but still 31 Oct in New York.
    const ams = gig("GS-A", "2026-10-31T23:30:00Z", "CONFIRMED", { timezone: "Europe/Amsterdam" });
    const ny = gig("GS-N", "2026-10-31T23:30:00Z", "CONFIRMED", { timezone: "America/New_York" });
    expect(gigMonth(ams)).toBe("2026-11");
    expect(gigMonth(ny)).toBe("2026-10");
    expect(billableGigs([ams, ny], "2026-10", now).map((g) => g.reference)).toEqual(["GS-N"]);
  });
});

describe("isUnresolvedPast", () => {
  it("flags holds, pending and enquiries more than a day old", () => {
    expect(isUnresolvedPast(gig("A", "2026-10-15T18:00:00Z", "HOLD"), now)).toBe(true);
    expect(isUnresolvedPast(gig("B", "2026-10-15T18:00:00Z", "ENQUIRY"), now)).toBe(true);
    expect(isUnresolvedPast(gig("C", "2026-10-20T08:00:00Z", "HOLD"), now)).toBe(false);
    expect(isUnresolvedPast(gig("D", "2026-10-15T18:00:00Z", "CONFIRMED"), now)).toBe(false);
    expect(isUnresolvedPast(gig("E", "2026-10-15T18:00:00Z", "HOLD", { demo: true }), now)).toBe(false);
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
    expect(monthIsOver("2026-09", now)).toBe(true);
    expect(monthIsOver("2026-10", now)).toBe(false);
  });
});

describe("gigs with no act", () => {
  it("never bills a pending gig that never got an act, but does bill an unanswered offer that went ahead", async () => {
    const { isBillable } = await import("@/lib/billing");
    const past = new Date(Date.now() - 3 * 86_400_000);
    expect(isBillable({ status: "PENDING", demo: false, arriveBy: past, arrived: false, hasAct: false })).toBe(false);
    expect(isBillable({ status: "AWAITING", demo: false, arriveBy: past, arrived: false, hasAct: true })).toBe(true);
  });
});
