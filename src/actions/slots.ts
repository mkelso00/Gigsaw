"use server";

import type { Artist } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireStaff, type AgencyUser } from "@/lib/auth";
import { createBookingWithReference, createBookingsWithReferences } from "@/lib/bookings";
import { queueCalendarSync } from "@/lib/calendar-sync/queue";
import { applyBulkChange } from "@/lib/bulk";
import { BOOKING_STATUSES, CURRENCIES, EVENT_TYPES, LIVE_STATUSES, MAX_COPY_DATES, type BookingStatus } from "@/lib/constants";
import { clashDates } from "@/lib/copy-booking";
import { getSettings, logActivities, logActivity, prisma } from "@/lib/db";
import { FormError, confirmed, handleForm, int, oneOf, optStr, str, type FormState } from "@/lib/forms";
import { findClashes } from "@/lib/clash-check";
import { defaultBookingFee, defaultVat, minorToInput, toMinor } from "@/lib/money";
import { notifyArtistsOfNewGigs } from "@/lib/notify";
import { offerResetFor } from "@/lib/offer-links";
import { sendOffers } from "@/lib/offers";
import { WEEKDAYS, dateInWeek, isDateKey, nextWeekday, slotRunsOn, weekStartOf, weekdayOf, weeklyDates } from "@/lib/rota";
import { buildSchedule } from "@/lib/schedule";
import { addDaysToKey, localDateKey, zonedToUtc } from "@/lib/time";
import { minutesBefore } from "@/lib/time";

const TIME = /^\d{2}:\d{2}$/;

/** "6 Feb 2027" for a "YYYY-MM-DD" day. */
const formatDay = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

/**
 * A slot's first and last dates, when the form has those boxes (forms without them leave the
 * slot's dates alone). Empty means from whenever, or until it's stopped.
 */
function slotDates(form: FormData): { startsOn?: string | null; endsOn?: string | null } {
  const out: { startsOn?: string | null; endsOn?: string | null } = {};
  for (const k of ["startsOn", "endsOn"] as const) {
    if (!form.has(k)) continue;
    const v = str(form, k);
    if (v && !isDateKey(v)) throw new FormError(k === "startsOn" ? "Choose the date it starts" : "Choose the last date, or leave it empty");
    out[k] = v || null;
  }
  if (out.startsOn && out.endsOn && out.endsOn < out.startsOn) throw new FormError("The last date is before the start date");
  return out;
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
    ...slotDates(form),
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
    const slots = await prisma.venueSlot.createManyAndReturn({
      data: days.map((weekday) => ({
        ...fields,
        weekday,
        venueId,
        agencyId: user.agencyId,
      })),
      include: { venue: true },
    });
    await logActivity(user, "VENUE", venueId, "added schedule slots", `${days.length} × ${fields.startTime}–${fields.endTime}`);
    // Straight into the calendar as gigs (Pending, so yellow until an act is booked), so a new weekly slot
    // shows up where people look for it straight away.
    const weeks = str(form, "fillCalendar") === "on" ? Math.min(Math.max(int(form, "fillWeeks") ?? 12, 1), 52) : 0;
    let made = 0;
    if (weeks) {
      const settings = await getSettings(user.agencyId);
      const today = localDateKey(new Date(), settings.defaultTimezone);
      const from = fields.startsOn && fields.startsOn > today ? fields.startsOn : today;
      for (const slot of slots) {
        for (let w = 0, date = nextWeekday(from, slot.weekday); w < weeks; w++, date = addDaysToKey(date, 7)) {
          if (!slotRunsOn(slot, date)) continue;
          if (await bookSlot(user, slot, date, null)) made++;
        }
      }
    }
    revalidatePath("/", "layout");
    const names = days
      .sort()
      .map((d) => WEEKDAYS[d - 1][1])
      .join(", ");
    const from = fields.startsOn ? ` from ${formatDay(fields.startsOn)}` : "";
    const until = fields.endsOn ? ` to ${formatDay(fields.endsOn)}` : "";
    const inCalendar = made ? ` ${made} gig${made === 1 ? " is" : "s are"} in the calendar now, yellow until an act is booked.` : "";
    return { ok: `Added: every ${names}${from}${until}, ${fields.startTime}–${fields.endTime}.${inCalendar}` };
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
        note = ` ${res.updated} upcoming booking${res.updated === 1 ? "" : "s"} updated${res.notified ? `, ${res.notified} artist message${res.notified === 1 ? "" : "s"} sent` : ""}.`;
      }
    }
    await logActivity(user, "VENUE", slot.venueId, "changed a schedule slot", `${fields.startTime}–${fields.endTime}`);
    revalidatePath("/", "layout");
    return { ok: `Slot saved.${note}` };
  });
}

