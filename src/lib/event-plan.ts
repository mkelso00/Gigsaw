// Weddings and events: the standard checklist and when the automatic emails go
// (pure, so it can be unit tested).

import { addDaysToKey } from "./time";

export type TaskKey = "CONTRACT" | "DEPOSIT" | "PLANNER" | "BALANCE" | "ITINERARY" | "THANKS";

/** The checklist every new wedding or event starts with. Due dates count back from the event day. */
export function defaultTasks(type: string, date: string): { key: TaskKey; title: string; dueDate: string | null; sort: number }[] {
  const who = type === "WEDDING" ? "the couple" : "the customer";
  return [
    { key: "CONTRACT", title: "Contract sent and signed", dueDate: null, sort: 1 },
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
