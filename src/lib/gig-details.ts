import type { Prisma } from "@prisma/client";
import { planRows, type PlanExtraField } from "./event-plan";
import { localTime } from "./time";

// The words of a gig's calendar event, shared by the act, staff and venue feeds and the acts'
// Google and Outlook calendars. Plain text, as calendar apps show it: one "Label: value" per line,
// a blank line between groups, and nothing at all for a field nobody filled in, so a sparse booking
// gives a short event rather than a list of empty labels. Who sees which fields (and which money)
// is decided by the feed's own builder, not here.

type Value = string | null | undefined | false;

/** "Label: value", or the label on its own line above a value that runs over several lines. Blank values give "". */
export function detailLine(label: string, value: Value): string {
  const v = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  if (!v) return "";
  return v.includes("\n") ? `${label}:\n${v}` : `${label}: ${v}`;
}

/** Groups of lines into one description: empty lines and empty groups dropped, a blank line between groups. */
export function detailText(groups: Value[][]): string {
  return groups
    .map((g) => g.filter((l): l is string => typeof l === "string" && !!l).join("\n"))
    .filter(Boolean)
    .join("\n\n");
}

/** Arrive by, soundcheck, on stage and finish, in the venue's time. `zoneNote` follows the arrival time, e.g. " (Europe/Paris time)". */
export function timeLines(b: { arriveBy: Date; soundcheckAt?: Date | null; setStart: Date; setEnd?: Date | null; timezone: string }, zoneNote = ""): string[] {
  const t = (d: Date) => localTime(d, b.timezone);
  return [
    detailLine("Arrive by", `${t(b.arriveBy)}${zoneNote}`),
    b.soundcheckAt ? detailLine("Soundcheck", t(b.soundcheckAt)) : "",
    detailLine("On stage", t(b.setStart)),
    b.setEnd ? detailLine("Finish", t(b.setEnd)) : "",
  ];
}

/** The venue as one line: name, address, town, country. */
export function venueText(v: { name: string; address: string; city: string; country: string } | null | undefined) {
  return v ? [v.name, v.address, v.city, v.country].filter((s) => s.trim()).join(", ") : "";
}

/** The wedding or event plan columns every feed reads. The event's own `notes` are agency only and aren't here. */
export const EVENT_PLAN_SELECT = {
  name: true,
  type: true,
  venueText: true,
  guestCount: true,
  timeline: true,
  dayContact: true,
  arrivalInfo: true,
  dressCode: true,
  meals: true,
  songRequests: true,
  specialNotes: true,
  planExtras: true,
  updatedAt: true,
} satisfies Prisma.EventSelect;

export type EventPlan = Prisma.EventGetPayload<{ select: typeof EVENT_PLAN_SELECT }>;

/**
 * The wedding or event plan, as the act's gig page shows it: the event, guests, then every filled-in plan field
 * (the built-in ones, then the business's own from Settings). Never anything about money (planRows).
 */
export function eventPlanLines(event: EventPlan | null | undefined, extras: PlanExtraField[]): string[] {
  if (!event) return [];
  return [
    detailLine(event.type === "WEDDING" ? "Wedding" : "Event", event.name),
    event.guestCount ? detailLine("Guests", String(event.guestCount)) : "",
    ...planRows(event, extras).map(([label, value]) => detailLine(label, value)),
  ];
}

/** When the event last changed: the booking, or its wedding or event plan, which the description also shows. */
export function changedAt(b: { updatedAt: Date; event?: { updatedAt: Date } | null }) {
  return b.event && b.event.updatedAt > b.updatedAt ? b.event.updatedAt : b.updatedAt;
}

/**
 * Keeps a description within a calendar provider's limit (Google's is about 8,000 characters). Long free text
 * (a running order, say) is cut at the end, but the link to the gig is kept, since that's where to read the rest.
 */
export function fitDescription(text: string, max: number, tail: string): string {
  if (text.length <= max) return text;
  const note = "\n…\n\n";
  const room = Math.max(0, max - tail.length - note.length);
  return `${text.slice(0, room).trimEnd()}${note}${tail}`;
}