/**
 * Delete a weekly slot that has nothing really booked from it, e.g. one added by mistake. Cancelled gigs don't
 * count, nor do the empty Pending gigs a new slot puts in the calendar (no act, nothing paid): those go with
 * it. One with real bookings is stopped instead (stopSlot), so its history stays with it.
 */
export async function deleteSlot(slotId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const slot = await ownSlot(user, slotId);
    const placeholder = { status: "PENDING", artistId: null, payments: { none: {} } } as const;
    const booked = await prisma.booking.count({ where: { slotId: slot.id, agencyId: user.agencyId, status: { not: "CANCELLED" }, NOT: placeholder } });
    if (booked) throw new FormError(`It has ${booked} booking${booked === 1 ? "" : "s"} made from it, so stop it from a date instead.`);
    await prisma.booking.deleteMany({ where: { slotId: slot.id, agencyId: user.agencyId, ...placeholder } });
    await prisma.venueSlot.delete({ where: { id: slot.id } });
    await logActivity(user, "VENUE", slot.venueId, "deleted a weekly slot", `${WEEKDAYS[slot.weekday - 1][2]} ${slot.startTime}–${slot.endTime}`);
    revalidatePath("/", "layout");
    return { ok: "Deleted." };
  });
}

/**
 * Stop a weekly slot: it runs up to and including the last date given, then no longer shows on
 * the rota or asks for an act. Bookings already made after that date are left alone, except that
 * the empty ones (no act yet, nothing paid) can be archived with it. Clearing the date starts it again.
 */
