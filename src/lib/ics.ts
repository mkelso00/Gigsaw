// Minimal iCalendar (RFC 5545) writer for the subscribable calendar feeds (acts, venues and staff).
// Calendar apps match events by UID, so each booking keeps the same UID for life: a changed gig
// replaces the old event rather than adding a second one, and a gig left out of the feed disappears.

import { createHash } from "node:crypto";
import { isValidTimeZone, tzOffsetMs, zonedParts, zoneLabel } from "./time";

/** Escape a TEXT value: backslash, semicolon, comma and new lines. */
export function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 20261121T190000Z */
function stamp(d: Date) {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** 20261121T190000 as the clock reads in a time zone. */
function localStamp(d: Date, timeZone: string) {
  const p = zonedParts(d, timeZone);
  return `${p.year}${pad(p.month)}${pad(p.day)}T${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`;
}

/** Lines longer than 75 octets must be folded. */
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n");
}

/** A real zone other than UTC (UTC times need no VTIMEZONE). */
const validZone = (tz: string | undefined): tz is string => !!tz && tz !== "UTC" && tz !== "Etc/UTC" && isValidTimeZone(tz);

const MINUTE = 60_000;
const DAY = 86_400_000;
const offsetMinutes = (t: number, tz: string) => Math.round(tzOffsetMs(new Date(t), tz) / MINUTE);
const fmtOffset = (min: number) => `${min < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(min) / 60))}${pad(Math.abs(min) % 60)}`;
const floating = (ms: number) => stamp(new Date(ms)).replace(/Z$/, "");

/**
 * A VTIMEZONE for an IANA zone covering [from, to]: the offset at the start, then each change of
 * the clocks (found with Intl, to the minute), so calendar apps show the times we meant.
 */
export function vtimezone(tz: string, from: Date, to: Date): string[] {
  const start = Math.floor(from.getTime() / MINUTE) * MINUTE;
  const end = Math.ceil(to.getTime() / MINUTE) * MINUTE;
  const first = offsetMinutes(start, tz);
  // Daylight saving if the clocks are further ahead now than at some point in the year ahead.
  const lowest = Math.min(...[91, 182, 273].map((d) => offsetMinutes(start + d * DAY, tz)));
  const parts: { at: number; from: number; to: number; daylight: boolean }[] = [{ at: start, from: first, to: first, daylight: first > lowest }];
  let off = first;
  for (let t = start; t < end; t += DAY) {
    const next = Math.min(t + DAY, end);
    const o = offsetMinutes(next, tz);
    if (o === off) continue;
    // The clocks changed in this day: narrow it down to the minute.
    let lo = t;
    let hi = next;
    while (hi - lo > MINUTE) {
      const mid = lo + Math.max(1, Math.floor((hi - lo) / MINUTE / 2)) * MINUTE;
      if (offsetMinutes(mid, tz) === off) lo = mid;
      else hi = mid;
    }
    parts.push({ at: hi, from: off, to: o, daylight: o > off });
    off = o;
  }
  const lines = ["BEGIN:VTIMEZONE", `TZID:${tz}`, `X-LIC-LOCATION:${tz}`];
  for (const p of parts) {
    const kind = p.daylight ? "DAYLIGHT" : "STANDARD";
    lines.push(
      `BEGIN:${kind}`,
      // The moment of the change, as the clock read just before it.
      `DTSTART:${floating(p.at + p.from * MINUTE)}`,
      `TZOFFSETFROM:${fmtOffset(p.from)}`,
      `TZOFFSETTO:${fmtOffset(p.to)}`,
      `TZNAME:${esc(zoneLabel(new Date(p.at), tz))}`,
      `END:${kind}`,
    );
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

export type IcsEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location?: string;
  description?: string;
  url?: string;
  updated: Date;
  cancelled?: boolean;
};

/** Revision number for an event: minutes since 2024, so it only ever goes up as the booking changes. */
function sequence(updated: Date) {
  return Math.max(0, Math.floor((updated.getTime() - Date.UTC(2024, 0, 1)) / MINUTE));
}

/**
 * The feed. With `timezone`, times are written in that zone (with its VTIMEZONE), so calendars
 * show them as the agency sees them; otherwise in UTC.
 */
export function buildIcs(name: string, events: IcsEvent[], opts: { timezone?: string } = {}): string {
  const tz = validZone(opts.timezone) ? opts.timezone : undefined;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gigsaw//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    `X-WR-TIMEZONE:${tz ?? "UTC"}`,
    // How often to check for changes, for the apps that take a hint (Apple, Outlook).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  if (tz && events.length) {
    const from = Math.min(...events.map((e) => e.start.getTime()));
    const to = Math.max(...events.map((e) => e.end.getTime()));
    lines.push(...vtimezone(tz, new Date(from - DAY), new Date(to + DAY)));
  }
  const when = (prop: string, d: Date) => (tz ? `${prop};TZID=${tz}:${localStamp(d, tz)}` : `${prop}:${stamp(d)}`);
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(e.updated)}`,
      `LAST-MODIFIED:${stamp(e.updated)}`,
      `SEQUENCE:${sequence(e.updated)}`,
      when("DTSTART", e.start),
      when("DTEND", e.end),
      `SUMMARY:${esc(e.summary)}`,
    );
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push(`STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/**
 * Sends a feed with headers calendar apps and caches understand: private (the link is a secret),
 * a short max-age, and an ETag so an unchanged feed is a quick 304.
 */
export function icsResponse(req: Request, body: string, opts: { filename?: string; lastModified?: Date } = {}) {
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 32)}"`;
  const headers: Record<string, string> = {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `inline; filename="${opts.filename ?? "gigsaw.ics"}"`,
    "Cache-Control": "private, max-age=300, must-revalidate",
    ETag: etag,
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
  };
  if (opts.lastModified) headers["Last-Modified"] = opts.lastModified.toUTCString();
  const match = req.headers.get("if-none-match");
  if (match && match.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
