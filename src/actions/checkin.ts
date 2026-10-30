"use server";

import { revalidatePath } from "next/cache";
import { checkInWindow, distanceMetres } from "@/lib/arrival";
import { notifyClientOfArrival } from "@/lib/alerts";
import { requireUser } from "@/lib/auth";
import { CHECK_IN_KINDS, type CheckInKind } from "@/lib/constants";
import { logActivity, prisma } from "@/lib/db";
import { actIdsFor } from "@/lib/people";

export type CheckInPayload = {
  kind: CheckInKind;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  etaMinutes?: number | null;
  note?: string;
};

export type CheckInResult = { ok: true; message: string } | { ok: false; message: string };

function validCoord(v: unknown, limit: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;
}

/** An artist marks themselves on the way, arrived, or leaving, from the artist app. */
export async function artistCheckIn(bookingId: string, payload: CheckInPayload): Promise<CheckInResult> {
  const user = await requireUser(["ARTIST"]);
  if (!CHECK_IN_KINDS.includes(payload.kind)) return { ok: false, message: "Unknown check-in type." };

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, agencyId: user.agencyId },
    include: { venue: true, checkIns: { select: { kind: true } } },
  });
  // Artists can only check in to their own gigs (any act they're in).
  if (!booking || !booking.artistId || !(await actIdsFor(user)).includes(booking.artistId)) return { ok: false, message: "Booking not found." };
  if (booking.status === "CANCELLED") return { ok: false, message: "This booking has been cancelled." };

  const now = new Date();
  const window = checkInWindow(booking.arriveBy, booking.setStart, booking.setEnd);
  if (now < window.opensAt) return { ok: false, message: "Check-in opens 12 hours before your call time." };
  if (now > window.closesAt) return { ok: false, message: "Check-in for this booking has closed." };

  const has = (k: string) => booking.checkIns.some((c) => c.kind === k);
  if (payload.kind === "ARRIVED" && has("ARRIVED")) return { ok: false, message: "You've already checked in as arrived." };
  if (payload.kind === "DEPARTED" && !has("ARRIVED")) return { ok: false, message: "Check in as arrived first." };
  if (payload.kind === "DEPARTED" && has("DEPARTED")) return { ok: false, message: "You've already marked that you've left." };

  const hasCoords = validCoord(payload.latitude, 90) && validCoord(payload.longitude, 180);
  const venue = booking.venue;
  const distanceM =
    hasCoords && venue?.latitude != null && venue.longitude != null
      ? distanceMetres(payload.latitude!, payload.longitude!, venue.latitude, venue.longitude)
      : null;
  const eta = payload.etaMinutes;
  const etaMinutes = typeof eta === "number" && eta > 0 && eta <= 24 * 60 ? Math.round(eta) : null;

  await prisma.checkIn.create({
    data: {
      bookingId,
      artistId: booking.artistId!,
      userId: user.id,
      kind: payload.kind,
      source: "APP",
      at: now,
      latitude: hasCoords ? payload.latitude : null,
      longitude: hasCoords ? payload.longitude : null,
      accuracyM: typeof payload.accuracyM === "number" && Number.isFinite(payload.accuracyM) ? payload.accuracyM : null,
      distanceM,
      etaMinutes: payload.kind === "ON_THE_WAY" ? etaMinutes : null,
      note: (payload.note ?? "").slice(0, 500),
    },
  });
  await logActivity(user, "BOOKING", bookingId, "artist checked in", payload.kind.toLowerCase().replaceAll("_", " "));
  if (payload.kind === "ARRIVED") {
    // A failed message must never stop the check-in itself.
    await notifyClientOfArrival(bookingId).catch((e) => console.error("[gigsaw] client arrival message failed", e));
  }
  revalidatePath("/", "layout");

  const messages: Record<CheckInKind, string> = {
    ON_THE_WAY: "Thanks, the agency can see you're on the way.",
    ARRIVED: "You're checked in. Have a great show!",
    DEPARTED: "Thanks, safe travels home.",
  };
  return { ok: true, message: messages[payload.kind] };
}
