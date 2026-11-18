// Weddings and events: the standard checklist and when the automatic emails go
// (pure, so it can be unit tested).

import { addDaysToKey } from "./time";

export type TaskKey = "CONTRACT" | "DEPOSIT" | "PLANNER" | "BALANCE" | "ITINERARY" | "THANKS";

// The business's terms: the balance is due 3 months (13 weeks) before the day, and the running order
// and songs (the planner) at least 4 weeks before.
export const BALANCE_DUE_DAYS = 91;
export const PLANNER_DUE_DAYS = 28;

/** The day the balance is due: 3 months (13 weeks) before the event. Booked later than that, it's due on booking. */
export const balanceDueDate = (date: string) => addDaysToKey(date, -BALANCE_DUE_DAYS);
/** The day the running order and songs are due: 4 weeks before the event. */
export const plannerDueDate = (date: string) => addDaysToKey(date, -PLANNER_DUE_DAYS);

/** The checklist every new wedding or event starts with. Due dates count back from the event day. */
export function defaultTasks(type: string, date: string): { key: TaskKey; title: string; dueDate: string | null; sort: number }[] {
  const who = type === "WEDDING" ? "the couple" : "the customer";
  return [
    { key: "CONTRACT", title: "Proposal or contract signed", dueDate: null, sort: 1 },
    { key: "DEPOSIT", title: "Deposit received", dueDate: null, sort: 2 },
    { key: "PLANNER", title: `Details from ${who} (planner filled in)`, dueDate: plannerDueDate(date), sort: 3 },
    { key: "BALANCE", title: "Balance paid", dueDate: balanceDueDate(date), sort: 4 },
    { key: "ITINERARY", title: "Final details sent to the acts", dueDate: addDaysToKey(date, -7), sort: 5 },
    { key: "THANKS", title: "Thank-you and review request sent", dueDate: addDaysToKey(date, 2), sort: 6 },
  ];
}

// ---------- The automatic emails: the wedding journey ----------

/**
 * The stages of the journey, each with its sending window in days before the event (negative once it's
 * passed). The windows follow on from each other and never overlap, so on any day at most one stage is live.
 */
export const JOURNEY_STAGES = [
  { stage: "SIX_MONTHS", from: 182, to: BALANCE_DUE_DAYS + 1 },
  { stage: "THREE_MONTHS", from: BALANCE_DUE_DAYS, to: PLANNER_DUE_DAYS + 1 },
  { stage: "FOUR_WEEKS", from: PLANNER_DUE_DAYS, to: 8 },
  { stage: "ONE_WEEK", from: 7, to: 0 },
  { stage: "AFTER", from: -1, to: -7 },
] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number]["stage"];

/** How far ahead the every-minute run looks, in days: the first stage's window, plus a little. */
export const JOURNEY_LOOKAHEAD_DAYS = 190;

export type EventMessage =
  | "PLANNER_REQUEST"
  | "TEAM_SIX_MONTHS"
  | "BALANCE_REMINDER"
  | "PLANNER_CHASE"
  | "TEAM_THREE_MONTHS"
  | "PLANNER_FINAL"
  | "TEAM_PLANNER_LATE"
  | "WEEK_TO_GO"
  | "ACT_DETAILS"
  | "THANKS";

/** Who an automatic email goes to: the customer (the couple), the business's coordinator, or the acts. */
export type StepAudience = "CUSTOMER" | "TEAM" | "ACTS";

/**
 * Every automatic email, in the order they go (within a stage the customer's come first, so the
 * coordinator's notice can say what was just sent). `label` is what staff see on the wedding page.
 *  - 6 months: ask for the running order (planner link) with a payment summary; tell the coordinator.
 *  - 3 months: balance due (only what's owed to the business), a planner reminder if it isn't in, and
 *    the coordinator told what's missing, or that all is in hand. Nothing goes to the acts.
 *  - 4 weeks: the planner deadline. A last reminder to the customer and a notice to the coordinator, if it isn't in.
 *  - 1 week: "we can't wait" to the customer, and the final details to the acts.
 *  - After: thank you, with the review link.
 */
