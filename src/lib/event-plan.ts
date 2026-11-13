// Weddings and events: the standard checklist and when the automatic emails go
// (pure, so it can be unit tested).

import { addDaysToKey } from "./time";

export type TaskKey = "CONTRACT" | "DEPOSIT" | "PLANNER" | "BALANCE" | "ITINERARY" | "THANKS";

/** The checklist every new wedding or event starts with. Due dates count back from the event day. */
export function defaultTasks(type: string, date: string): { key: TaskKey; title: string; dueDate: string | null; sort: number }[] {
  const who = type === "WEDDING" ? "the couple" : "the customer";
  return [
    { key: "CONTRACT", title: "Proposal or contract signed", dueDate: null, sort: 1 },
    { key: "DEPOSIT", title: "Deposit received", dueDate: null, sort: 2 },
    { key: "PLANNER", title: `Details from ${who} (planner filled in)`, dueDate: addDaysToKey(date, -42), sort: 3 },
    { key: "BALANCE", title: "Balance paid", dueDate: addDaysToKey(date, -14), sort: 4 },
    { key: "ITINERARY", title: "Final details sent to the acts", dueDate: addDaysToKey(date, -7), sort: 5 },
    { key: "THANKS", title: "Thank-you and review request sent", dueDate: addDaysToKey(date, 2), sort: 6 },
  ];
}

export type EventMessage = "PLANNER_REQUEST" | "PLANNER_CHASE" | "BALANCE_REMINDER" | "ACT_DETAILS" | "THANKS";

/**
 * Which automatic emails are in their sending window, given how many days are left until the
 * event (negative once it's passed). Each is only ever sent once; the caller also checks
 * whether it's still needed (e.g. the planner isn't already filled in).
 *  - Planner request: 8 to 3 weeks before. Chase: 3 weeks to 1 week before.
 *  - Balance reminder: in the last 2 weeks, while money is owed.
 *  - Final details to the acts: from a week before.
 *  - Thank-you: the day after, up to a week later.
 */
export function eventMessagesDue(daysUntil: number): EventMessage[] {
  const out: EventMessage[] = [];
  if (daysUntil > 21 && daysUntil <= 56) out.push("PLANNER_REQUEST");
  if (daysUntil > 7 && daysUntil <= 21) out.push("PLANNER_CHASE");
  if (daysUntil > 0 && daysUntil <= 14) out.push("BALANCE_REMINDER");
  if (daysUntil >= 0 && daysUntil <= 7) out.push("ACT_DETAILS");
  if (daysUntil >= -7 && daysUntil <= -1) out.push("THANKS");
  return out;
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
