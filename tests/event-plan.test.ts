import { describe, expect, it } from "vitest";
import {
  balanceDueDate,
  daysBetween,
  defaultTasks,
  EVENT_STEPS,
  eventMessagesDue,
  extraFieldsFromText,
  isSecured,
  JOURNEY_LIVE,
  journeySecured,
  missedAtLaunch,
  JOURNEY_LOOKAHEAD_DAYS,
  MAX_EXTRA_FIELDS,
  parseExtraFields,
  parsePlanExtras,
  planFieldsFor,
  plannerDueDate,
  planRows,
  readPlanForm,
  stageOn,
  stepWindow,
  timeToGo,
} from "@/lib/event-plan";

describe("defaultTasks", () => {
  it("counts due dates back from the event day: the planner 4 weeks before, the balance 3 calendar months before", () => {
    const tasks = defaultTasks("WEDDING", "2027-06-12");
    expect(tasks.find((t) => t.key === "PLANNER")?.dueDate).toBe("2027-05-15");
    expect(tasks.find((t) => t.key === "BALANCE")?.dueDate).toBe("2027-03-12");
    expect(tasks.find((t) => t.key === "ITINERARY")?.dueDate).toBe("2027-06-05");
    expect(tasks.find((t) => t.key === "THANKS")?.dueDate).toBe("2027-06-14");
    expect(balanceDueDate("2027-06-12")).toBe("2027-03-12");
    expect(balanceDueDate("2027-05-31")).toBe("2027-02-28");
    expect(plannerDueDate("2027-06-12")).toBe("2027-05-15");
    expect(tasks.find((t) => t.key === "PLANNER")?.title).toMatch(/the couple/);
    expect(defaultTasks("CORPORATE", "2027-06-12").find((t) => t.key === "PLANNER")?.title).toMatch(/the customer/);
  });
});

describe("eventMessagesDue: the wedding journey", () => {
  it("starts 6 months out: the planner link with a payment summary, and a notice to the coordinator", () => {
    expect(eventMessagesDue(190)).toEqual([]);
    expect(eventMessagesDue(183)).toEqual([]);
    expect(eventMessagesDue(182)).toEqual(["PLANNER_REQUEST", "TEAM_SIX_MONTHS"]);
    expect(eventMessagesDue(93)).toEqual(["PLANNER_REQUEST", "TEAM_SIX_MONTHS"]);
  });
  it("at 3 months: the balance, a planner nudge and the coordinator's summary, and nothing to the acts", () => {
    expect(eventMessagesDue(92)).toEqual(["BALANCE_REMINDER", "PLANNER_CHASE", "TEAM_THREE_MONTHS"]);
    expect(eventMessagesDue(29)).toEqual(["BALANCE_REMINDER", "PLANNER_CHASE", "TEAM_THREE_MONTHS"]);
    expect(eventMessagesDue(60)).not.toContain("ACT_DETAILS");
  });
  it("at 4 weeks, when the planner is due: the last call and a notice", () => {
    expect(eventMessagesDue(28)).toEqual(["PLANNER_FINAL", "TEAM_PLANNER_LATE"]);
    expect(eventMessagesDue(8)).toEqual(["PLANNER_FINAL", "TEAM_PLANNER_LATE"]);
  });
  it("a week before: 'we can't wait' to the couple and the final details to the acts", () => {
    expect(eventMessagesDue(7)).toEqual(["WEEK_TO_GO", "ACT_DETAILS"]);
    expect(eventMessagesDue(0)).toEqual(["WEEK_TO_GO", "ACT_DETAILS"]);
  });
  it("says thank you the day after, for up to a week", () => {
    expect(eventMessagesDue(-1)).toEqual(["THANKS"]);
    expect(eventMessagesDue(-7)).toEqual(["THANKS"]);
    expect(eventMessagesDue(-8)).toEqual([]);
  });
  it("only ever has one stage live, so a late booking never gets the earlier stages at once", () => {
    for (let d = -10; d <= 200; d++) {
      const stages = new Set(eventMessagesDue(d).map((k) => EVENT_STEPS.find((s) => s.kind === k)!.stage));
      expect(stages.size).toBeLessThanOrEqual(1);
      expect(stageOn(d) ? [...stages] : []).toEqual(stageOn(d) ? [stageOn(d)] : []);
    }
    // Booked 2 months out: only the 3-month step is live, never the 6-month one.
    expect(eventMessagesDue(60)).not.toContain("PLANNER_REQUEST");
    expect(stepWindow("PLANNER_REQUEST")).toEqual({ from: 182, to: 93 });
    expect(stepWindow("THANKS")).toEqual({ from: -1, to: -7 });
    // The run looks far enough ahead for the first stage.
    expect(JOURNEY_LOOKAHEAD_DAYS).toBeGreaterThanOrEqual(stepWindow("PLANNER_REQUEST").from);
  });
});