export const EVENT_STEPS: { kind: EventMessage; stage: JourneyStage; to: StepAudience; label: string }[] = [
  { kind: "PLANNER_REQUEST", stage: "SIX_MONTHS", to: "CUSTOMER", label: "Ask for the running order (planner link), with a payment summary" },
  { kind: "TEAM_SIX_MONTHS", stage: "SIX_MONTHS", to: "TEAM", label: "Notice to get in touch with them" },
  { kind: "BALANCE_REMINDER", stage: "THREE_MONTHS", to: "CUSTOMER", label: "Balance due, if anything is owed to you" },
  { kind: "PLANNER_CHASE", stage: "THREE_MONTHS", to: "CUSTOMER", label: "Reminder, if the planner isn't filled in" },
  { kind: "TEAM_THREE_MONTHS", stage: "THREE_MONTHS", to: "TEAM", label: "What's missing, or that all is in hand" },
  { kind: "PLANNER_FINAL", stage: "FOUR_WEEKS", to: "CUSTOMER", label: "Last call for the running order, if it isn't in" },
  { kind: "TEAM_PLANNER_LATE", stage: "FOUR_WEEKS", to: "TEAM", label: "Notice that the running order is still missing" },
  { kind: "WEEK_TO_GO", stage: "ONE_WEEK", to: "CUSTOMER", label: "“We can't wait!”" },
  { kind: "ACT_DETAILS", stage: "ONE_WEEK", to: "ACTS", label: "Final details: times, running order, contacts" },
  { kind: "THANKS", stage: "AFTER", to: "CUSTOMER", label: "Thank-you and review request" },
];

export const isEventMessage = (s: unknown): s is EventMessage => EVENT_STEPS.some((x) => x.kind === s);

/** The journey stage live this many days before the event, if any. */
export function stageOn(daysUntil: number): JourneyStage | null {
  return JOURNEY_STAGES.find((s) => daysUntil <= s.from && daysUntil >= s.to)?.stage ?? null;
}

/** A step's sending window, in days before the event: from `from` down to `to`. */
export function stepWindow(kind: EventMessage) {
  const stage = EVENT_STEPS.find((x) => x.kind === kind)!.stage;
  const { from, to } = JOURNEY_STAGES.find((s) => s.stage === stage)!;
  return { from, to };
}

/**
 * Which automatic emails are in their sending window, given how many days are left until the event
 * (negative once it's passed). Each is only ever sent once; the caller also checks whether it's still
 * needed (e.g. the planner isn't already filled in).
 *
 * Late bookings: a step only goes automatically inside its own stage's window, and the stages follow
 * on without overlapping, so only the stage live today can fire. A wedding booked (or secured) 2 months
 * out gets the 3-month emails straight away, and never the 6-month ones in a rush behind them: the
 * wedding page shows those as missed, with a Send now button. The first planner email a customer gets
 * always reads as a first ask (sendPlannerEmail), so a late booking's "reminder" never chases a link
 * they were never sent.
 */
export function eventMessagesDue(daysUntil: number): EventMessage[] {
  const stage = stageOn(daysUntil);
  return stage ? EVENT_STEPS.filter((x) => x.stage === stage).map((x) => x.kind) : [];
}

/**
 * Booking statuses that mean the customer's booking is secured. A proposal's gigs stay On hold (or
 * Enquiry) until the customer has signed and paid the deposit, so a wedding with nothing but those
 * isn't secured yet and its customer hears nothing automatic. Staff-made gigs start Pending, and an
 * offer to the act (Awaiting) or a confirmed or settled gig is past that point too.
 */
export const SECURED_STATUSES = ["PENDING", "AWAITING", "CONFIRMED", "SETTLED"] as const;

/** Whether a wedding or event is secured: at least one of its gigs is past On hold and Enquiry (and not cancelled). */
export function isSecured(bookings: { status: string }[]) {
  return bookings.some((b) => (SECURED_STATUSES as readonly string[]).includes(b.status));
}

/** "6 months", "9 weeks", "5 days": how long until the event, for emails to staff. */
export function timeToGo(days: number) {
  if (days >= 60) return `${Math.round(days / 30.44)} months`;
  if (days >= 14) return `${Math.round(days / 7)} weeks`;
  if (days === 1) return "1 day";
  return `${Math.max(0, days)} days`;
}

