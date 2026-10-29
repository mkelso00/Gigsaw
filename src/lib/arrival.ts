// Arrival tracking: works out whether an artist has arrived at a gig, and whether they were on time.
// Everything here is pure so it can be unit tested and used on both server and client.

export type ArrivalState =
  | "CANCELLED" // booking is cancelled, nothing to track
  | "NOT_DUE" // gig is more than 12 hours away
  | "AWAITING" // gig is today and the call time has not passed yet
  | "ON_THE_WAY" // artist has said they are travelling, call time not passed
  | "OVERDUE" // call time (plus grace) has passed and nobody has checked in
  | "ARRIVED_ON_TIME"
  | "ARRIVED_LATE"
  | "NO_CHECK_IN"; // the gig is over and no arrival was ever recorded

export type LocationCheck = "ON_SITE" | "OFF_SITE" | "NO_LOCATION" | "NO_VENUE_LOCATION" | "LOGGED_BY_AGENT";

export type CheckInLike = {
  kind: string;
  at: Date;
  source: string;
  distanceM: number | null;
  etaMinutes: number | null;
};

export type ArrivalInput = {
  status: string;
  arriveBy: Date;
  setStart: Date;
  setEnd: Date | null;
  checkIns: CheckInLike[];
  venueHasLocation: boolean;
  now: Date;
  graceMinutes: number;
  geofenceMetres: number;
};

