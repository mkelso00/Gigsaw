"use server";

import type { Artist } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireStaff, type AgencyUser } from "@/lib/auth";
import { createBookingWithReference } from "@/lib/bookings";
import { applyBulkChange } from "@/lib/bulk";
import { BOOKING_STATUSES, CURRENCIES, EVENT_TYPES, LIVE_STATUSES, type BookingStatus } from "@/lib/constants";
import { getSettings, logActivity, prisma } from "@/lib/db";
import { FormError, confirmed, handleForm, int, oneOf, optStr, str, type FormState } from "@/lib/forms";
import { findClashes } from "@/lib/clash-check";
import { defaultBookingFee, minorToInput, toMinor } from "@/lib/money";
import { notifyArtistsOfNewGigs } from "@/lib/notify";
import { sendOffers } from "@/lib/offers";
import { dateInWeek, isDateKey, weekdayOf } from "@/lib/rota";
import { buildSchedule } from "@/lib/schedule";
import { localDateKey, zonedToUtc } from "@/lib/time";

const TIME = /^\d{2}:\d{2}$/;

function minutesBefore(time: string, mins: number) {
  const [h, m] = time.split(":").map(Number);
  const t = (h * 60 + m - mins + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** Read and check the slot form. Contacts and artists must belong to the agency. */
async function slotFields(form: FormData, user: AgencyUser) {
  const startTime = str(form, "startTime");
  const endTime = str(form, "endTime");
  if (!TIME.test(startTime) || !TIME.test(endTime)) throw new FormError("Enter a start and end time, like 19:00 and 21:00");
  const arriveRaw = str(form, "arriveTime");
  const arriveTime = TIME.test(arriveRaw) ? arriveRaw : minutesBefore(startTime, 30);
  const currency = oneOf(str(form, "currency"), CURRENCIES, "GBP");
  let feeMinor = 0;
  try {
    feeMinor = toMinor(str(form, "fee"), currency);
  } catch {
    throw new FormError("Enter the fee as a number, like 150.00");
  }
  let costMinor: number | null = null;
  if (str(form, "cost")) {
    try {
      costMinor = toMinor(str(form, "cost"), currency);
    } catch {
      throw new FormError("Enter the cost as a number, like 120.00");
    }
  }
  const promoterId = optStr(form, "promoterId");
  if (
    promoterId &&
    !(await prisma.contact.findFirst({
      where: { id: promoterId, agencyId: user.agencyId },
      select: { id: true },
    }))
  ) {
    throw new FormError("That contact isn't in your agency");
  }
  const artistId = optStr(form, "artistId");
  if (
    artistId &&
    !(await prisma.artist.findFirst({
      where: { id: artistId, agencyId: user.agencyId },
      select: { id: true },
    }))
  ) {
    throw new FormError("That artist isn't in your agency");
  }
  return {
    label: str(form, "label"),
    arriveTime,
    startTime,
    endTime,
    feeMinor,
    costMinor,
    currency,
    eventType: oneOf(str(form, "eventType"), EVENT_TYPES, "GIG"),
    bookingStatus: oneOf(str(form, "bookingStatus"), BOOKING_STATUSES, "CONFIRMED"),
    promoterId,
    artistId,
  };
}

async function ownVenue(user: AgencyUser, venueId: string) {
  const v = await prisma.venue.findFirst({
    where: { id: venueId, agencyId: user.agencyId },
  });
  if (!v) throw new FormError("Venue not found");
  return v;
}

async function ownSlot(user: AgencyUser, slotId: string) {
  const s = await prisma.venueSlot.findFirst({
    where: { id: slotId, agencyId: user.agencyId },
    include: { venue: true },
  });
  if (!s) throw new FormError("Slot not found");
  return s;
}

/** Add the same slot to one or more days of the week. */
export async function createSlots(venueId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const venue = await ownVenue(user, venueId);
    const days = form
      .getAll("weekday")
      .map((d) => Number(d))
      .filter((d) => d >= 1 && d <= 7);
    if (!days.length) throw new FormError("Tick at least one day");
    const fields = await slotFields(form, user);
    await prisma.venueSlot.createMany({
      data: days.map((weekday) => ({
        ...fields,
        weekday,
        venueId,
        agencyId: user.agencyId,
      })),
    });
    await logActivity(user, "VENUE", venueId, "added schedule slots", `${days.length} × ${fields.startTime}–${fields.endTime}`);
    revalidatePath(`/venues/${venue.id}`);
    revalidatePath("/rota");
    return { ok: `Added ${days.length} slot${days.length === 1 ? "" : "s"}.` };
  });
}

