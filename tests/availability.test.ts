import { describe, expect, it } from "vitest";
import {
  awayLine,
  awayOn,
  blockLength,
  blocksOn,
  canAnswer,
  checkAwayRange,
  describeAway,
  formatRange,
  replyCounts,
  requestTimes,
  sortReplies,
  type AwayBlock,
} from "@/lib/availability";
import { buildChecklist, type ChecklistBooking } from "@/lib/checklist";

const holiday: AwayBlock = { artistId: "ellie", startDate: "2026-11-01", endDate: "2026-11-07", note: "Holiday" };
const oneDay: AwayBlock = { artistId: "graham", startDate: "2026-11-05", endDate: "2026-11-05", note: "" };

describe("blocking out dates", () => {
  it("takes a single day when there's no end date", () => {
    expect(checkAwayRange("2026-11-05", "", "2026-10-30")).toEqual({ startDate: "2026-11-05", endDate: "2026-11-05" });
  });
  it("turns down ranges that are back to front, past or too long", () => {
    expect(checkAwayRange("2026-11-07", "2026-11-01", "2026-10-30")).toMatchObject({ error: expect.stringContaining("before") });
    expect(checkAwayRange("2026-10-01", "2026-10-02", "2026-10-30")).toMatchObject({ error: expect.stringContaining("passed") });
    expect(checkAwayRange("2026-11-01", "2028-01-01", "2026-10-30")).toMatchObject({ error: expect.stringContaining("year") });
    expect(checkAwayRange("", "", "2026-10-30")).toMatchObject({ error: expect.any(String) });
  });
  it("keeps a range that started earlier but is still running", () => {
    expect(checkAwayRange("2026-10-28", "2026-11-02", "2026-10-30")).toEqual({ startDate: "2026-10-28", endDate: "2026-11-02" });
  });
  it("counts both ends", () => {
    expect(blockLength(holiday)).toBe(7);
    expect(blockLength(oneDay)).toBe(1);
  });
});

describe("who is away", () => {
  it("finds blocks covering a date, both ends included", () => {
    expect(blocksOn([holiday, oneDay], "2026-11-01")).toEqual([holiday]);
    expect(blocksOn([holiday, oneDay], "2026-11-07")).toEqual([holiday]);
    expect(blocksOn([holiday, oneDay], "2026-11-08")).toEqual([]);
    expect(blocksOn([holiday, oneDay], "2026-11-05", ["graham"])).toEqual([oneDay]);
  });
  it("marks a band away while an act inside it is", () => {
    const bands = (id: string) => (id === "graham" ? ["wonderlust"] : []);
    const away = awayOn([holiday, oneDay], "2026-11-05", bands);
    expect([...away.keys()].sort()).toEqual(["ellie", "graham", "wonderlust"]);
    expect(away.get("wonderlust")).toBe(oneDay);
    expect(awayOn([holiday, oneDay], "2026-11-06", bands).has("wonderlust")).toBe(false);
  });
});

describe("wording", () => {
  it("writes short date ranges", () => {
    expect(formatRange("2026-11-07", "2026-11-07")).toBe("Sat, 7 Nov 2026");
    expect(formatRange("2026-11-01", "2026-11-07")).toBe("1–7 Nov 2026");
    expect(formatRange("2026-10-28", "2026-11-03")).toBe("28 Oct – 3 Nov 2026");
    expect(formatRange("2026-12-28", "2027-01-02")).toBe("28 Dec 2026 – 2 Jan 2027");
  });
  it("explains why an act can't play, naming the act inside a band", () => {
    expect(describeAway("Ellie Rose", holiday)).toBe("Ellie Rose can't play 1–7 Nov 2026 (Holiday).");
    expect(describeAway("Graham", oneDay)).toBe("Graham can't play Thu, 5 Nov 2026.");
    expect(awayLine("Wonderlust", { ...oneDay, own: false, actName: "Graham McKee Solo" })).toBe(
      "Graham McKee Solo (in Wonderlust) can't play Thu, 5 Nov 2026.",
    );
  });
  it("describes a request's times", () => {
    expect(requestTimes({ arriveTime: "18:30", startTime: "19:00", endTime: "21:00" })).toBe("on 19:00–21:00, arrive 18:30");
    expect(requestTimes({ arriveTime: "", startTime: "19:00", endTime: "" })).toBe("on 19:00");
    expect(requestTimes({ arriveTime: "19:00", startTime: "19:00", endTime: "" })).toBe("on 19:00");
    expect(requestTimes({ arriveTime: "", startTime: "", endTime: "" })).toBe("");
  });
});

describe("answers", () => {
  const replies = [
    { answer: null, artist: { name: "Zed" } },
    { answer: "NO", artist: { name: "Amy" } },
    { answer: "YES", artist: { name: "Rob" } },
    { answer: "YES", artist: { name: "Bea" } },
  ];
  it("adds up free, not free and waiting", () => {
    expect(replyCounts(replies)).toEqual({ yes: 2, no: 1, waiting: 1 });
  });
  it("lists free first, then waiting, then not free", () => {
    expect(sortReplies(replies).map((r) => r.artist.name)).toEqual(["Bea", "Rob", "Zed", "Amy"]);
  });
  it("stays open until the date has passed or it's closed", () => {
    expect(canAnswer({ date: "2026-11-05", closedAt: null }, "2026-11-05")).toBe(true);
    expect(canAnswer({ date: "2026-11-05", closedAt: null }, "2026-11-06")).toBe(false);
    expect(canAnswer({ date: "2026-11-05", closedAt: new Date() }, "2026-11-01")).toBe(false);
  });
});

describe("checklist", () => {
  const gig: ChecklistBooking = {
    id: "b1",
    reference: "GS-0001",
    status: "PENDING",
    artistId: "ellie",
    artistName: "Ellie Rose",
    timezone: "Europe/London",
    // Saturday 7 November, the last day of Ellie's holiday.
    arriveBy: new Date("2026-11-07T19:00:00Z"),
    setStart: new Date("2026-11-07T20:00:00Z"),
    setEnd: null,
    venue: null,
    promoterId: null,
    feeMinor: 0,
    dealType: "BUY_SELL",
    artistFeeMinor: null,
    depositMinor: 0,
    depositDueDate: null,
    radiusKm: null,
    radiusDays: null,
    travel: "",
    dayContact: "",
  };
  it("flags an act booked on a day they've blocked out", () => {
    const item = buildChecklist({ ...gig, away: [holiday] }, [], 0, new Date()).find((i) => i.label === "Act has said they can't play that day");
    expect(item?.level).toBe("error");
    expect(item?.detail).toContain("Holiday");
  });
  it("is happy when the act hasn't blocked the day out", () => {
    const items = buildChecklist({ ...gig, away: [oneDay] }, [], 0, new Date());
    expect(items.find((i) => i.label === "Act hasn't blocked out this day")?.level).toBe("ok");
  });
  it("uses the gig's own day in its time zone", () => {
    const late = { ...gig, arriveBy: new Date("2026-11-07T23:30:00Z"), timezone: "Europe/Berlin" };
    // 00:30 on the 8th in Berlin: the holiday has ended.
    expect(buildChecklist({ ...late, away: [holiday] }, [], 0, new Date()).some((i) => i.label === "Act has said they can't play that day")).toBe(false);
  });
});
