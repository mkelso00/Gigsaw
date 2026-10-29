import { describe, expect, it } from "vitest";
import { assessPair, describeAssessment, estimateTravelMinutes } from "@/lib/clash";

const crown = { id: "crown", name: "The Crown", latitude: 51.4545, longitude: -2.5879 }; // Bristol
const swan = { id: "swan", name: "The Swan", latitude: 51.4596, longitude: -2.5970 }; // ~0.8 km away
const jazz = { id: "jazz", name: "Jazz Cafe", latitude: 51.5392, longitude: -0.1426 }; // London
const nopin = { id: "x", name: "Village Hall", latitude: null, longitude: null };

const gig = (venue: typeof crown | typeof nopin, arrive: string, start: string, end: string | null) => ({
  venue,
  arriveBy: new Date(`2026-11-06T${arrive}:00Z`),
  setStart: new Date(`2026-11-06T${start}:00Z`),
  setEnd: end ? new Date(`2026-11-06T${end}:00Z`) : null,
});

describe("estimateTravelMinutes", () => {
  it("gives sensible door-to-door times", () => {
    expect(estimateTravelMinutes(0.1)).toBe(0);
    expect(estimateTravelMinutes(1)).toBeLessThanOrEqual(15);
    expect(estimateTravelMinutes(170)).toBeGreaterThan(150);
  });
});

describe("assessPair", () => {
  it("calls overlapping times a clash", () => {
    const r = assessPair(gig(crown, "18:30", "19:00", "21:00"), gig(swan, "20:00", "20:30", "22:00"), 15);
    expect(r.level).toBe("clash");
    expect(r.gapMinutes).toBe(-60);
  });

  it("is fine when there's plenty of time to get across town", () => {
    const r = assessPair(gig(crown, "15:30", "16:00", "19:00"), gig(swan, "19:45", "20:00", "22:00"), 15);
    expect(r.level).toBe("ok");
    expect(r.gapMinutes).toBe(45);
  });

  it("flags a gap too short for the journey", () => {
    const r = assessPair(gig(crown, "15:30", "16:00", "19:00"), gig(jazz, "20:00", "20:30", "22:00"), 15);
    expect(r.level).toBe("tight");
    expect(r.travelMinutes).toBeGreaterThan(60);
  });

  it("allows back-to-back sets at the same venue", () => {
    const r = assessPair(gig(crown, "15:30", "16:00", "19:00"), gig(crown, "19:00", "19:00", "22:00"), 15);
    expect(r.level).toBe("ok");
  });

  it("is cautious when a venue has no map pin", () => {
    const tight = assessPair(gig(crown, "15:30", "16:00", "19:00"), gig(nopin, "19:30", "20:00", "22:00"), 15);
    expect(tight.level).toBe("tight");
    expect(tight.travelMinutes).toBeNull();
    const fine = assessPair(gig(crown, "15:30", "16:00", "19:00"), gig(nopin, "20:30", "21:00", "23:00"), 15);
    expect(fine.level).toBe("ok");
  });

  it("works whichever order the gigs are given in", () => {
    const a = gig(crown, "15:30", "16:00", "19:00");
    const b = gig(swan, "19:45", "20:00", "22:00");
    expect(assessPair(b, a, 15).level).toBe(assessPair(a, b, 15).level);
  });

  it("explains itself in plain English", () => {
    const r = assessPair(gig(crown, "15:30", "16:00", "19:00"), gig(jazz, "20:00", "20:30", "22:00"), 15);
    expect(describeAssessment(r, "Jazz Cafe")).toMatch(/Only 1 h between .* about 170 km away/);
  });
});