/**
 * Change a slot. Optionally apply new times and fee to the gigs already booked in it from now on,
 * telling each artist what changed.
 */
export async function updateSlot(slotId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const slot = await ownSlot(user, slotId);
    const fields = await slotFields(form, user);
    const weekday = int(form, "weekday") ?? slot.weekday;
    if (weekday < 1 || weekday > 7) throw new FormError("Pick a day");
    await prisma.venueSlot.update({
      where: { id: slot.id },
      data: { ...fields, weekday },
    });
    let note = "";
    if (str(form, "applyToUpcoming") === "on") {
      const upcoming = await prisma.booking.findMany({
        where: {
          slotId: slot.id,
          agencyId: user.agencyId,
          setStart: { gte: new Date() },
          status: { not: "CANCELLED" },
        },
        select: { id: true },
      });
      if (upcoming.length) {
        const res = await applyBulkChange(
          user,
          upcoming.map((b) => b.id),
          {
            times: {
              arrive: fields.arriveTime,
              setStart: fields.startTime,
              setEnd: fields.endTime,
            },
            fee: fields.feeMinor !== slot.feeMinor ? minorToInput(fields.feeMinor, fields.currency) : undefined,
            cost: fields.costMinor != null && fields.costMinor !== slot.costMinor ? minorToInput(fields.costMinor, fields.currency) : undefined,
            notifyArtists: str(form, "notifyArtists") === "on",
          },
        );
        note = ` ${res.updated} upcoming gig${res.updated === 1 ? "" : "s"} updated${res.notified ? `, ${res.notified} artist message${res.notified === 1 ? "" : "s"} sent` : ""}.`;
      }
    }
    await logActivity(user, "VENUE", slot.venueId, "changed a schedule slot", `${fields.startTime}–${fields.endTime}`);
    revalidatePath("/", "layout");
    return { ok: `Slot saved.${note}` };
  });
}

export async function deleteSlot(slotId: string) {
  const user = await requireStaff();
  const slot = await prisma.venueSlot.findFirst({
    where: { id: slotId, agencyId: user.agencyId },
  });
  if (!slot) return;
  // Gigs already booked from the slot stay booked; they just lose the link to it.
  await prisma.venueSlot.delete({ where: { id: slot.id } });
  await logActivity(user, "VENUE", slot.venueId, "removed a schedule slot");
  revalidatePath(`/venues/${slot.venueId}`);
  revalidatePath("/rota");
}

function slotSchedule(slot: Awaited<ReturnType<typeof ownSlot>>, date: string) {
  return buildSchedule(date, { arrive: slot.arriveTime, setStart: slot.startTime, setEnd: slot.endTime }, slot.venue.timezone);
}

/** Possible double bookings if this artist played this slot on this date. */
/** Settings and acts already loaded, so booking many weeks at once doesn't look them up every time. */
type BookingContext = { settings: Awaited<ReturnType<typeof getSettings>>; artists: Map<string, Artist> };

async function slotClashes(user: AgencyUser, slot: Awaited<ReturnType<typeof ownSlot>>, date: string, artistId: string, ctx?: BookingContext) {
  const settings = ctx?.settings ?? (await getSettings(user.agencyId));
  return findClashes(
    {
      agencyId: user.agencyId,
      artistId,
      venueId: slot.venueId,
      timezone: slot.venue.timezone,
      ...slotSchedule(slot, date),
    },
    settings.changeoverMinutes,
  );
}

/** The gig already made from this slot on this date, if any (cancelled ones don't count). */
async function slotBookingOn(slot: Awaited<ReturnType<typeof ownSlot>>, date: string) {
  const tz = slot.venue.timezone;
  const dayStart = zonedToUtc(date, "00:00", tz);
  const found = await prisma.booking.findFirst({
    where: {
      slotId: slot.id,
      status: { not: "CANCELLED" },
      arriveBy: { gte: new Date(dayStart.getTime() - 6 * 3_600_000), lt: new Date(dayStart.getTime() + 30 * 3_600_000) },
    },
    select: { id: true, arriveBy: true, artistId: true },
  });
  return found && localDateKey(found.arriveBy, tz) === date ? found : null;
}

