import "server-only";
import type { Prisma, Settings } from "@prisma/client";
import { punctuality, summariseArrival, type ArrivalSummary } from "./arrival";
import { BOOKING_STATUSES, DEAL_TYPES, CURRENCIES, EVENT_TYPES } from "./constants";
import { prisma } from "./db";
import { FormError, int, num, oneOf, optStr, normaliseTags, required, str } from "./forms";
import { toMinor } from "./money";
import { addDaysToKey, isValidTimeZone, localDateKey, zonedToUtc } from "./time";

export const bookingListInclude = {
  artist: { select: { id: true, name: true, colour: true } },
  venue: { select: { id: true, name: true, city: true, latitude: true, longitude: true, timezone: true } },
  promoter: { select: { id: true, name: true, company: true } },
  checkIns: { select: { kind: true, at: true, source: true, distanceM: true, etaMinutes: true } },
  payments: { select: { direction: true, kind: true, amountMinor: true } },
} satisfies Prisma.BookingInclude;

export type BookingListItem = Prisma.BookingGetPayload<{ include: typeof bookingListInclude }>;

type ArrivalSource = {
  status: string;
  arriveBy: Date;
  setStart: Date;
  setEnd: Date | null;
  venue: { latitude: number | null; longitude: number | null } | null;
  checkIns: { kind: string; at: Date; source: string; distanceM: number | null; etaMinutes: number | null }[];
};

export function arrivalFor(b: ArrivalSource, settings: Settings, now = new Date()): ArrivalSummary {
  return summariseArrival({
    status: b.status,
    arriveBy: b.arriveBy,
    setStart: b.setStart,
    setEnd: b.setEnd,
    checkIns: b.checkIns,
    venueHasLocation: !!b.venue && b.venue.latitude !== null && b.venue.longitude !== null,
    now,
    graceMinutes: settings.lateGraceMinutes,
    geofenceMetres: settings.geofenceMetres,
  });
}

/** The date of the gig, taken from the call time in the venue's time zone. */
export function gigDateKey(b: { arriveBy: Date; timezone: string }) {
  return localDateKey(b.arriveBy, b.timezone);
}

async function nextReference(agencyId: string): Promise<string> {
  const last = await prisma.booking.findFirst({ where: { agencyId }, orderBy: { reference: "desc" }, select: { reference: true } });
  const n = last ? Number(last.reference.replace(/\D/g, "")) + 1 : 1;
  return `GS-${String(n).padStart(4, "0")}`;
}

export async function createBookingWithReference(agencyId: string, data: Omit<Prisma.BookingUncheckedCreateInput, "reference" | "agencyId">) {
  // Retry if two people create a booking at the same moment and grab the same number.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.booking.create({ data: { ...data, agencyId, reference: await nextReference(agencyId) } });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  throw new Error("Could not allocate a booking reference");
}

/**
 * Turn the booking form into database fields.
 * Times are entered as wall-clock times in the venue's time zone. The date is the day of the
 * call time. Each later time that is earlier on the clock than the one before it rolls into
 * the next day (e.g. arrive 22:00, on stage 01:00).
 * Every linked record (artist, venue, promoter, agent) must belong to the same agency.
 */
