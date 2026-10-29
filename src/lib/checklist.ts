// Booking checklist: catches double bookings, radius clause breaches and missing details
// before a booking moves forward.

import { distanceMetres } from "./arrival";
import { LIVE_STATUSES, type BookingStatus } from "./constants";
import { assessPair, describeAssessment, type ClashAssessment } from "./clash";

export type ChecklistLevel = "error" | "warning" | "ok";
export type ChecklistItem = { level: ChecklistLevel; label: string; detail?: string };

type VenueLike = { name: string; latitude: number | null; longitude: number | null } | null;

export type ChecklistBooking = {
  id: string;
  reference: string;
  status: string;
  artistId: string;
  /** Acts sharing a member with this one; their gigs count as double bookings too. */
  linkedArtistIds?: string[];
  timezone: string;
  arriveBy: Date;
  setStart: Date;
  setEnd: Date | null;
  venue: VenueLike;
  promoterId: string | null;
  feeMinor: number;
  dealType: string;
  artistFeeMinor: number | null;
  depositMinor: number;
  depositDueDate: Date | null;
  radiusKm: number | null;
  radiusDays: number | null;
  travel: string;
  dayContact: string;
};

export type OtherBooking = {
  id: string;
  reference: string;
  status: string;
  artistId: string;
  /** The act's name, shown when the clash is with another act that shares a member. */
  artistName?: string;
  arriveBy: Date;
  setStart: Date;
  setEnd: Date | null;
  venue: VenueLike;
  radiusKm: number | null;
  radiusDays: number | null;
};

const DAY = 86_400_000;

function isLive(status: string) {
  return LIVE_STATUSES.includes(status as BookingStatus);
}

export type ClashFinding = { other: OtherBooking; assessment: ClashAssessment };

/** Every other live gig for the same act (or an act sharing a member) within a day, with whether there's time to travel between them. */
export function assessOtherGigs(b: ChecklistBooking, others: OtherBooking[], changeoverMinutes: number): ClashFinding[] {
  const day = 86_400_000;
  const acts = b.linkedArtistIds ?? [b.artistId];
  return others
    .filter((o) => o.id !== b.id && acts.includes(o.artistId) && isLive(o.status) && Math.abs(o.arriveBy.getTime() - b.arriveBy.getTime()) < day)
    .map((o) => ({ other: o, assessment: assessPair(b, o, changeoverMinutes) }));
}

/** Other gigs for the same artist that overlap this one or leave too little time to travel. */
export function findDateClashes(b: ChecklistBooking, others: OtherBooking[], changeoverMinutes = 15): OtherBooking[] {
  return assessOtherGigs(b, others, changeoverMinutes)
    .filter((f) => f.assessment.level !== "ok")
    .map((f) => f.other);
}

/**
 * Bookings that break a radius clause, either this booking's clause or the other booking's.
 * A clause of "50 km, 30 days" means no other show within 50 km in the 30 days either side.
 */
export function findRadiusBreaches(b: ChecklistBooking, others: OtherBooking[]): OtherBooking[] {
  const v = b.venue;
  if (!v || v.latitude === null || v.longitude === null) return [];
  return others.filter((o) => {
    if (o.id === b.id || o.artistId !== b.artistId || !isLive(o.status)) return false;
    const ov = o.venue;
    if (!ov || ov.latitude === null || ov.longitude === null) return false;
    const km = distanceMetres(v.latitude!, v.longitude!, ov.latitude, ov.longitude) / 1000;
    const days = Math.abs(o.setStart.getTime() - b.setStart.getTime()) / DAY;
    const mine = b.radiusKm !== null && b.radiusDays !== null && km <= b.radiusKm && days <= b.radiusDays;
    const theirs = o.radiusKm !== null && o.radiusDays !== null && km <= o.radiusKm && days <= o.radiusDays;
    return mine || theirs;
  });
}

export function buildChecklist(b: ChecklistBooking, others: OtherBooking[], depositReceivedMinor: number, now: Date, changeoverMinutes = 15): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  if (b.status === "CANCELLED") return [{ level: "ok", label: "Booking is cancelled" }];

  const label = (o: OtherBooking) =>
    `${o.reference}${o.artistId !== b.artistId ? ` (${o.artistName ?? "another act"}, which shares a member)` : ""}${o.venue ? ` at ${o.venue.name}` : ""}`;
  const findings = assessOtherGigs(b, others, changeoverMinutes);
  const clashes = findings.filter((f) => f.assessment.level === "clash");
  const tight = findings.filter((f) => f.assessment.level === "tight");
  const fine = findings.filter((f) => f.assessment.level === "ok");
  for (const f of clashes) items.push({ level: "error", label: "Double booking", detail: describeAssessment(f.assessment, label(f.other)) });
  for (const f of tight) items.push({ level: "error", label: "May not have time to get there", detail: describeAssessment(f.assessment, label(f.other)) });
  for (const f of fine)
    items.push({ level: "ok", label: "Another gig the same day, with time to travel", detail: describeAssessment(f.assessment, label(f.other)) });
  if (!findings.length) items.push({ level: "ok", label: "No double booking" });

  const breaches = findRadiusBreaches(b, others);
  if (breaches.length) {
    items.push({
      level: "error",
      label: "Radius clause broken",
      detail: `Too close to ${breaches.map((c) => `${c.reference}${c.venue ? ` (${c.venue.name})` : ""}`).join(", ")}`,
    });
  } else if (b.radiusKm !== null) {
    items.push({ level: "ok", label: "Radius clause respected" });
  }

  items.push(b.venue ? { level: "ok", label: "Venue set" } : { level: "warning", label: "No venue set" });
  if (b.venue && (b.venue.latitude === null || b.venue.longitude === null)) {
    items.push({
      level: "warning",
      label: "Venue has no map pin",
      detail: "Arrival check-ins cannot be verified against the venue location.",
    });
  }
  items.push(b.promoterId ? { level: "ok", label: "Promoter set" } : { level: "warning", label: "No promoter set" });
  items.push(b.feeMinor > 0 ? { level: "ok", label: "Fee agreed" } : { level: "warning", label: "No fee entered" });
  if (b.dealType === "BUY_SELL" && !b.artistFeeMinor) {
    items.push({ level: "warning", label: "Buy / sell deal has no artist fee" });
  }

  if (b.depositMinor > 0) {
    if (depositReceivedMinor >= b.depositMinor) {
      items.push({ level: "ok", label: "Deposit received" });
    } else if (b.depositDueDate && b.depositDueDate < now) {
      items.push({ level: "error", label: "Deposit overdue" });
    } else {
      items.push({ level: "warning", label: "Deposit not yet received" });
    }
  }

  if (b.status === "CONFIRMED" || b.status === "SETTLED") {
    if (!b.travel.trim()) items.push({ level: "warning", label: "No travel details in itinerary" });
    if (!b.dayContact.trim()) items.push({ level: "warning", label: "No day-of-show contact" });
  }
  return items;
}