export type ArrivalSummary = {
  state: ArrivalState;
  arrivedAt: Date | null;
  /** Minutes after the call time the artist arrived. Negative means early. */
  minutesLate: number | null;
  /** Minutes the artist is currently overdue (only for OVERDUE). */
  minutesOverdue: number | null;
  location: LocationCheck | null;
  distanceM: number | null;
  /** Expected arrival time when the artist is on the way and gave an ETA. */
  expectedAt: Date | null;
  departedAt: Date | null;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** When we stop waiting for an arrival and call it "no check-in". */
export function gigOverAt(setStart: Date, setEnd: Date | null): Date {
  return setEnd && setEnd > setStart ? setEnd : new Date(setStart.getTime() + 3 * HOUR);
}

/** Check-ins are accepted from 12 hours before the call time until 6 hours after the gig ends. */
export function checkInWindow(arriveBy: Date, setStart: Date, setEnd: Date | null) {
  return {
    opensAt: new Date(arriveBy.getTime() - 12 * HOUR),
    closesAt: new Date(gigOverAt(setStart, setEnd).getTime() + 6 * HOUR),
  };
}

export function locationCheck(c: CheckInLike, venueHasLocation: boolean, geofenceMetres: number): LocationCheck {
  if (c.source === "AGENT") return "LOGGED_BY_AGENT";
  if (!venueHasLocation) return "NO_VENUE_LOCATION";
  if (c.distanceM === null) return "NO_LOCATION";
  return c.distanceM <= geofenceMetres ? "ON_SITE" : "OFF_SITE";
}

export function summariseArrival(input: ArrivalInput): ArrivalSummary {
  const sorted = [...input.checkIns].sort((a, b) => a.at.getTime() - b.at.getTime());
  const arrival = sorted.find((c) => c.kind === "ARRIVED") ?? null;
  const departure = sorted.find((c) => c.kind === "DEPARTED" && (!arrival || c.at >= arrival.at)) ?? null;
  const lastOnTheWay = [...sorted].reverse().find((c) => c.kind === "ON_THE_WAY") ?? null;

  const base: ArrivalSummary = {
    state: "NOT_DUE",
    arrivedAt: null,
    minutesLate: null,
    minutesOverdue: null,
    location: null,
    distanceM: null,
    expectedAt: null,
    departedAt: departure?.at ?? null,
  };

  if (arrival) {
    const minutesLate = Math.round((arrival.at.getTime() - input.arriveBy.getTime()) / MINUTE);
    return {
      ...base,
      state: minutesLate > input.graceMinutes ? "ARRIVED_LATE" : "ARRIVED_ON_TIME",
      arrivedAt: arrival.at,
      minutesLate,
      location: locationCheck(arrival, input.venueHasLocation, input.geofenceMetres),
      distanceM: arrival.distanceM,
    };
  }

  if (input.status === "CANCELLED") return { ...base, state: "CANCELLED" };

  const now = input.now.getTime();
  const lateFrom = input.arriveBy.getTime() + input.graceMinutes * MINUTE;
  const expectedAt =
    lastOnTheWay && lastOnTheWay.etaMinutes !== null
      ? new Date(lastOnTheWay.at.getTime() + lastOnTheWay.etaMinutes * MINUTE)
      : null;

  if (now > gigOverAt(input.setStart, input.setEnd).getTime()) {
    return { ...base, state: "NO_CHECK_IN" };
  }
  if (now > lateFrom) {
    return {
      ...base,
      state: "OVERDUE",
      minutesOverdue: Math.round((now - input.arriveBy.getTime()) / MINUTE),
      expectedAt,
    };
  }
  if (lastOnTheWay) return { ...base, state: "ON_THE_WAY", expectedAt };
  if (now >= input.arriveBy.getTime() - 12 * HOUR) return { ...base, state: "AWAITING" };
  return base;
}

export const ARRIVAL_STATE_LABELS: Record<ArrivalState, string> = {
  CANCELLED: "Cancelled",
  NOT_DUE: "Not due yet",
  AWAITING: "Awaiting arrival",
  ON_THE_WAY: "On the way",
  OVERDUE: "Overdue",
  ARRIVED_ON_TIME: "Arrived on time",
  ARRIVED_LATE: "Arrived late",
  NO_CHECK_IN: "No check-in",
};

export const ARRIVAL_STATE_STYLES: Record<ArrivalState, string> = {
  CANCELLED: "bg-slate-100 text-slate-500",
  NOT_DUE: "bg-slate-100 text-slate-600",
  AWAITING: "bg-sky-100 text-sky-800",
  ON_THE_WAY: "bg-indigo-100 text-indigo-800",
  OVERDUE: "bg-rose-600 text-white",
  ARRIVED_ON_TIME: "bg-emerald-100 text-emerald-800",
  ARRIVED_LATE: "bg-amber-100 text-amber-800",
  NO_CHECK_IN: "bg-rose-100 text-rose-800",
};

export const LOCATION_LABELS: Record<LocationCheck, string> = {
  ON_SITE: "Verified at venue",
  OFF_SITE: "Away from venue",
  NO_LOCATION: "Location not shared",
  NO_VENUE_LOCATION: "Venue has no map pin",
  LOGGED_BY_AGENT: "Logged by agency",
};

export type PunctualityStats = {
  tracked: number; // past gigs we expected an arrival for
  onTime: number;
  late: number;
  missing: number; // no check-in recorded
  onTimeRate: number | null; // 0..1
  averageMinutesLate: number | null; // across late arrivals only
  averageArrivalOffset: number | null; // across all arrivals, negative = early
  verifiedOnSite: number;
};

/** Punctuality across a set of arrival summaries (normally an artist's past gigs). */
export function punctuality(summaries: ArrivalSummary[]): PunctualityStats {
  let onTime = 0;
  let late = 0;
  let missing = 0;
  let verifiedOnSite = 0;
  let lateMinutes = 0;
  let offsetTotal = 0;
  for (const s of summaries) {
    if (s.state === "ARRIVED_ON_TIME" || s.state === "ARRIVED_LATE") {
      if (s.state === "ARRIVED_ON_TIME") onTime++;
      else {
        late++;
        lateMinutes += s.minutesLate ?? 0;
      }
      offsetTotal += s.minutesLate ?? 0;
      if (s.location === "ON_SITE") verifiedOnSite++;
    } else if (s.state === "NO_CHECK_IN") {
      missing++;
    }
  }
  const tracked = onTime + late + missing;
  const arrived = onTime + late;
  return {
    tracked,
    onTime,
    late,
    missing,
    onTimeRate: tracked ? onTime / tracked : null,
    averageMinutesLate: late ? Math.round(lateMinutes / late) : null,
    averageArrivalOffset: arrived ? Math.round(offsetTotal / arrived) : null,
    verifiedOnSite,
  };
}

/** Great-circle distance between two points in metres. */
export function distanceMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}
