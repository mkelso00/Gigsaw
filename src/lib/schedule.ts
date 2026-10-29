import { addDaysToKey, zonedToUtc } from "./time";

export type LocalTimes = { arrive: string; soundcheck?: string | null; setStart: string; setEnd?: string | null };

/**
 * Turn a gig's local date and wall-clock times into UTC instants.
 * The date is the day of the call time. Each later time that is earlier on the clock than the
 * one before it rolls into the next day (e.g. arrive 22:00, on stage 01:00).
 */
export function buildSchedule(date: string, t: LocalTimes, timezone: string) {
  const arriveBy = zonedToUtc(date, t.arrive, timezone);
  const rollForward = (time: string, after: Date) => {
    let d = date;
    let at = zonedToUtc(d, time, timezone);
    // Add days in local time so a daylight saving change does not shift the clock time.
    while (at < after) {
      d = addDaysToKey(d, 1);
      at = zonedToUtc(d, time, timezone);
    }
    return at;
  };
  const soundcheckAt = t.soundcheck ? rollForward(t.soundcheck, arriveBy) : null;
  const setStart = rollForward(t.setStart, soundcheckAt ?? arriveBy);
  const setEnd = t.setEnd ? rollForward(t.setEnd, setStart) : null;
  return { arriveBy, soundcheckAt, setStart, setEnd };
}

/** Move every time in a schedule by the same number of minutes. */
export function shiftSchedule<T extends { arriveBy: Date; soundcheckAt: Date | null; setStart: Date; setEnd: Date | null }>(s: T, minutes: number) {
  const move = (d: Date | null) => (d ? new Date(d.getTime() + minutes * 60_000) : null);
  return { arriveBy: move(s.arriveBy)!, soundcheckAt: move(s.soundcheckAt), setStart: move(s.setStart)!, setEnd: move(s.setEnd) };
}