describe("isSecured", () => {
  it("needs a gig past On hold and Enquiry", () => {
    expect(isSecured([])).toBe(false);
    expect(isSecured([{ status: "HOLD" }, { status: "ENQUIRY" }, { status: "CANCELLED" }])).toBe(false);
    expect(isSecured([{ status: "HOLD" }, { status: "CONFIRMED" }])).toBe(true);
    expect(isSecured([{ status: "PENDING" }])).toBe(true);
    expect(isSecured([{ status: "SETTLED" }])).toBe(true);
  });
});

describe("the 3-month stage and the balance date", () => {
  it("opens on or before the balance date (3 calendar months before) for every day of the year", () => {
    for (let d = 0; d < 800; d++) {
      const date = new Date(Date.UTC(2027, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
      const due = daysBetween(balanceDueDate(date), date);
      expect(due).toBeGreaterThanOrEqual(89);
      expect(stageOn(due)).toBe("THREE_MONTHS");
    }
    // 14 August 2027: the balance is due 14 May, 92 days before, and the 3-month emails go that day.
    expect(balanceDueDate("2027-08-14")).toBe("2027-05-14");
    expect(stageOn(daysBetween("2027-05-14", "2027-08-14"))).toBe("THREE_MONTHS");
    expect(stageOn(daysBetween("2027-05-13", "2027-08-14"))).toBe("SIX_MONTHS");
  });
});

describe("journeySecured: whether the schedule may go", () => {
  const after = new Date(JOURNEY_LIVE.getTime() + 86_400_000);
  const before = new Date(JOURNEY_LIVE.getTime() - 86_400_000);
  const wedding = (o: { createdAt: Date; gateAt?: Date | null; statuses: string[] }) => ({
    type: "WEDDING",
    createdAt: o.createdAt,
    gateAt: o.gateAt ?? null,
    bookings: o.statuses.map((status) => ({ status })),
  });
  it("a wedding needs the gate: a Pending or Confirmed gig alone doesn't do", () => {
    expect(journeySecured(wedding({ createdAt: after, statuses: ["PENDING"] }))).toBe(false);
    expect(journeySecured(wedding({ createdAt: after, statuses: ["CONFIRMED"] }), "ACT_DETAILS")).toBe(false);
    expect(journeySecured(wedding({ createdAt: after, statuses: ["HOLD"], gateAt: after }))).toBe(true);
    expect(journeySecured(wedding({ createdAt: after, statuses: ["HOLD"], gateAt: after }), "ACT_DETAILS")).toBe(true);
  });
  it("a wedding from before the journey counts as before, and still gets its thank-you with only On hold gigs", () => {
    expect(journeySecured(wedding({ createdAt: before, statuses: ["PENDING"] }))).toBe(true);
    expect(journeySecured(wedding({ createdAt: before, statuses: ["HOLD"] }))).toBe(false);
    expect(journeySecured(wedding({ createdAt: before, statuses: ["HOLD"] }), "THANKS")).toBe(true);
    expect(journeySecured(wedding({ createdAt: before, statuses: [] }), "THANKS")).toBe(false);
  });
  it("other events keep the status test, and their acts' details don't wait", () => {
    const party = { type: "PRIVATE", createdAt: after, gateAt: null, bookings: [{ status: "HOLD" }] };
    expect(journeySecured(party)).toBe(false);
    expect(journeySecured(party, "ACT_DETAILS")).toBe(true);
    expect(journeySecured({ ...party, bookings: [{ status: "PENDING" }] })).toBe(true);
  });
  it("counts what was missed at the start from when a wedding was secured, if it has been", () => {
    const old = { createdAt: new Date("2026-10-01T10:00:00Z"), date: "2027-04-07" }; // in the 6-month stage at the start
    expect(missedAtLaunch(old, "PLANNER_REQUEST")).toBe(true);
    expect(missedAtLaunch({ ...old, gateAt: after }, "PLANNER_REQUEST")).toBe(false);
  });
});

describe("timeToGo", () => {
  it("reads naturally", () => {
    expect(timeToGo(182)).toBe("6 months");
    expect(timeToGo(91)).toBe("3 months");
    expect(timeToGo(60)).toBe("2 months");
    expect(timeToGo(28)).toBe("4 weeks");
    expect(timeToGo(7)).toBe("7 days");
    expect(timeToGo(1)).toBe("1 day");
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
    expect(parseExtraFields([{ id: "bad id!", label: "x" }, { id: "abcd1234", label: "  Ok  " }, { id: "abcd5678" }])).toEqual([
      { id: "abcd1234", label: "Ok" },
    ]);
    expect(parsePlanExtras({ a: "yes", b: 3, c: null })).toEqual({ a: "yes" });
    expect(parsePlanExtras([])).toEqual({});
  });

  it("puts the business's fields after the built-in ones and only shows filled-in rows", () => {
    const extras = [
      { id: "aaaa1111", label: "Ceremony time" },
      { id: "bbbb2222", label: "Wedding schedule" },
    ];
    const event = { ...blank, timeline: "Ceremony 1pm", planExtras: { aaaa1111: "13:00" } };
    expect(
      planFieldsFor(event, extras)
        .map((f) => f.name)
        .slice(-2),
    ).toEqual(["extra_aaaa1111", "extra_bbbb2222"]);
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
