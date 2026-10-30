// Act availability: dates an act has blocked out (holiday, other work), and "Are you free?"
// requests sent to several acts for one date. Plain functions only, so they can be tested and
// used on both the server and in the browser.

import { isDateKey } from "./rota";

/** A run of whole days an act can't play, both ends included ("YYYY-MM-DD"). */
export type AwayBlock = { artistId: string; startDate: string; endDate: string; note: string };

/** The longest stretch that can be blocked out in one go. */
export const MAX_AWAY_DAYS = 366;

export const REPLY_LABELS = { YES: "Free", NO: "Not free" } as const;
export type ReplyAnswer = keyof typeof REPLY_LABELS;

export function isAnswer(s: string): s is ReplyAnswer {
  return s === "YES" || s === "NO";
}

/** Whole days from one date key to another (positive when `to` is later). */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Check a range typed into the "Can't play" form. An empty end date means just the one day.
 * Returns the range, or a message to show.
 */
export function checkAwayRange(start: string, end: string, today: string): { startDate: string; endDate: string } | { error: string } {
  if (!isDateKey(start)) return { error: "Choose the first day they can't play" };
  const endDate = end ? end : start;
  if (!isDateKey(endDate)) return { error: "Choose the last day they can't play" };
  if (endDate < start) return { error: "The last day can't be before the first day" };
  if (endDate < today) return { error: "Those dates have already passed" };
  if (daysBetween(start, endDate) + 1 > MAX_AWAY_DAYS) return { error: "Block out up to a year at a time" };
  return { startDate: start, endDate };
}

export function coversDate(b: Pick<AwayBlock, "startDate" | "endDate">, dateKey: string) {
  return b.startDate <= dateKey && dateKey <= b.endDate;
}

/** Blocks that include this date, optionally only for some acts. */
export function blocksOn<T extends AwayBlock>(blocks: T[], dateKey: string, actIds?: Iterable<string>): T[] {
  const only = actIds ? new Set(actIds) : null;
  return blocks.filter((b) => coversDate(b, dateKey) && (!only || only.has(b.artistId)));
}

/**
 * Who is away on a date, by act id. `bandsOf` gives the bands an act is part of, so a band is
 * away while any act inside it is. Each act maps to the first block that covers the date.
 */
export function awayOn<T extends AwayBlock>(blocks: T[], dateKey: string, bandsOf: (actId: string) => Iterable<string> = () => []) {
  const out = new Map<string, T>();
  for (const b of blocksOn(blocks, dateKey)) {
    for (const id of [b.artistId, ...bandsOf(b.artistId)]) if (!out.has(id)) out.set(id, b);
  }
  return out;
}

const monthDay = (key: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

/** A short date range: "Sat, 7 Nov 2026", "1–7 Nov 2026", "28 Oct – 3 Nov 2026" or "28 Dec 2026 – 2 Jan 2027". */
export function formatRange(start: string, end: string) {
  if (start === end) return monthDay(start, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const [sy, sm] = start.split("-");
  const [ey, em] = end.split("-");
  const endText = monthDay(end, { day: "numeric", month: "short", year: "numeric" });
  if (sy === ey && sm === em) return `${Number(start.slice(8))}–${endText}`;
  if (sy === ey) return `${monthDay(start, { day: "numeric", month: "short" })} – ${endText}`;
  return `${monthDay(start, { day: "numeric", month: "short", year: "numeric" })} – ${endText}`;
}

/** "Ellie Rose can't play 1–7 Nov 2026 (Holiday)." for warnings and the checklist. */
export function describeAway(actName: string, b: Pick<AwayBlock, "startDate" | "endDate" | "note">) {
  return `${actName} can't play ${formatRange(b.startDate, b.endDate)}${b.note.trim() ? ` (${b.note.trim()})` : ""}.`;
}

/**
 * The same for a block that may belong to an act inside a band: "Graham McKee Solo (in
 * Wonderlust) can't play 1–7 Nov 2026 (Holiday)."
 */
export function awayLine(actName: string, b: Pick<AwayBlock, "startDate" | "endDate" | "note"> & { own?: boolean; actName?: string }) {
  return describeAway(b.own === false && b.actName ? `${b.actName} (in ${actName})` : actName, b);
}

/** Number of days in a block, for "3 days". */
export function blockLength(b: Pick<AwayBlock, "startDate" | "endDate">) {
  return daysBetween(b.startDate, b.endDate) + 1;
}

/** The times part of a request, e.g. "on 19:00–21:00, arrive 18:30", or "" when no times were given. */
export function requestTimes(r: { arriveTime: string; startTime: string; endTime: string }) {
  if (!r.startTime) return r.arriveTime ? `arrive ${r.arriveTime}` : "";
  const on = `on ${r.startTime}${r.endTime ? `–${r.endTime}` : ""}`;
  return r.arriveTime && r.arriveTime !== r.startTime ? `${on}, arrive ${r.arriveTime}` : on;
}

/** How the answers stand: free, not free and still waiting. */
export function replyCounts(replies: { answer: string | null }[]) {
  let yes = 0;
  let no = 0;
  for (const r of replies) {
    if (r.answer === "YES") yes++;
    else if (r.answer === "NO") no++;
  }
  return { yes, no, waiting: replies.length - yes - no };
}

/** Free first, then waiting, then not free; by name within each. */
export function sortReplies<T extends { answer: string | null; artist: { name: string } }>(replies: T[]) {
  const rank = (a: string | null) => (a === "YES" ? 0 : a === "NO" ? 2 : 1);
  return [...replies].sort((x, y) => rank(x.answer) - rank(y.answer) || x.artist.name.localeCompare(y.artist.name));
}

/**
 * Whether an act can still answer: the request is open and its date hasn't passed. Acts can
 * change their answer until then.
 */
export function canAnswer(r: { date: string; closedAt: Date | null }, today: string) {
  return !r.closedAt && r.date >= today;
}
