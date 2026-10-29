import { describe, expect, it } from "vitest";
import { dateInWeek, isDateKey, venueColour, weekStartOf, weekdayOf } from "@/lib/rota";

describe("weeks", () => {
  it("knows the weekday, Monday first", () => {
    expect(weekdayOf("2026-11-02")).toBe(1); // Monday
    expect(weekdayOf("2026-11-08")).toBe(7); // Sunday
  });
  it("finds the Monday of any week", () => {
    expect(weekStartOf("2026-11-05")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-08")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-02")).toBe("2026-11-02");
  });
  it("finds a weekday's date in a week, across a month end", () => {
    expect(dateInWeek("2026-11-30", 3)).toBe("2026-12-02");
  });
  it("validates date keys", () => {
    expect(isDateKey("2026-11-02")).toBe(true);
    expect(isDateKey("nonsense")).toBe(false);
  });
});

describe("venueColour", () => {
  it("uses the chosen colour", () => {
    expect(venueColour({ id: "x", colour: "#123456" })).toBe("#123456");
  });
  it("picks a stable colour when none is chosen", () => {
    const a = venueColour({ id: "venue-abc", colour: "" });
    expect(a).toMatch(/^#[0-9a-f]{6}$/);
    expect(venueColour({ id: "venue-abc" })).toBe(a);
  });
});

describe("suggestVenueColour", () => {
  it("offers a colour no other venue uses", async () => {
    const { suggestVenueColour, VENUE_PALETTE } = await import("@/lib/rota");
    const used = VENUE_PALETTE.slice(0, 3).map((colour, i) => ({ id: `v${i}`, colour }));
    expect(VENUE_PALETTE.slice(0, 3)).not.toContain(suggestVenueColour(used));
  });
});