/** Create the booking for one slot on one date. Returns null if it's already booked. */
async function bookSlot(
  user: AgencyUser,
  slot: Awaited<ReturnType<typeof ownSlot>>,
  date: string,
  artistId: string | null,
  statusOverride?: string,
  ctx?: BookingContext,
) {
  const artist = artistId ? (ctx?.artists.get(artistId) ?? (await prisma.artist.findFirst({ where: { id: artistId, agencyId: user.agencyId } }))) : null;
  if (artistId && !artist) throw new FormError("Choose an act");
  const tz = slot.venue.timezone;
  const existing = await slotBookingOn(slot, date);
  if (existing) {
    // Already in the calendar with no act (Pending): put the act on that gig instead.
    if (!existing.artistId && artist) {
      await prisma.booking.update({
        where: { id: existing.id },
        data: { artistId: artist.id, status: statusOverride ?? slot.bookingStatus, agentId: artist.agentId ?? undefined, demo: slot.venue.demo || artist.demo },
      });
      await logActivity(user, "BOOKING", existing.id, "act added", artist.name);
      return existing.id;
    }
    return null;
  }

  const settings = ctx?.settings ?? (await getSettings(user.agencyId));
  const schedule = slotSchedule(slot, date);
  const booking = await createBookingWithReference(user.agencyId, {
    ...schedule,
    artistId: artist?.id ?? null,
    venueId: slot.venueId,
    promoterId: slot.promoterId,
    agentId: artist?.agentId ?? user.id,
    createdById: user.id,
    slotId: slot.id,
    // Gigs made from demo venues or for demo artists are demo data: never billed or messaged.
    demo: slot.venue.demo || !!artist?.demo,
    // No act yet: the gig is Pending until one is added.
    status: artist ? (statusOverride ?? slot.bookingStatus) : "PENDING",
    eventType: slot.eventType,
    eventName: slot.label,
    timezone: tz,
    currency: slot.currency,
    feeMinor: slot.feeMinor,
    // Sale and cost when the slot has a cost; otherwise commission.
    ...(slot.costMinor != null ? { dealType: "BUY_SELL", artistFeeMinor: slot.costMinor } : {}),
    commissionPct: artist?.defaultCommission ?? settings.defaultCommission,
    bookingFeeMinor: defaultBookingFee(settings, { eventType: slot.eventType }),
  });
  await logActivity(user, "BOOKING", booking.id, "booked from venue schedule", `${slot.venue.name} ${date}`);
  return booking.id;
}

/** Put an artist into one slot on one date (from the rota). */
export async function assignSlot(slotId: string, date: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    if (!isDateKey(date)) throw new FormError("Unknown date");
    const slot = await ownSlot(user, slotId);
    const artistId = optStr(form, "artistId");
    if (!artistId) throw new FormError("Choose an act");
    // "Offer" asks the act to accept; "Confirm" books them straight in.
    const status = str(form, "mode") === "confirm" ? "CONFIRMED" : "AWAITING";
    if (!confirmed(form)) {
      const warnings = await slotClashes(user, slot, date, artistId);
      if (warnings.length) {
        return {
          confirm: {
            title: "Hold on: this artist may not be free",
            items: warnings.map((w) => w.text),
            button: "Book anyway",
          },
        };
      }
    }
    const id = await bookSlot(user, slot, date, artistId, status);
    if (!id) throw new FormError("This slot already has an act for that date");
    if (status === "AWAITING") await sendOffers([id]);
    else if (str(form, "notify") === "on") await notifyArtistsOfNewGigs([id]);
    revalidatePath("/", "layout");
    if (status === "AWAITING") return { ok: "Offered. You'll get an email when they answer." };
    return { ok: "Booked." };
  });
}

/** Book every slot that has a regular artist, for a number of weeks, skipping anything already booked or past. */
/**
 * Fill the calendar from the weekly slots for a number of weeks, skipping dates already done:
 *  - "pending": every slot becomes a Pending gig with no act, ready to add acts to
 *  - "offer": each slot's regular act is offered the gig (they accept or decline)
 *  - "confirm": each slot's regular act is booked in as confirmed
 */
