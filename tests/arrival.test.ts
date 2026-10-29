import { describe, expect, it } from "vitest";
import { distanceMetres, punctuality, summariseArrival, checkInWindow, type ArrivalInput } from "@/lib/arrival";

const arriveBy = new Date("2026-11-05T17:00:00Z");
const setStart = new Date("2026-11-05T20:00:00Z");
const setEnd = new Date("2026-11-05T21:30:00Z");

function input(over: Partial<ArrivalInput> = {}): ArrivalInput {
  return {
    status: "CONFIRMED",
    arriveBy,
    setStart,
    setEnd,
    checkIns: [],
    venueHasLocation: true,
    now: new Date("2026-11-05T12:00:00Z"),
    graceMinutes: 5,
    geofenceMetres: 500,
    ...over,
  };
}

const at = (iso: string) => new Date(iso);

describe("summariseArrival", () => {
  it("is not due more than 12 hours ahead", () => {
    expect(summariseArrival(input({ now: at("2026-11-04T12:00:00Z") })).state).toBe("NOT_DUE");
  });
  it("is awaiting on the day", () => {
    expect(summariseArrival(input()).state).toBe("AWAITING");
  });
  it("shows on the way with an expected time", () => {
    const s = summariseArrival(
      input({ checkIns: [{ kind: "ON_THE_WAY", at: at("2026-11-05T15:00:00Z"), source: "APP", distanceM: 40000, etaMinutes: 90 }], now: at("2026-11-05T15:30:00Z") }),
    );
    expect(s.state).toBe("ON_THE_WAY");
    expect(s.expectedAt?.toISOString()).toBe("2026-11-05T16:30:00.000Z");
  });
  it("arrived within the grace period counts as on time", () => {
    const s = summariseArrival(
      input({ checkIns: [{ kind: "ARRIVED", at: at("2026-11-05T17:04:00Z"), source: "APP", distanceM: 50, etaMinutes: null }] }),
    );
    expect(s.state).toBe("ARRIVED_ON_TIME");
    expect(s.minutesLate).toBe(4);
    expect(s.location).toBe("ON_SITE");
  });
  it("arrived early gives a negative offset", () => {
    const s = summariseArrival(
      input({ checkIns: [{ kind: "ARRIVED", at: at("2026-11-05T16:30:00Z"), source: "APP", distanceM: 10, etaMinutes: null }] }),
    );
    expect(s.state).toBe("ARRIVED_ON_TIME");
    expect(s.minutesLate).toBe(-30);
  });
  it("arrived after grace is late, and far away is flagged", () => {
    const s = summariseArrival(
      input({ checkIns: [{ kind: "ARRIVED", at: at("2026-11-05T17:20:00Z"), source: "APP", distanceM: 2500, etaMinutes: null }] }),
    );
    expect(s.state).toBe("ARRIVED_LATE");
    expect(s.minutesLate).toBe(20);
    expect(s.location).toBe("OFF_SITE");
  });
  it("uses the first arrival if there are several", () => {
    const s = summariseArrival(
      input({
        checkIns: [
          { kind: "ARRIVED", at: at("2026-11-05T17:30:00Z"), source: "APP", distanceM: 10, etaMinutes: null },
          { kind: "ARRIVED", at: at("2026-11-05T16:55:00Z"), source: "AGENT", distanceM: null, etaMinutes: null },
        ],
      }),
    );
    expect(s.minutesLate).toBe(-5);
    expect(s.location).toBe("LOGGED_BY_AGENT");
  });
  it("is overdue after the call time plus grace", () => {
    const s = summariseArrival(input({ now: at("2026-11-05T17:30:00Z") }));
    expect(s.state).toBe("OVERDUE");
    expect(s.minutesOverdue).toBe(30);
  });
  it("is overdue even if on the way", () => {
    const s = summariseArrival(
      input({ checkIns: [{ kind: "ON_THE_WAY", at: at("2026-11-05T16:50:00Z"), source: "APP", distanceM: null, etaMinutes: 20 }], now: at("2026-11-05T17:10:00Z") }),
    );
    expect(s.state).toBe("OVERDUE");
    expect(s.expectedAt?.toISOString()).toBe("2026-11-05T17:10:00.000Z");
  });
  it("records no check-in once the gig is over", () => {
    expect(summariseArrival(input({ now: at("2026-11-05T22:00:00Z") })).state).toBe("NO_CHECK_IN");
  });
  it("without a set end, the gig is over three hours after the start", () => {
    expect(summariseArrival(input({ setEnd: null, now: at("2026-11-05T22:59:00Z") })).state).toBe("OVERDUE");
    expect(summariseArrival(input({ setEnd: null, now: at("2026-11-05T23:01:00Z") })).state).toBe("NO_CHECK_IN");
  });
  it("cancelled gigs are not tracked", () => {
    expect(summariseArrival(input({ status: "CANCELLED", now: at("2026-11-05T22:00:00Z") })).state).toBe("CANCELLED");
  });
  it("flags when the venue has no map pin", () => {
    const s = summariseArrival(
      input({ venueHasLocation: false, checkIns: [{ kind: "ARRIVED", at: at("2026-11-05T17:00:00Z"), source: "APP", distanceM: null, etaMinutes: null }] }),
    );
    expect(s.location).toBe("NO_VENUE_LOCATION");
  });
});

describe("checkInWindow", () => {
  it("opens 12 hours before call and closes 6 hours after the gig", () => {
    const w = checkInWindow(arriveBy, setStart, setEnd);
    expect(w.opensAt.toISOString()).toBe("2026-11-05T05:00:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2026-11-06T03:30:00.000Z");
  });
});

describe("punctuality", () => {
  it("summarises a run of gigs", () => {
    const base = summariseArrival(input());
    const p = punctuality([
      { ...base, state: "ARRIVED_ON_TIME", minutesLate: -10, location: "ON_SITE" },
      { ...base, state: "ARRIVED_ON_TIME", minutesLate: 0, location: "OFF_SITE" },
      { ...base, state: "ARRIVED_LATE", minutesLate: 30, location: "ON_SITE" },
      { ...base, state: "NO_CHECK_IN" },
      { ...base, state: "NOT_DUE" },
    ]);
    expect(p.tracked).toBe(4);
    expect(p.onTime).toBe(2);
    expect(p.late).toBe(1);
    expect(p.missing).toBe(1);
    expect(p.onTimeRate).toBe(0.5);
    expect(p.averageMinutesLate).toBe(30);
    expect(p.averageArrivalOffset).toBe(7);
    expect(p.verifiedOnSite).toBe(2);
  });
  it("handles no data", () => {
    expect(punctuality([]).onTimeRate).toBeNull();
  });
});

describe("distanceMetres", () => {
  it("London to Manchester is about 262 km", () => {
    const d = distanceMetres(51.5074, -0.1278, 53.4808, -2.2426);
    expect(d / 1000).toBeGreaterThan(255);
    expect(d / 1000).toBeLessThan(270);
  });
});
