"use server";

import { revalidatePath } from "next/cache";
import { requireStaff, type AgencyUser } from "@/lib/auth";
import { createBookingWithReference } from "@/lib/bookings";
import { applyBulkChange } from "@/lib/bulk";
import { BOOKING_STATUSES, CURRENCIES, EVENT_TYPES, LIVE_STATUSES } from "@/lib/constants";
import { getSettings, logActivity, prisma } from "@/lib/db";
import { FormError, confirmed, handleForm, int, oneOf, optStr, str, type FormState } from "@/lib/forms";
import { findClashes } from "@/lib/clash-check";
import { minorToInput, toMinor } from "@/lib/money";
import { notifyArtistsOfNewGigs } from "@/lib/notify";
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
async function slotClashes(user: AgencyUser, slot: Awaited<ReturnType<typeof ownSlot>>, date: string, artistId: string) {
  const settings = await getSettings(user.agencyId);
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

/** Create the booking for one slot on one date. Returns null if it's already booked. */
async function bookSlot(user: AgencyUser, slot: Awaited<ReturnType<typeof ownSlot>>, date: string, artistId: string) {
  const tz = slot.venue.timezone;
  const dayStart = zonedToUtc(date, "00:00", tz);
  const existing = await prisma.booking.findFirst({
    where: {
      slotId: slot.id,
      status: { not: "CANCELLED" },
      arriveBy: {
        gte: new Date(dayStart.getTime() - 6 * 3_600_000),
        lt: new Date(dayStart.getTime() + 30 * 3_600_000),
      },
    },
    select: { id: true, arriveBy: true },
  });
  if (existing && localDateKey(existing.arriveBy, tz) === date) return null;

  const artist = await prisma.artist.findFirst({
    where: { id: artistId, agencyId: user.agencyId },
  });
  if (!artist) throw new FormError("Choose an artist");
  const settings = await getSettings(user.agencyId);
  const schedule = slotSchedule(slot, date);
  const booking = await createBookingWithReference(user.agencyId, {
    ...schedule,
    artistId: artist.id,
    venueId: slot.venueId,
    promoterId: slot.promoterId,
    agentId: artist.agentId ?? user.id,
    createdById: user.id,
    slotId: slot.id,
    // Gigs made from demo venues or for demo artists are demo data: never billed or messaged.
    demo: slot.venue.demo || artist.demo,
    status: slot.bookingStatus,
    eventType: slot.eventType,
    eventName: slot.label,
    timezone: tz,
    currency: slot.currency,
    feeMinor: slot.feeMinor,
    commissionPct: artist.defaultCommission ?? settings.defaultCommission,
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
    if (!artistId) throw new FormError("Choose an artist");
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
    const id = await bookSlot(user, slot, date, artistId);
    if (!id) throw new FormError("This slot is already booked for that date");
    if (str(form, "notify") === "on") await notifyArtistsOfNewGigs([id]);
    revalidatePath("/", "layout");
    return { ok: "Booked." };
  });
}

/** Book every slot that has a regular artist, for a number of weeks, skipping anything already booked or past. */
export async function bookRegulars(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const weekStart = str(form, "weekStart");
    if (!isDateKey(weekStart)) throw new FormError("Unknown week");
    const weeks = Math.min(Math.max(int(form, "weeks") ?? 1, 1), 26);
    const slots = await prisma.venueSlot.findMany({
      where: { agencyId: user.agencyId, active: true, artistId: { not: null } },
      include: { venue: true },
    });
    const today = localDateKey(new Date(), (await getSettings(user.agencyId)).defaultTimezone);
    const created: string[] = [];
    const skipped: string[] = [];
    for (let w = 0; w < weeks; w++) {
      const monday = dateInWeek(weekStart, 1 + w * 7);
      for (const slot of slots) {
        const date = dateInWeek(monday, slot.weekday);
        if (date < today) continue;
        // Never quietly double-book a regular: leave the slot empty for a person to decide.
        const warnings = await slotClashes(user, slot, date, slot.artistId!);
        if (warnings.length) {
          skipped.push(`${slot.venue.name} ${date} ${slot.startTime}`);
          continue;
        }
        const id = await bookSlot(user, slot, date, slot.artistId!);
        if (id) created.push(id);
      }
    }
    const told = str(form, "notify") === "on" ? await notifyArtistsOfNewGigs(created) : 0;
    revalidatePath("/", "layout");
    if (!slots.length)
      return {
        ok: "No slots have a regular artist yet. Set one on each venue's schedule.",
      };
    return {
      ok: `Booked ${created.length} gig${created.length === 1 ? "" : "s"} over ${weeks} week${weeks === 1 ? "" : "s"}.${told ? ` ${told} artist${told === 1 ? "" : "s"} sent a list of their new gigs.` : ""} Slots already booked were left alone.${
        skipped.length
          ? ` ${skipped.length} left empty because the regular artist is busy elsewhere then: ${skipped.slice(0, 5).join("; ")}${skipped.length > 5 ? "…" : ""}. They're in “Needs an artist”.`
          : ""
      }`,
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
    if (!fields.artistId) throw new FormError("Choose an act");
    const settings = await getSettings(user.agencyId);
    const tz = venue?.timezone ?? settings.defaultTimezone;
    if (date < localDateKey(new Date(), tz)) throw new FormError("That date has already passed");
    const artist = (await prisma.artist.findFirst({ where: { id: fields.artistId, agencyId: user.agencyId } }))!;
    // Who pays: the one chosen, else whoever pays for this venue's regular slots.
    const promoterId =
      fields.promoterId ??
      (venue
        ? (await prisma.venueSlot.findFirst({ where: { venueId: venue.id, promoterId: { not: null } }, select: { promoterId: true } }))?.promoterId
        : null) ??
      null;
    const schedule = buildSchedule(date, { arrive: fields.arriveTime, setStart: fields.startTime, setEnd: fields.endTime }, tz);

    if (!confirmed(form) && LIVE_STATUSES.includes(fields.bookingStatus)) {
      const warnings = await findClashes({ agencyId: user.agencyId, artistId: artist.id, venueId: venue?.id ?? null, timezone: tz, ...schedule }, settings.changeoverMinutes);
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
      id = await bookSlot(user, created, date, artist.id);
    } else {
      const booking = await createBookingWithReference(user.agencyId, {
        ...schedule,
        artistId: artist.id,
        venueId: venue?.id ?? null,
        promoterId,
        agentId: artist.agentId ?? user.id,
        createdById: user.id,
        demo: !!venue?.demo || artist.demo,
        status: fields.bookingStatus,
        eventType: fields.eventType,
        eventName: fields.label,
        timezone: tz,
        currency: fields.currency,
        feeMinor: fields.feeMinor,
        commissionPct: artist.defaultCommission ?? settings.defaultCommission,
      });
      await logActivity(user, "BOOKING", booking.id, "added (quick booking)", `${venue?.name ?? "no venue"} ${date}`);
      id = booking.id;
    }
    const ref = id ? (await prisma.booking.findUnique({ where: { id }, select: { reference: true } }))?.reference : null;
    if (id && str(form, "notify") === "on") await notifyArtistsOfNewGigs([id]);
    revalidatePath("/", "layout");
    return { ok: `Booked ${artist.name}${venue ? ` at ${venue.name}` : ""}${ref ? ` (${ref})` : ""}.${weekly ? " Added to the venue's weekly schedule too." : ""}` };
  });
}