export async function stopSlot(slotId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const slot = await ownSlot(user, slotId);
    const last = str(form, "endsOn");
    if (!isDateKey(last)) throw new FormError("Choose the last date it runs");
    await prisma.venueSlot.update({ where: { id: slot.id }, data: { endsOn: last } });
    // Bookings after the last date, by their day at the venue.
    const after = zonedToUtc(addDaysToKey(last, 1), "00:00", slot.venue.timezone);
    const later = { slotId: slot.id, agencyId: user.agencyId, status: { not: "CANCELLED" }, arriveBy: { gte: after } };
    let archived = 0;
    if (str(form, "archiveEmpty") === "on") {
      const empty = await prisma.booking.findMany({ where: { ...later, artistId: null, payments: { none: {} } }, select: { id: true, reference: true } });
      if (empty.length) {
        await prisma.booking.updateMany({ where: { id: { in: empty.map((b) => b.id) } }, data: { archivedAt: new Date() } });
        queueCalendarSync(empty.map((b) => b.id));
        await logActivities(
          user,
          "BOOKING",
          empty.map((b) => ({ entityId: b.id, action: "archived (weekly slot stopped)", detail: b.reference })),
        );
        archived = empty.length;
      }
    }
    const kept = await prisma.booking.count({ where: later });
    await logActivity(user, "VENUE", slot.venueId, "stopped a weekly slot", `${WEEKDAYS[slot.weekday - 1][2]} ${slot.startTime}, last ${last}`);
    revalidatePath("/", "layout");
    return {
      ok: [
        `Stopped: the last one is ${formatDay(last)}.`,
        archived ? `${archived} empty booking${archived === 1 ? "" : "s"} after that archived.` : "",
        kept === 1 ? "1 booking after that is still in the calendar: cancel it on its page if it's off too." : "",
        kept > 1 ? `${kept} bookings after that are still in the calendar: cancel them on their own pages if they're off too.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  });
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
        data: {
          artistId: artist.id,
          status: statusOverride ?? slot.bookingStatus,
          agentId: artist.agentId ?? undefined,
          demo: slot.venue.demo || artist.demo,
          // Any link from an earlier act on this gig stops working.
          ...offerResetFor(existing, { artistId: artist.id }),
        },
      });
      queueCalendarSync(existing.id);
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
    vatPct: defaultVat(settings),
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
    if (!slotRunsOn(slot, date)) throw new FormError("This weekly slot isn't running on that date");
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
    // From a chosen date (or, as the rota used to send, the start of a week), never before a slot's own start.
    const from = str(form, "from") || str(form, "weekStart");
    if (!isDateKey(from)) throw new FormError("Choose the date to start from");
    const weekStart = weekStartOf(from);
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
        if (date < today || date < from || !slotRunsOn(slot, date)) continue;
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
    const span = `over ${weeks} week${weeks === 1 ? "" : "s"} from ${formatDay(from < today ? today : from)}`;
    const left = skipped.length
      ? ` ${skipped.length} left without an act because the regular act is busy elsewhere or away then: ${skipped.slice(0, 5).join("; ")}${skipped.length > 5 ? "…" : ""}.`
      : "";
    if (mode === "pending")
      return {
        ok: `Added ${created.length} booking${created.length === 1 ? "" : "s"} to the calendar ${span}, Pending with no act. Dates already in the calendar were left alone.`,
      };
    if (mode === "offer") {
      const people = await sendOffers(created);
      return {
        ok: `Offered ${created.length} booking${created.length === 1 ? "" : "s"} ${span}${people ? `: ${people} ${people === 1 ? "person was" : "people were"} sent their offers` : ""}.${left}`,
      };
    }
    const told = str(form, "notify") === "on" ? await notifyArtistsOfNewGigs(created) : 0;
    return {
      ok: `Booked ${created.length} booking${created.length === 1 ? "" : "s"} ${span}.${told ? ` ${told} act${told === 1 ? "" : "s"} sent a list of their new bookings.` : ""}${left}`,
    };
  });
}

/** The dates for "Repeat every week" (weekly=on): from the first date for so many weeks, or until a last date. */
function repeatDates(form: FormData, date: string) {
  if (str(form, "weekly") !== "on") return [date];
  const until = str(form, "until");
  if (until && !isDateKey(until)) throw new FormError("Choose the last date, or how many weeks");
  if (until && until < date) throw new FormError("The last date is before the first one");
  const weeks = Number(str(form, "weeks") || (until ? 0 : DEFAULT_REPEAT_WEEKS));
  if (!Number.isInteger(weeks) || weeks < 0) throw new FormError("Enter the number of weeks as a whole number, like 12");
  const { dates, more } = weeklyDates(date, { weeks, until: until || null, max: MAX_COPY_DATES });
  if (more || weeks > MAX_COPY_DATES) throw new FormError(`That's more than ${MAX_COPY_DATES} weeks. Pick an earlier last date, or fewer weeks.`);
  return dates;
}

/** How many weeks "Repeat every week" makes unless told otherwise: about three months. */
const DEFAULT_REPEAT_WEEKS = 12;

/**
 * Add a gig on any date: from the rota, or the quick "New booking" button. By default it's a
 * one-off. The venue can be left out for a one-off, e.g. a wedding.
 *  - "Repeat every week" (weekly=on, the quick booking form): the same booking on the same day
 *    every week from this date, as real bookings, for a number of weeks or until a last date.
 *  - "Every week" (repeat=on, the rota): adds weekly slots to the venue's schedule starting on
 *    this date, on the days ticked (weekday) or this date's day, up to an optional last date
 *    (endsOn), with this act as the regular, books the first date of each, and puts the next 11 weeks
 *    in the calendar as Pending.
 */
export async function addRotaGig(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const date = str(form, "date");
    if (!isDateKey(date)) throw new FormError("Choose a date");
    const dates = repeatDates(form, date);
    const weekly = str(form, "repeat") === "on" && str(form, "weekly") !== "on";
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
    const times = { arrive: fields.arriveTime, setStart: fields.startTime, setEnd: fields.endTime };
    const schedule = buildSchedule(date, times, tz);
    // A weekly slot starts on the chosen date, on each day ticked (or that date's day), and its
    // first date on each of those days is booked now.
    const slotDays = weekly ? [...new Set(form.getAll("weekday").map(Number))].filter((d) => d >= 1 && d <= 7).sort() : [];
    if (weekly && !slotDays.length) slotDays.push(weekdayOf(date));
    if (weekly && fields.endsOn && fields.endsOn < date) throw new FormError("The last date is before the start date");
    const firstDates = slotDays.map((d) => nextWeekday(date, d)).filter((d) => !fields.endsOn || d <= fields.endsOn);
    const checkDates = weekly ? firstDates : dates;

    if (artist && !confirmed(form) && LIVE_STATUSES.includes(status as BookingStatus) && checkDates.length > 1) {
      const busy = await clashDates(
        { agencyId: user.agencyId, artistId: artist.id, venueId: venue?.id ?? null, timezone: tz },
        times,
        checkDates,
        settings.changeoverMinutes,
      );
      if (busy.length) {
        return {
          confirm: {
            title: `Hold on: ${artist.name} may not be free on ${busy.length} of the ${checkDates.length} dates`,
            items: [...busy.slice(0, 10), ...(busy.length > 10 ? [`and ${busy.length - 10} more`] : [])],
            button: "Book them all anyway",
          },
        };
      }
    } else if (artist && !confirmed(form) && LIVE_STATUSES.includes(status as BookingStatus) && checkDates.length === 1) {
      const warnings = await findClashes(
        { agencyId: user.agencyId, artistId: artist.id, venueId: venue?.id ?? null, timezone: tz, ...buildSchedule(checkDates[0], times, tz) },
        settings.changeoverMinutes,
      );
      if (warnings.length) {
        return { confirm: { title: "Hold on: this act may not be free", items: warnings.map((w) => w.text), button: "Book anyway" } };
      }
    }

    if (dates.length > 1) {
      // Every week: real bookings on each date, made together like copies (one transaction).
      const made = await createBookingsWithReferences(
        user.agencyId,
        dates.map((d) => ({
          ...buildSchedule(d, times, tz),
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
          vatPct: defaultVat(settings),
        })),
      );
      const ids = made.map((m) => m.id);
      await logActivities(
        user,
        "BOOKING",
        made.map((m, i) => ({ entityId: m.id, action: "added (quick booking, every week)", detail: `${venue?.name ?? "no venue"} ${dates[i]}` })),
      );
      const offered = status === "AWAITING" ? await sendOffers(ids) : 0;
      if (status !== "AWAITING" && str(form, "notify") === "on") await notifyArtistsOfNewGigs(ids);
      revalidatePath("/", "layout");
      const span = `every ${WEEKDAYS[weekdayOf(date) - 1][2]} from ${formatDay(date)} to ${formatDay(dates.at(-1)!)} (${made[0].reference} to ${made.at(-1)!.reference})`;
      const at = venue ? ` at ${venue.name}` : "";
      const n = `${made.length} bookings`;
      return {
        ok: !artist
          ? `Added ${n}${at}, ${span}: Pending, each needs an act.`
          : status === "AWAITING"
            ? `Offered ${n} to ${artist.name}${at}, ${span}.${offered ? " They've been sent the offers." : " They have no email, phone or login on file: send the links from the bookings."}`
            : `Booked ${artist.name}${at}, ${n}, ${span}.`,
      };
    }

    if (weekly && venue) {
      const ids: string[] = [];
      let pendingAfter = 0;
      for (const weekday of slotDays) {
        const created = await prisma.venueSlot.create({
          data: { ...fields, startsOn: date, promoterId, agencyId: user.agencyId, venueId: venue.id, weekday },
          include: { venue: true },
        });
        const first = nextWeekday(date, weekday);
        if (slotRunsOn(created, first)) {
          const id = await bookSlot(user, created, first, artist?.id ?? null, status);
          if (id) ids.push(id);
        }
        // The weeks after the first go in the calendar too (Pending, yellow), so the slot is visible there
        // straight away. Open each one in the calendar to add an act.
        for (let w = 1, d = addDaysToKey(first, 7); w < 12; w++, d = addDaysToKey(d, 7)) {
          if (slotRunsOn(created, d) && (await bookSlot(user, created, d, null))) pendingAfter++;
        }
      }
      const days = slotDays.map((d) => WEEKDAYS[d - 1][2]).join(", ");
      await logActivity(user, "VENUE", venue.id, "added weekly slots", `${days} ${fields.startTime}–${fields.endTime} from ${date}`);
      const offered = ids.length && status === "AWAITING" ? await sendOffers(ids) : 0;
      if (ids.length && status !== "AWAITING" && str(form, "notify") === "on") await notifyArtistsOfNewGigs(ids);
      revalidatePath("/", "layout");
      const until = fields.endsOn ? ` to ${formatDay(fields.endsOn)}` : "";
      const firstOnes = !ids.length
        ? ""
        : !artist
          ? ` The first ${ids.length === 1 ? "one is" : `${ids.length} are`} in the calendar, Pending: open each one in the calendar to add an act.`
          : status === "AWAITING"
            ? ` Offered the first ${ids.length === 1 ? "one" : ids.length} to ${artist.name}.${offered ? " They've been sent the offer." : ""}`
            : ` Booked ${artist.name} for the first ${ids.length === 1 ? "one" : ids.length}.`;
      const later = pendingAfter ? ` The next ${pendingAfter} are in the calendar too, Pending (yellow) until an act is booked.` : "";
      return { ok: `Weekly at ${venue.name}: every ${days} from ${formatDay(date)}${until}, ${fields.startTime}–${fields.endTime}.${firstOnes}${later}` };
    }

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
      // The quick form has no VAT box: new bookings get the business's VAT on sales.
      vatPct: defaultVat(settings),
    });
    await logActivity(user, "BOOKING", booking.id, "added (quick booking)", `${venue?.name ?? "no venue"} ${date}`);
    const ref = booking.reference;
    const offered = status === "AWAITING" ? await sendOffers([booking.id]) : 0;
    if (status !== "AWAITING" && str(form, "notify") === "on") await notifyArtistsOfNewGigs([booking.id]);
    revalidatePath("/", "layout");
    const what = !artist
      ? `Added${venue ? ` at ${venue.name}` : ""}${ref ? ` (${ref})` : ""}: Pending, needs an act.`
      : status === "AWAITING"
        ? `Offered to ${artist.name}${venue ? ` at ${venue.name}` : ""}${ref ? ` (${ref})` : ""}.${offered ? " They've been sent the offer." : " They have no email, phone or login on file: send the link from the booking."}`
        : `Booked ${artist.name}${venue ? ` at ${venue.name}` : ""}${ref ? ` (${ref})` : ""}.`;
    return { ok: what };
  });
}
