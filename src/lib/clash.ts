// Does an artist have time to get from one gig to the next?
//
// Each gig keeps the artist busy from its call time until it finishes (or three hours after
// going on stage when there's no finish time). Between two gigs we compare the gap with the
// time needed: pack down and changeover (an agency setting) plus a rough travel estimate from
// the distance between the two venues' map pins.

import { distanceMetres } from "./arrival";
import { formatMinutes } from "./time";

export type GigWindow = {
  arriveBy: Date;
  setStart: Date;
  setEnd: Date | null;
  venue: { id?: string; name: string; latitude: number | null; longitude: number | null } | null;
};

export type ClashLevel = "clash" | "tight" | "ok";

export type ClashAssessment = {
  level: ClashLevel;
  /** Minutes between the first gig finishing and the second gig's call time (negative = overlap). */
  gapMinutes: number;
  /** Estimated minutes to pack down and travel, or null if it can't be estimated. */
  neededMinutes: number | null;
  travelMinutes: number | null;
  distanceKm: number | null;
  /** Which of the two gigs comes first. */
  first: "a" | "b";
};

const MIN = 60_000;
/** When we can't measure the distance between two venues, assume this much travel. */
const UNKNOWN_TRAVEL_MINUTES = 45;

export function gigEnd(g: Pick<GigWindow, "setStart" | "setEnd">) {
  return g.setEnd && g.setEnd > g.setStart ? g.setEnd : new Date(g.setStart.getTime() + 3 * 60 * MIN);
}

/**
 * Rough door-to-door travel time for a straight-line distance. Roads are about 1.3× the
 * straight line; short hops are city speeds, longer ones motorway-ish. Rounded up to 5 minutes.
 */
export function estimateTravelMinutes(km: number) {
  if (km < 0.3) return 0; // next door, or the same place
  const road = km * 1.3;
  const speed = road < 10 ? 25 : road < 50 ? 45 : 70; // km/h
  return Math.ceil(((road / speed) * 60) / 5) * 5 + 5;
}

function sameVenue(a: GigWindow["venue"], b: GigWindow["venue"]) {
  return !!a && !!b && ((a.id && a.id === b.id) || (a.name === b.name && a.latitude === b.latitude && a.longitude === b.longitude));
}

export function assessPair(a: GigWindow, b: GigWindow, changeoverMinutes: number): ClashAssessment {
  const first = a.arriveBy <= b.arriveBy ? "a" : "b";
  const [early, late] = first === "a" ? [a, b] : [b, a];
  const gapMinutes = Math.round((late.arriveBy.getTime() - gigEnd(early).getTime()) / MIN);

  let distanceKm: number | null = null;
  let travelMinutes: number | null = null;
  if (sameVenue(early.venue, late.venue)) {
    distanceKm = 0;
    travelMinutes = 0;
  } else if (early.venue?.latitude != null && early.venue.longitude != null && late.venue?.latitude != null && late.venue.longitude != null) {
    distanceKm = distanceMetres(early.venue.latitude, early.venue.longitude, late.venue.latitude, late.venue.longitude) / 1000;
    travelMinutes = estimateTravelMinutes(distanceKm);
  }
  const sameplace = travelMinutes === 0;
  const neededMinutes = sameplace ? 0 : (travelMinutes ?? UNKNOWN_TRAVEL_MINUTES) + changeoverMinutes;

  const level: ClashLevel = gapMinutes < 0 ? "clash" : gapMinutes < neededMinutes ? "tight" : "ok";
  return { level, gapMinutes, neededMinutes: travelMinutes === null ? null : neededMinutes, travelMinutes, distanceKm, first };
}

/**
 * A plain-English explanation, e.g. for the "Hold on" box or the booking checklist.
 * Leave `otherLabel` empty when the sentence before already names the other gig.
 */
export function describeAssessment(x: ClashAssessment, otherLabel = ""): string {
  const travel =
    x.travelMinutes === null
      ? "We can't work out the travel time because a venue has no map pin."
      : x.travelMinutes === 0
        ? "It's at the same venue."
        : `It's about ${Math.round(x.distanceKm!)} km away, roughly ${formatMinutes(x.travelMinutes)} to travel.`;
  if (x.level === "clash") {
    return `The times overlap${otherLabel ? ` with ${otherLabel}` : ""}${x.gapMinutes < 0 ? ` by ${formatMinutes(-x.gapMinutes)}` : ""}. ${travel}`;
  }
  const gap = `${formatMinutes(x.gapMinutes)} between finishing one and the call time for the other`;
  if (x.level === "tight") return `Only ${gap}${otherLabel ? ` (${otherLabel})` : ""}. ${travel} That may not be enough.`;
  return `${otherLabel ? `${otherLabel}: ` : ""}${gap.charAt(0).toUpperCase()}${gap.slice(1)}. ${travel} That leaves time to spare.`;
}