/** Whole days from one "YYYY-MM-DD" to another. */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** The details the customer fills in and the acts see. Never anything about money. */
export const PLAN_FIELDS = [
  ["timeline", "Running order", "Ceremony, drinks, meal, speeches, first dance, last song… with times"],
  ["dayContact", "Contact on the day", "Who the acts should ask for, and their mobile"],
  ["arrivalInfo", "Arrival, parking and load-in", "Where to park, how to get kit in, any access times"],
  ["dressCode", "Dress code", ""],
  ["meals", "Food and drink for the acts", ""],
  ["songRequests", "Song requests", "First dance, must-plays and anything you'd rather not hear"],
  ["specialNotes", "Anything else", "Surprises, guests with special needs, things to avoid"],
] as const;

// ---------- The business's own itinerary fields (Settings, Weddings and events) ----------

/** A field the business added to every wedding or event plan, e.g. "Ceremony time". Values live on Event.planExtras by id. */
export type PlanExtraField = { id: string; label: string };

export const MAX_EXTRA_FIELDS = 15;
const MAX_LABEL = 60;

/** Settings.planExtraFields, checked: anything malformed is dropped rather than trusted. */
export function parseExtraFields(json: unknown): PlanExtraField[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((f): f is PlanExtraField => !!f && typeof f.id === "string" && /^[a-z0-9]{4,16}$/.test(f.id) && typeof f.label === "string" && !!f.label.trim())
    .slice(0, MAX_EXTRA_FIELDS)
    .map((f) => ({ id: f.id, label: f.label.trim().slice(0, MAX_LABEL) }));
}

/**
 * The settings box (one label per line) back into fields. A label that was there before keeps its id, so
 * what's been filled in on events stays with it; a new label gets a new id. Duplicates are dropped.
 */
export function extraFieldsFromText(text: string, existing: PlanExtraField[], newId: () => string): PlanExtraField[] {
  const byLabel = new Map(existing.map((f) => [f.label.toLowerCase(), f.id]));
  const seen = new Set<string>();
  const out: PlanExtraField[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const label = raw.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push({ id: byLabel.get(label.toLowerCase()) ?? newId(), label });
    if (out.length === MAX_EXTRA_FIELDS) break;
  }
  return out;
}

/** Event.planExtras, checked: only string values, by field id. */
export function parsePlanExtras(json: unknown): Record<string, string> {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  return Object.fromEntries(Object.entries(json as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
}

type PlanColumns = { [K in (typeof PLAN_FIELDS)[number][0]]: string };

/** Every plan field in order, built-in first then the business's own: form name, label, hint and current value. */
export function planFieldsFor(event: PlanColumns & { planExtras?: unknown }, extras: PlanExtraField[]) {
  const values = parsePlanExtras(event.planExtras);
  return [
    ...PLAN_FIELDS.map(([k, label, hint]) => ({ name: k as string, label: label as string, hint: hint as string, value: event[k] ?? "" })),
    ...extras.map((f) => ({ name: `extra_${f.id}`, label: f.label, hint: "", value: values[f.id] ?? "" })),
  ];
}

/** The filled-in plan as label and value pairs, for the act's page and emails. Never anything about money. */
export function planRows(event: PlanColumns & { planExtras?: unknown }, extras: PlanExtraField[]): [string, string][] {
  return planFieldsFor(event, extras)
    .filter((f) => f.value.trim())
    .map((f) => [f.label, f.value]);
}

/** Read a plan form: the built-in columns, and planExtras with the values for the business's own fields. */
export function readPlanForm(get: (name: string) => string, extras: PlanExtraField[], maxLength = 5000) {
  const columns = Object.fromEntries(PLAN_FIELDS.map(([k]) => [k, get(k).slice(0, maxLength)])) as PlanColumns;
  const planExtras = Object.fromEntries(extras.map((f) => [f.id, get(`extra_${f.id}`).slice(0, maxLength)]).filter(([, v]) => v));
  return { columns, planExtras };
}

/**
 * What changed in a plan since the acts were last sent it: each changed or new field with its new value, and
 * each emptied one as "(removed)". `told` null means they've never been sent it, so everything counts as new.
 */
export function planChanges(rows: [string, string][], told: unknown): [string, string][] {
  const before = Array.isArray(told) ? new Map((told as [string, string][]).filter((r) => Array.isArray(r) && r.length === 2)) : null;
  if (!before) return rows;
  const now = new Map(rows);
  const out: [string, string][] = rows.filter(([k, v]) => before.get(k) !== v);
  for (const k of before.keys()) if (!now.has(k)) out.push([k, "(removed)"]);
  return out;
}
