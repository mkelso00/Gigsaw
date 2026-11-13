import { describe, expect, it } from "vitest";
import { daysBetween, defaultTasks, eventMessagesDue, extraFieldsFromText, MAX_EXTRA_FIELDS, parseExtraFields, parsePlanExtras, planFieldsFor, planRows, readPlanForm } from "@/lib/event-plan";

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

describe("the business's own plan fields", () => {
  let n = 0;
  const newId = () => `id${String(++n).padStart(4, "0")}`;
  const blank = { timeline: "", dayContact: "", arrivalInfo: "", dressCode: "", meals: "", songRequests: "", specialNotes: "" };

  it("reads one label per line, keeps ids for labels already there, drops blanks and duplicates", () => {
    const first = extraFieldsFromText("Ceremony time\n\n  Wedding   schedule \nceremony TIME", [], newId);
    expect(first.map((f) => f.label)).toEqual(["Ceremony time", "Wedding schedule"]);
    const again = extraFieldsFromText("Wedding schedule\nFirst dance song\nCeremony time", first, newId);
    expect(again.find((f) => f.label === "Ceremony time")!.id).toBe(first[0].id);
    expect(again.find((f) => f.label === "Wedding schedule")!.id).toBe(first[1].id);
    expect(again.find((f) => f.label === "First dance song")!.id).not.toBe(first[0].id);
  });

  it("stops at the limit and trims long labels", () => {
    const many = extraFieldsFromText(Array.from({ length: 30 }, (_, i) => `Field ${i}`).join("\n"), [], newId);
    expect(many).toHaveLength(MAX_EXTRA_FIELDS);
    expect(extraFieldsFromText("x".repeat(100), [], newId)[0].label).toHaveLength(60);
  });

  it("ignores malformed stored data", () => {
    expect(parseExtraFields(null)).toEqual([]);
    expect(parseExtraFields([{ id: "bad id!", label: "x" }, { id: "abcd1234", label: "  Ok  " }, { id: "abcd5678" }])).toEqual([{ id: "abcd1234", label: "Ok" }]);
    expect(parsePlanExtras({ a: "yes", b: 3, c: null })).toEqual({ a: "yes" });
    expect(parsePlanExtras([])).toEqual({});
  });

  it("puts the business's fields after the built-in ones and only shows filled-in rows", () => {
    const extras = [
      { id: "aaaa1111", label: "Ceremony time" },
      { id: "bbbb2222", label: "Wedding schedule" },
    ];
    const event = { ...blank, timeline: "Ceremony 1pm", planExtras: { aaaa1111: "13:00" } };
    expect(planFieldsFor(event, extras).map((f) => f.name).slice(-2)).toEqual(["extra_aaaa1111", "extra_bbbb2222"]);
    expect(planRows(event, extras)).toEqual([
      ["Running order", "Ceremony 1pm"],
      ["Ceremony time", "13:00"],
    ]);
  });

  it("reads a plan form into columns and extras, leaving empty extras out", () => {
    const extras = [
      { id: "aaaa1111", label: "Ceremony time" },
      { id: "bbbb2222", label: "Wedding schedule" },
    ];
    const values: Record<string, string> = { timeline: "Drinks 3pm", extra_aaaa1111: "13:00", extra_bbbb2222: "" };
    const { columns, planExtras } = readPlanForm((k) => values[k] ?? "", extras);
    expect(columns.timeline).toBe("Drinks 3pm");
    expect(planExtras).toEqual({ aaaa1111: "13:00" });
  });
});
