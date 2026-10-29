import { describe, expect, it } from "vitest";
import { daysBetween, defaultTasks, eventMessagesDue } from "@/lib/event-plan";

describe("defaultTasks", () => {
  it("counts due dates back from the event day", () => {
    const tasks = defaultTasks("WEDDING", "2027-06-12");
    expect(tasks.find((t) => t.key === "PLANNER")?.dueDate).toBe("2027-05-01");
    expect(tasks.find((t) => t.key === "BALANCE")?.dueDate).toBe("2027-05-29");
    expect(tasks.find((t) => t.key === "PLANNER")?.title).toMatch(/the couple/);
    expect(defaultTasks("CORPORATE", "2027-06-12").find((t) => t.key === "PLANNER")?.title).toMatch(/the customer/);
  });
});

describe("eventMessagesDue", () => {
  it("asks for the planner 8 to 3 weeks out, then chases", () => {
    expect(eventMessagesDue(60)).toEqual([]);
    expect(eventMessagesDue(56)).toEqual(["PLANNER_REQUEST"]);
    expect(eventMessagesDue(21)).toEqual(["PLANNER_CHASE"]);
  });
  it("reminds about the balance in the last two weeks and sends act details from a week before", () => {
    expect(eventMessagesDue(14)).toEqual(["PLANNER_CHASE", "BALANCE_REMINDER"]);
    expect(eventMessagesDue(7)).toEqual(["BALANCE_REMINDER", "ACT_DETAILS"]);
    expect(eventMessagesDue(0)).toEqual(["ACT_DETAILS"]);
  });
  it("says thank you the day after, for up to a week", () => {
    expect(eventMessagesDue(-1)).toEqual(["THANKS"]);
    expect(eventMessagesDue(-8)).toEqual([]);
  });
});

describe("daysBetween", () => {
  it("counts whole days, across the clocks changing", () => {
    expect(daysBetween("2026-10-20", "2026-10-30")).toBe(10);
    expect(daysBetween("2026-10-30", "2026-10-29")).toBe(-1);
  });
});