export async function bookRegulars(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const weekStart = str(form, "weekStart");
    if (!isDateKey(weekStart)) throw new FormError("Unknown week");
    const weeks = Math.min(Math.max(int(form, "weeks") ?? 1, 1), 26);
    const mode = oneOf(str(form, "mode"), ["pending", "offer", "confirm"] as const, "pending");
    const slots = await prisma.venueSlot.findMany({
      where: { agencyId: user.agencyId, active: true, ...(mode === "pending" ? {} : { artistId: { not: null } }) },
      include: { venue: true },
    });
    const [settings, artists] = await Promise.all([
      getSettings(user.agencyId),
      prisma.artist.findMany({ where: { agencyId: user.agencyId, id: { in: slots.flatMap((s) => (s.artistId ? [s.artistId] : [])) } } }),
    ]);
    const ctx: BookingContext = { settings, artists: new Map(artists.map((a) => [a.id, a])) };
    const today = localDateKey(new Date(), settings.defaultTimezone);
    const created: string[] = [];
    const skipped: string[] = [];
    for (let w = 0; w < weeks; w++) {
      const monday = dateInWeek(weekStart, 1 + w * 7);
      for (const slot of slots) {
        const date = dateInWeek(monday, slot.weekday);
        if (date < today) continue;
        if (mode === "pending") {
          const id = await bookSlot(user, slot, date, null, undefined, ctx);
          if (id) created.push(id);
          continue;
        }
        // Already has an act on that date: nothing to do (and its own gig isn't a clash).
        if ((await slotBookingOn(slot, date))?.artistId) continue;
        // Never quietly double-book a regular: leave the slot for a person to decide.
        const warnings = await slotClashes(user, slot, date, slot.artistId!, ctx);
        if (warnings.length) {
          skipped.push(`${slot.venue.name} ${date} ${slot.startTime}`);
          continue;
        }
        const id = await bookSlot(user, slot, date, slot.artistId!, mode === "offer" ? "AWAITING" : "CONFIRMED", ctx);
        if (id) created.push(id);
      }
    }
    revalidatePath("/", "layout");
    if (!slots.length) {
      return {
        ok: mode === "pending" ? "No weekly slots yet. Add them on each venue's page." : "No slots have a regular act yet. Set one on each venue's schedule.",
      };
    }
    const span = `over ${weeks} week${weeks === 1 ? "" : "s"}`;
    const left = skipped.length
      ? ` ${skipped.length} left without an act because the regular act is busy elsewhere or away then: ${skipped.slice(0, 5).join("; ")}${skipped.length > 5 ? "…" : ""}.`
      : "";
    if (mode === "pending")
      return {
        ok: `Added ${created.length} gig${created.length === 1 ? "" : "s"} to the calendar ${span}, Pending with no act. Dates already in the calendar were left alone.`,
      };
    if (mode === "offer") {
      const people = await sendOffers(created);
      return {
        ok: `Offered ${created.length} gig${created.length === 1 ? "" : "s"} ${span}${people ? `: ${people} ${people === 1 ? "person was" : "people were"} sent their offers` : ""}.${left}`,
      };
    }
    const told = str(form, "notify") === "on" ? await notifyArtistsOfNewGigs(created) : 0;
    return {
      ok: `Booked ${created.length} gig${created.length === 1 ? "" : "s"} ${span}.${told ? ` ${told} act${told === 1 ? "" : "s"} sent a list of their new gigs.` : ""}${left}`,
    };
  });
}

/**
 * Add a gig on any date: from the rota, or the quick "New booking" button. By default it's a
 * one-off; tick "every week" to also add it to the venue's weekly schedule (with this artist as
 * the regular) and book this date. The venue can be left out for a one-off, e.g. a wedding.
 */
