import { describe, expect, it } from "vitest";
import { buildChecklist, findDateClashes, findRadiusBreaches, type ChecklistBooking, type OtherBooking } from "@/lib/checklist";

const london = { name: "Jazz Cafe", latitude: 51.5392, longitude: -0.1426 };
const nearby = { name: "Union Chapel", latitude: 51.5434, longitude: -0.1031 };
const manchester = { name: "Band on the Wall", latitude: 53.4851, longitude: -2.2353 };

const booking: ChecklistBooking = {
  id: "b1",
  reference: "GS-0001",
  status: "CONFIRMED",
  artistId: "a1",
  timezone: "Europe/London",
  setStart: new Date("2026-11-05T20:00:00Z"),
  venue: london,
  promoterId: "p1",
  feeMinor: 100000,
  dealType: "STANDARD_COMMISSION",
  artistFeeMinor: null,
  depositMinor: 50000,
  depositDueDate: new Date("2026-10-01T00:00:00Z"),
  radiusKm: 50,
  radiusDays: 30,
  travel: "Train",
  dayContact: "Sam 07700 900000",
};

function other(over: Partial<OtherBooking>): OtherBooking {
  return { id: "o", reference: "GS-0002", status: "CONFIRMED", artistId: "a1", setStart: new Date("2026-11-05T13:00:00Z"), venue: manchester, radiusKm: null, radiusDays: null, ...over };
}

describe("clashes", () => {
  it("spots same-day bookings for the same artist", () => {
    expect(findDateClashes(booking, [other({})])).toHaveLength(1);
  });
  it("ignores other artists and cancelled bookings", () => {
    expect(findDateClashes(booking, [other({ artistId: "a2" }), other({ status: "CANCELLED" })])).toHaveLength(0);
  });
  it("ignores itself", () => {
    expect(findDateClashes(booking, [other({ id: "b1" })])).toHaveLength(0);
  });
});

describe("radius clause", () => {
  it("flags a nearby show inside the window", () => {
    expect(findRadiusBreaches(booking, [other({ venue: nearby, setStart: new Date("2026-11-20T20:00:00Z") })])).toHaveLength(1);
  });
  it("allows a far away show", () => {
    expect(findRadiusBreaches(booking, [other({ venue: manchester, setStart: new Date("2026-11-20T20:00:00Z") })])).toHaveLength(0);
  });
  it("allows a nearby show outside the window", () => {
    expect(findRadiusBreaches(booking, [other({ venue: nearby, setStart: new Date("2027-01-20T20:00:00Z") })])).toHaveLength(0);
  });
  it("respects the other booking's clause too", () => {
    const noClause = { ...booking, radiusKm: null, radiusDays: null };
    expect(findRadiusBreaches(noClause, [other({ venue: nearby, radiusKm: 10, radiusDays: 30, setStart: new Date("2026-11-10T20:00:00Z") })])).toHaveLength(1);
  });
});

describe("buildChecklist", () => {
  it("raises an overdue deposit", () => {
    const items = buildChecklist(booking, [], 0, new Date("2026-10-15T00:00:00Z"));
    expect(items.find((i) => i.label === "Deposit overdue")?.level).toBe("error");
  });
  it("is happy when everything is in place", () => {
    const items = buildChecklist(booking, [], 50000, new Date("2026-10-15T00:00:00Z"));
    expect(items.every((i) => i.level === "ok")).toBe(true);
  });
  it("warns about a venue without a map pin", () => {
    const items = buildChecklist({ ...booking, venue: { name: "X", latitude: null, longitude: null } }, [], 50000, new Date());
    expect(items.some((i) => i.label === "Venue has no map pin")).toBe(true);
  });
});
