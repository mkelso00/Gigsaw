// Report periods: a week (Monday to Sunday), a month or a year around a chosen date,
// worked out on plain YYYY-MM-DD date keys so time zones never shift a day.

import { addDaysToKey } from "./time";

export const PERIODS = ["week", "month", "year"] as const;
export type Period = (typeof PERIODS)[number];

export type Bucket = { from: string; to: string; label: string };

const parts = (key: string) => key.split("-").map(Number) as [number, number, number];
const keyOf = (d: Date) => d.toISOString().slice(0, 10);
const shortDate = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The Monday of the week holding this date. */
export function weekStart(key: string): string {
  const [y, m, d] = parts(key);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDaysToKey(key, -((dow + 6) % 7));
}

/** First and last day of the week, month or year holding this date, and a label for it. */
export function periodRange(period: Period, key: string): Bucket {
  const [y, m] = parts(key);
  if (period === "week") {
    const from = weekStart(key);
    const to = addDaysToKey(from, 6);
    return { from, to, label: `${shortDate(from)} to ${shortDate(to)} ${to.slice(0, 4)}` };
  }
  if (period === "month") {
    const from = keyOf(new Date(Date.UTC(y, m - 1, 1)));
    const to = keyOf(new Date(Date.UTC(y, m, 0)));
    return { from, to, label: new Date(`${from}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
}

/** A date in the period n steps before (negative) or after this one. */
export function shiftPeriod(period: Period, key: string, n: number): string {
  const [y, m] = parts(key);
  if (period === "week") return addDaysToKey(weekStart(key), 7 * n);
  if (period === "month") return keyOf(new Date(Date.UTC(y, m - 1 + n, 1)));
  return `${y + n}-01-01`;
}

/** How the period breaks down: a week by day, a month by week (cut to the month), a year by month. */
export function periodBuckets(period: Period, key: string): Bucket[] {
  const { from, to } = periodRange(period, key);
  const out: Bucket[] = [];
  if (period === "week") {
    for (let d = from; d <= to; d = addDaysToKey(d, 1)) {
      out.push({
        from: d,
        to: d,
        label: new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
      });
    }
  } else if (period === "month") {
    for (let s = from; s <= to; s = addDaysToKey(weekStart(s), 7)) {
      const e = addDaysToKey(weekStart(s), 6) < to ? addDaysToKey(weekStart(s), 6) : to;
      out.push({ from: s, to: e, label: s === e ? shortDate(s) : `${shortDate(s)} to ${shortDate(e)}` });
    }
  } else {
    const y = Number(from.slice(0, 4));
    for (let i = 0; i < 12; i++) {
      const s = keyOf(new Date(Date.UTC(y, i, 1)));
      out.push({
        from: s,
        to: keyOf(new Date(Date.UTC(y, i + 1, 0))),
        label: new Date(`${s}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" }),
      });
    }
  }
  return out;
}