export async function parseBookingForm(form: FormData, settings: Settings, agencyId: string) {
  const artistId = required(form, "artistId", "Artist");
  const artist = await prisma.artist.findFirst({ where: { id: artistId, agencyId } });
  if (!artist) throw new FormError("Choose an artist");

  const venueId = optStr(form, "venueId");
  const venue = venueId ? await prisma.venue.findFirst({ where: { id: venueId, agencyId } }) : null;
  if (venueId && !venue) throw new FormError("That venue no longer exists");

  const promoterId = optStr(form, "promoterId");
  if (promoterId && !(await prisma.contact.findFirst({ where: { id: promoterId, agencyId }, select: { id: true } }))) {
    throw new FormError("That promoter no longer exists");
  }
  const agentId = optStr(form, "agentId");
  if (agentId && !(await prisma.user.findFirst({ where: { id: agentId, agencyId, role: { in: ["ADMIN", "AGENT"] } }, select: { id: true } }))) {
    throw new FormError("That agent is not part of your agency");
  }

  const timezone = venue?.timezone ?? (str(form, "timezone") || settings.defaultTimezone);
  if (!isValidTimeZone(timezone)) throw new FormError("Unknown time zone");

  const date = required(form, "date", "Date");
  const arriveTime = required(form, "arriveTime", "Arrive by time");
  const setStartTime = required(form, "setStartTime", "Set start time");
  const soundcheckTime = str(form, "soundcheckTime");
  const setEndTime = str(form, "setEndTime");

  const arriveBy = zonedToUtc(date, arriveTime, timezone);
  const rollForward = (time: string, after: Date) => {
    let t = zonedToUtc(date, time, timezone);
    // Add days in local time so a daylight saving change does not shift the clock time.
    let d = date;
    while (t < after) {
      d = addDaysToKey(d, 1);
      t = zonedToUtc(d, time, timezone);
    }
    return t;
  };
  const soundcheckAt = soundcheckTime ? rollForward(soundcheckTime, arriveBy) : null;
  const setStart = rollForward(setStartTime, soundcheckAt ?? arriveBy);
  const setEnd = setEndTime ? rollForward(setEndTime, setStart) : null;
  if (setEnd && setEnd.getTime() === setStart.getTime()) throw new FormError("Set end must be after set start");

  const currency = oneOf(str(form, "currency"), CURRENCIES, settings.defaultCurrency as (typeof CURRENCIES)[number]);
  const dealType = oneOf(str(form, "dealType"), DEAL_TYPES, "STANDARD_COMMISSION");
  const commissionPct = num(form, "commissionPct") ?? artist.defaultCommission ?? settings.defaultCommission;
  if (commissionPct < 0 || commissionPct > 100) throw new FormError("Commission must be between 0 and 100%");
  const vatPct = num(form, "vatPct") ?? 0;
  if (vatPct < 0 || vatPct > 100) throw new FormError("VAT must be between 0 and 100%");

  let feeMinor: number;
  let artistFeeMinor: number | null;
  let depositMinor: number;
  try {
    feeMinor = toMinor(str(form, "fee"), currency);
    artistFeeMinor = str(form, "artistFee") ? toMinor(str(form, "artistFee"), currency) : null;
    depositMinor = toMinor(str(form, "deposit"), currency);
  } catch {
    throw new FormError("Check the money amounts: use numbers only, like 1250.00");
  }
  if (feeMinor < 0 || depositMinor < 0 || (artistFeeMinor ?? 0) < 0) throw new FormError("Amounts cannot be negative");
  if (depositMinor > feeMinor && feeMinor > 0) throw new FormError("Deposit cannot be more than the fee");

  const depositDue = str(form, "depositDueDate");
  const radiusKm = int(form, "radiusKm");
  const radiusDays = int(form, "radiusDays");
  if ((radiusKm === null) !== (radiusDays === null)) {
    throw new FormError("A radius clause needs both a distance and a number of days");
  }

  return {
    artistId,
    venueId: venue?.id ?? null,
    promoterId,
    agentId,
    eventName: str(form, "eventName"),
    eventType: oneOf(str(form, "eventType"), EVENT_TYPES, "GIG"),
    status: oneOf(str(form, "status"), BOOKING_STATUSES, "HOLD"),
    dealType,
    timezone,
    arriveBy,
    soundcheckAt,
    setStart,
    setEnd,
    currency,
    feeMinor,
    artistFeeMinor: dealType === "BUY_SELL" ? artistFeeMinor : null,
    commissionPct,
    vatPct,
    depositMinor,
    depositDueDate: depositDue ? zonedToUtc(depositDue, "23:59", timezone) : null,
    dealNotes: str(form, "dealNotes"),
    radiusKm,
    radiusDays,
    travel: str(form, "travel"),
    accommodation: str(form, "accommodation"),
    dayContact: str(form, "dayContact"),
    hospitality: str(form, "hospitality"),
    notes: str(form, "notes"),
    tags: normaliseTags(str(form, "tags")),
  };
}


/** Punctuality for each of the agency's artists over their gigs between `from` and now. */
export async function punctualityByArtist(settings: Settings, from: Date, artistId?: string) {
  const now = new Date();
  const bookings = await prisma.booking.findMany({
    where: { agencyId: settings.agencyId, arriveBy: { gte: from, lte: now }, status: { not: "CANCELLED" }, ...(artistId ? { artistId } : {}) },
    select: {
      artistId: true,
      status: true,
      arriveBy: true,
      setStart: true,
      setEnd: true,
      venue: { select: { latitude: true, longitude: true } },
      checkIns: { select: { kind: true, at: true, source: true, distanceM: true, etaMinutes: true } },
    },
  });
  const byArtist = new Map<string, ArrivalSummary[]>();
  for (const b of bookings) {
    const list = byArtist.get(b.artistId) ?? [];
    list.push(arrivalFor(b, settings, now));
    byArtist.set(b.artistId, list);
  }
  return new Map([...byArtist].map(([id, list]) => [id, punctuality(list)]));
}
