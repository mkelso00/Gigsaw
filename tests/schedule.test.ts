import { describe, expect, it } from "vitest";
import { buildSchedule, shiftSchedule } from "@/lib/schedule";

describe("buildSchedule", () => {
  it("keeps everything on the gig date when times run in order", () => {
    const s = buildSchedule("2026-12-05", { arrive: "17:00", soundcheck: "18:00", setStart: "20:00", setEnd: "21:30" }, "Europe/London");
    expect(s.arriveBy.toISOString()).toBe("2026-12-05T17:00:00.000Z");
    expect(s.setEnd?.toISOString()).toBe("2026-12-05T21:30:00.000Z");
  });
  it("rolls times after midnight into the next day", () => {
    const s = buildSchedule("2026-12-05", { arrive: "22:00", setStart: "01:00", setEnd: "03:00" }, "Europe/London");
    expect(s.setStart.toISOString()).toBe("2026-12-06T01:00:00.000Z");
    expect(s.setEnd?.toISOString()).toBe("2026-12-06T03:00:00.000Z");
    expect(s.soundcheckAt).toBeNull();
  });
});

describe("shiftSchedule", () => {
  it("moves every time by the same amount and leaves blanks blank", () => {
    const s = shiftSchedule({ arriveBy: new Date("2026-12-05T17:00:00Z"), soundcheckAt: null, setStart: new Date("2026-12-05T20:00:00Z"), setEnd: null }, 30);
    expect(s.arriveBy.toISOString()).toBe("2026-12-05T17:30:00.000Z");
    expect(s.setStart.toISOString()).toBe("2026-12-05T20:30:00.000Z");
    expect(s.soundcheckAt).toBeNull();
    expect(s.setEnd).toBeNull();
  });
});
