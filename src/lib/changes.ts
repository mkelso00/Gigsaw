// Works out what changed on a booking, in words an artist understands.
import { BOOKING_STATUS_LABELS, type BookingStatus } from "./constants";
import { formatMoney } from "./money";
import { formatDate, localDateKey, localTime } from "./time";

export type BookingSnapshot = {
  status: string;
  timezone: string;
  arriveBy: Date;
  soundcheckAt: Date | null;
  setStart: Date;
  setEnd: Date | null;
  venueName: string | null;
  /** What the artist is paid for the gig, in minor units. */
  artistFeeMinor: number;
  currency: string;
};

export type Change = [label: string, from: string, to: string];

export function describeChanges(before: BookingSnapshot, after: BookingSnapshot): Change[] {
  const out: Change[] = [];
  const tz = after.timezone;
  const t = (d: Date | null) => (d ? localTime(d, tz) : "");
  if (before.status !== after.status) {
    const label = (s: string) => BOOKING_STATUS_LABELS[s as BookingStatus] ?? s;
    out.push(["Status", label(before.status), label(after.status)]);
  }
  if (localDateKey(before.arriveBy, tz) !== localDateKey(after.arriveBy, tz)) {
    out.push(["Date", formatDate(before.arriveBy, tz), formatDate(after.arriveBy, tz)]);
  }
  if ((before.venueName ?? "") !== (after.venueName ?? "")) out.push(["Venue", before.venueName ?? "", after.venueName ?? ""]);
  const times: [string, Date | null, Date | null][] = [
    ["Arrive by", before.arriveBy, after.arriveBy],
    ["Soundcheck", before.soundcheckAt, after.soundcheckAt],
    ["On stage", before.setStart, after.setStart],
    ["Off stage", before.setEnd, after.setEnd],
  ];
  for (const [label, a, b] of times) {
    if ((a?.getTime() ?? null) !== (b?.getTime() ?? null)) out.push([label, t(a), t(b)]);
  }
  if (before.artistFeeMinor !== after.artistFeeMinor || before.currency !== after.currency) {
    out.push(["Your fee", formatMoney(before.artistFeeMinor, before.currency), formatMoney(after.artistFeeMinor, after.currency)]);
  }
  return out;
}