export async function addRotaGig(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const date = str(form, "date");
    if (!isDateKey(date)) throw new FormError("Choose a date");
    const weekly = str(form, "repeat") === "on";
    const venueId = str(form, "venueId");
    if (!venueId && weekly) throw new FormError("Choose a venue to make this a weekly slot");
    const venue = venueId ? await ownVenue(user, venueId) : null;
    const fields = await slotFields(form, user);
    const settings = await getSettings(user.agencyId);
    const tz = venue?.timezone ?? settings.defaultTimezone;
    if (date < localDateKey(new Date(), tz)) throw new FormError("That date has already passed");
    const artist = fields.artistId ? (await prisma.artist.findFirst({ where: { id: fields.artistId, agencyId: user.agencyId } }))! : null;
    // "Offer" and "Confirm" buttons choose the status; with no act yet the gig is Pending.
    const mode = str(form, "mode");
    const status = !artist
      ? fields.bookingStatus === "ENQUIRY"
        ? "ENQUIRY"
        : "PENDING"
      : mode === "offer"
        ? "AWAITING"
        : mode === "confirm"
          ? "CONFIRMED"
          : fields.bookingStatus;
    // Who pays: the one chosen, else whoever pays for this venue's regular slots.
    const promoterId =
      fields.promoterId ??
      (venue
        ? (await prisma.venueSlot.findFirst({ where: { venueId: venue.id, promoterId: { not: null } }, select: { promoterId: true } }))?.promoterId
        : null) ??
      null;
    const schedule = buildSchedule(date, { arrive: fields.arriveTime, setStart: fields.startTime, setEnd: fields.endTime }, tz);

    if (artist && !confirmed(form) && LIVE_STATUSES.includes(status as BookingStatus)) {
      const warnings = await findClashes(
        { agencyId: user.agencyId, artistId: artist.id, venueId: venue?.id ?? null, timezone: tz, ...schedule },
        settings.changeoverMinutes,
      );
      if (warnings.length) {
        return { confirm: { title: "Hold on: this act may not be free", items: warnings.map((w) => w.text), button: "Book anyway" } };
      }
    }

    let id: string | null;
    if (weekly && venue) {
      const created = await prisma.venueSlot.create({
        data: { ...fields, promoterId, agencyId: user.agencyId, venueId: venue.id, weekday: weekdayOf(date) },
        include: { venue: true },
      });
      await logActivity(user, "VENUE", venue.id, "added a weekly slot", `${fields.startTime}–${fields.endTime}`);
      id = await bookSlot(user, created, date, artist?.id ?? null, status);
    } else {
      const booking = await createBookingWithReference(user.agencyId, {
        ...schedule,
        artistId: artist?.id ?? null,
        venueId: venue?.id ?? null,
        promoterId,
        agentId: artist?.agentId ?? user.id,
        createdById: user.id,
        demo: !!venue?.demo || !!artist?.demo,
        status,
        eventType: fields.eventType,
        eventName: fields.label,
        timezone: tz,
        currency: fields.currency,
        feeMinor: fields.feeMinor,
        ...(fields.costMinor != null ? { dealType: "BUY_SELL", artistFeeMinor: fields.costMinor } : {}),
        commissionPct: artist?.defaultCommission ?? settings.defaultCommission,
        bookingFeeMinor: defaultBookingFee(settings, { eventType: fields.eventType }),
      });
      await logActivity(user, "BOOKING", booking.id, "added (quick booking)", `${venue?.name ?? "no venue"} ${date}`);
      id = booking.id;
    }
    const ref = id ? (await prisma.booking.findUnique({ where: { id }, select: { reference: true } }))?.reference : null;
    const offered = id && status === "AWAITING" ? await sendOffers([id]) : 0;
    if (id && status !== "AWAITING" && str(form, "notify") === "on") await notifyArtistsOfNewGigs([id]);
    revalidatePath("/", "layout");
    const what = !artist
      ? `Added${venue ? ` at ${venue.name}` : ""}${ref ? ` (${ref})` : ""}: Pending, needs an act.`
      : status === "AWAITING"
        ? `Offered to ${artist.name}${venue ? ` at ${venue.name}` : ""}${ref ? ` (${ref})` : ""}.${offered ? " They've been sent the offer." : " They have no email, phone or login on file: send the link from the booking."}`
        : `Booked ${artist.name}${venue ? ` at ${venue.name}` : ""}${ref ? ` (${ref})` : ""}.`;
    return { ok: `${what}${weekly ? " Added to the venue's weekly schedule too." : ""}` };
  });
}
