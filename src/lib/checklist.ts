// Booking checklist: catches double bookings, radius clause breaches and missing details
// before a booking moves forward.

import { distanceMetres } from "./arrival";
import { LIVE_STATUSES, type BookingStatus } from "./constants";
import { localDateKey } from "./time";

export type ChecklistLevel = "error" | "warning" | "ok";
export type ChecklistItem = { level: ChecklistLevel; label: string; detail?: string };

type VenueLike = { name: string; latitude: number | null; longitude: number | null } | null;

export type ChecklistBooking = {
  id: string;
  reference: string;
  status: string;
  artistId: string;
  timezone: string;
  setStart: Date;
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
  setStart: Date;
  venue: VenueLike;
  radiusKm: number | null;
  radiusDays: number | null;
};

const DAY = 86_400_000;

function isLive(status: string) {
  return LIVE_STATUSES.includes(status as BookingStatus);
}

/** Bookings for the same artist on the same local day. */
export function findDateClashes(b: ChecklistBooking, others: OtherBooking[]): OtherBooking[] {
  const day = localDateKey(b.setStart, b.timezone);
  return others.filter(
    (o) => o.id !== b.id && o.artistId === b.artistId && isLive(o.status) && localDateKey(o.setStart, b.timezone) === day,
  );
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

export function buildChecklist(
  b: ChecklistBooking,
  others: OtherBooking[],
  depositReceivedMinor: number,
  now: Date,
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  if (b.status === "CANCELLED") return [{ level: "ok", label: "Booking is cancelled" }];

  const clashes = findDateClashes(b, others);
  items.push(
    clashes.length
      ? { level: "error", label: "Double booking", detail: `Same day as ${clashes.map((c) => c.reference).join(", ")}` }
      : { level: "ok", label: "No double booking" },
  );

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
