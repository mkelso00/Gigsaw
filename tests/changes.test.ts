import { describe, expect, it } from "vitest";
import { describeChanges, type BookingSnapshot } from "@/lib/changes";

const base: BookingSnapshot = {
  status: "CONFIRMED",
  timezone: "Europe/London",
  arriveBy: new Date("2026-12-02T18:00:00Z"),
  soundcheckAt: null,
  setStart: new Date("2026-12-02T18:30:00Z"),
  setEnd: new Date("2026-12-02T20:00:00Z"),
  venueName: "The Crown",
  artistFeeMinor: 15000,
  currency: "GBP",
};

describe("describeChanges", () => {
  it("finds nothing when nothing changed", () => {
    expect(describeChanges(base, { ...base })).toEqual([]);
  });
  it("lists time and fee changes in plain words", () => {
    const after = { ...base, setStart: new Date("2026-12-02T19:00:00Z"), setEnd: new Date("2026-12-02T21:00:00Z"), artistFeeMinor: 18000 };
    expect(describeChanges(base, after)).toEqual([
      ["On stage", "18:30", "19:00"],
      ["Off stage", "20:00", "21:00"],
      ["Your fee", "£150.00", "£180.00"],
    ]);
  });
  it("reports date, venue and cancellation", () => {
    const after = { ...base, status: "CANCELLED", venueName: "The Swan", arriveBy: new Date("2026-12-03T18:00:00Z") };
    const c = describeChanges(base, after);
    expect(c[0]).toEqual(["Status", "Confirmed", "Cancelled"]);
    expect(c.find((x) => x[0] === "Date")).toEqual(["Date", "Wed, 2 Dec 2026", "Thu, 3 Dec 2026"]);
    expect(c.find((x) => x[0] === "Venue")).toEqual(["Venue", "The Crown", "The Swan"]);
  });
});
