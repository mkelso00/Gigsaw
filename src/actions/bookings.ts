"use server";

import { receiptQuietly } from "@/lib/receipts";
import { secureEventQuietly } from "@/lib/secure-event";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { syncActInvoicePaid } from "@/lib/act-invoices";
import { notifyClientOfArrival } from "@/lib/alerts";
import { notifyArtistIfChanged, notifyArtistsOfNewGigs, snapshotOf } from "@/lib/notify";
import { requireAdmin, requireStaff, type AgencyUser } from "@/lib/auth";
import { createBookingWithReference, needsAct, parseBookingForm } from "@/lib/bookings";
import { queueCalendarSync } from "@/lib/calendar-sync/queue";
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, CHECK_IN_KINDS, LIVE_STATUSES, PAYMENT_KINDS, type BookingStatus } from "@/lib/constants";
import { onConfirmed } from "@/lib/confirmations";
import { offerResetFor } from "@/lib/offer-links";
import { sendOffers } from "@/lib/offers";
import { findClashes } from "@/lib/clash-check";
import { logBookedAnyway, mergeHolds, signupGate } from "@/lib/book-signed-up-server";
import { getSettings, logActivities, logActivity, prisma } from "@/lib/db";
import { FormError, confirmed, handleForm, oneOf, required, str, type FormState } from "@/lib/forms";
import { formatMoney, toMinor } from "@/lib/money";
import { localDateKey, zonedToUtc } from "@/lib/time";
import { applyVenuePlan, planVenueChange, VENUE_SCOPES, venueConfirm, weekdayName } from "@/lib/venue-change";
import { cleanDates, copyBookingToDates } from "@/lib/copy-booking";
import { MAX_COPY_DATES } from "@/lib/constants";
import { log } from "@/server/log";

/** A booking that belongs to the user's agency. Anything else is treated as not found. */
async function ownBooking(user: AgencyUser, bookingId: string) {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, agencyId: user.agencyId }, include: { venue: { select: { name: true } } } });
  if (!booking) throw new FormError("Booking not found");
  return booking;
}

/** Ask the user to check possible double bookings before saving, unless they already said "Save anyway". */
async function clashCheck(
  user: AgencyUser,
  form: FormData,
  data: { artistId: string | null; venueId: string | null; arriveBy: Date; setStart: Date; setEnd: Date | null; timezone: string; status: string },
  changeoverMinutes: number,
  excludeId?: string,
): Promise<FormState | null> {
  if (confirmed(form) || !LIVE_STATUSES.includes(data.status as BookingStatus)) return null;
  const warnings = await findClashes({ ...data, agencyId: user.agencyId, excludeId }, changeoverMinutes);
  if (!warnings.length) return null;
  return {
    confirm: {
      title: warnings.some((w) => w.level === "clash")
        ? "Hold on: this artist is already booked at that time"
        : warnings.every((w) => w.level === "away")
          ? "Hold on: this act has said they can't play that day"
          : "Hold on: check there's time to get between bookings",
      items: warnings.map((w) => w.text),
      button: "Save anyway",
    },
  };
}

export async function createBooking(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  let id = "";
  const result = await handleForm(async () => {
    const settings = await getSettings(user.agencyId);
    const data = await parseBookingForm(form, settings, user.agencyId, { requireVenue: true });
    // An act who hasn't signed up to Gigsaw yet: refused, or for an admin "Book anyway" (src/lib/book-signed-up.ts).
    const gate = await signupGate(user, [data.artistId], confirmed(form));
    const hold = mergeHolds(gate.hold, await clashCheck(user, form, data, settings.changeoverMinutes));
    if (hold) return hold;
    const booking = await createBookingWithReference(user.agencyId, { ...data, createdById: user.id, agentId: data.agentId ?? user.id });
    await logActivity(user, "BOOKING", booking.id, "created", booking.reference);
    await logBookedAnyway(user, [booking.id], gate.overridden);
    if (booking.status === "AWAITING") await offerAndLog(user, booking.id);
    id = booking.id;
  });
  if (result?.error || result?.confirm) return result;
  revalidatePath("/", "layout");
  redirect(`/bookings/${id}`);
}

export async function updateBooking(bookingId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  const result = await handleForm(async () => {
    const old = await ownBooking(user, bookingId);
    const before = snapshotOf(old);
    const settings = await getSettings(user.agencyId);
    // A gig that has a venue can't lose it; an older one saved without can still be edited.
    const data = await parseBookingForm(form, settings, user.agencyId, { inEvent: !!old.eventId, requireVenue: !!old.venueId });
    // Only a different act is checked for signing up: the act already on the booking stays, whatever else changes.
    const gate = data.artistId && data.artistId !== old.artistId ? await signupGate(user, [data.artistId], confirmed(form)) : { hold: null, overridden: [] };
    const hold = mergeHolds(gate.hold, await clashCheck(user, form, data, settings.changeoverMinutes, bookingId));
    const alsoChange = await venueChangeFor(old, data, form);
    // Copying to other bookings always asks first. One box covers that and any double booking warning,
    // because a single "Save anyway" answers both.
    if (alsoChange && !confirmed(form)) {
      const ask = venueConfirm(alsoChange.plan, alsoChange.opts);
      return { confirm: { ...ask, items: [...(hold?.confirm?.items ?? []), ...ask.items] } };
    }
    if (hold) return hold;
    // A different act or a cancellation ends the old offer link.
    await prisma.booking.update({ where: { id: bookingId }, data: { ...data, ...offerResetFor(old, data) } });
    // Also takes it out of the old act's calendars when the act changed.
    queueCalendarSync(bookingId);
    await logActivity(user, "BOOKING", bookingId, "updated");
    await logBookedAnyway(user, [bookingId], gate.overridden);
    // The other bookings at the venue. This one isn't among them (it's told below), so each act hears once per booking.
    if (alsoChange) await applyVenuePlan(user, bookingId, alsoChange.plan, alsoChange.opts);
    if (data.status === "CONFIRMED" && old.status !== "CONFIRMED") await onConfirmed(bookingId);
    // Newly awaiting confirmation, or a different act: send the offer.
    if (data.status === "AWAITING" && (old.status !== "AWAITING" || old.artistId !== data.artistId)) {
      await offerAndLog(user, bookingId);
      return;
    }
    if (str(form, "notifyArtist") === "on") {
      const changes = await notifyArtistIfChanged(before, bookingId);
      if (changes.length) await logActivity(user, "BOOKING", bookingId, "artist told about changes", changes.map((c) => c[0]).join(", "));
    }
  });
  if (result?.error || result?.confirm) return result;
  revalidatePath("/", "layout");
  redirect(`/bookings/${bookingId}`);
}

/**
 * "Also change other bookings at <venue>" on the edit form: what copying this save would do, or null for
 * only this booking. Refuses when there's nothing to copy or no venue to copy within.
 */
async function venueChangeFor(old: Awaited<ReturnType<typeof ownBooking>>, data: Awaited<ReturnType<typeof parseBookingForm>>, form: FormData) {
  const scope = oneOf(str(form, "alsoChange"), VENUE_SCOPES, "ONE");
  if (scope === "ONE") return null;
  const venueName = old.venue?.name;
  if (!old.venueId || !venueName) throw new FormError("This booking has no venue, so there are no other bookings to change. Choose Only this booking.");
  if (data.venueId !== old.venueId) {
    throw new FormError(`You've changed the venue, so this can't be copied to bookings at ${venueName}. Choose Only this booking to save it.`);
  }
  const plan = await planVenueChange(old, data, scope);
  if (!plan.change.labels.length) {
    throw new FormError(
      plan.change.moneyHeldBack
        ? "You changed the currency, so the sale and cost can't go to other bookings. Choose Only this booking to save it."
        : "None of your changes can go to other bookings: only times, itinerary, notes, sale and cost can. Choose Only this booking to save it.",
    );
  }
  if (!plan.rows.length) throw new FormError(`There are no other upcoming bookings at ${venueName} to change. Choose Only this booking to save it.`);
  return { plan, opts: { scope, venueName, weekday: weekdayName(old), notify: str(form, "notifyArtist") === "on" } };
}

/** Change a gig's status from its page. Awaiting confirmation sends the act the offer. */
export async function setBookingStatus(bookingId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const status = oneOf(str(form, "status"), BOOKING_STATUSES, "PENDING");
    const before = await ownBooking(user, bookingId);
    if (before.status === status) return { ok: "No change." };
    if (!before.artistId && needsAct(status, !!before.eventId))
      throw new FormError(`Add an act first (Edit), then set it to ${BOOKING_STATUS_LABELS[status]}.`);
    await prisma.booking.update({ where: { id: bookingId }, data: { status, ...offerResetFor(before, { status }) } });
    queueCalendarSync(bookingId);
    await logActivity(
      user,
      "BOOKING",
      bookingId,
      "status changed",
      `${BOOKING_STATUS_LABELS[before.status as keyof typeof BOOKING_STATUS_LABELS] ?? before.status} → ${BOOKING_STATUS_LABELS[status]}`,
    );
    revalidatePath("/", "layout");
    if (status === "AWAITING") {
      const n = await offerAndLog(user, bookingId);
      return {
        ok: n
          ? "Offer sent to the act. You'll get an email when they answer."
          : "Set to Awaiting confirmation. The act has no email, phone or login on file, so share the offer link from this page.",
      };
    }
    if (status === "CONFIRMED") {
      await onConfirmed(bookingId);
      return { ok: "Confirmed. The act has been told it's booked." };
    }
    await notifyArtistIfChanged(snapshotOf(before), bookingId);
    return { ok: `Now ${BOOKING_STATUS_LABELS[status]}.` };
  });
}

/** Send (or send again) the offer to the act for a gig awaiting confirmation. */
export async function resendOffer(bookingId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const b = await ownBooking(user, bookingId);
    if (b.status !== "AWAITING" || !b.artistId) throw new FormError("Set the status to Awaiting confirmation first");
    const n = await offerAndLog(user, bookingId);
    revalidatePath(`/bookings/${bookingId}`);
    return { ok: n ? "Offer sent again." : "No email, phone or login on file for this act: copy the link and send it yourself." };
  });
}

async function offerAndLog(user: AgencyUser, bookingId: string) {
  const n = await sendOffers([bookingId]);
  await logActivity(user, "BOOKING", bookingId, "offer sent to the act");
  return n;
}

export async function deleteBooking(bookingId: string) {
  const user = await requireAdmin();
  const b = await ownBooking(user as AgencyUser, bookingId);
  // Only archived bookings can be deleted, so nothing live is lost by mistake.
  if (!b.archivedAt) return;
  await prisma.booking.delete({ where: { id: b.id } });
  // The calendar links outlive the booking (they're found by its id), so its events can still be removed.
  queueCalendarSync(b.id);
  await logActivity(user, "BOOKING", bookingId, "deleted", b.reference);
  revalidatePath("/", "layout");
  redirect("/bookings");
}

const tickedIds = (form: FormData) => form.getAll("ids").map(String).slice(0, 500);

/** Archive the ticked bookings: out of every list and calendar, but kept and easy to bring back. */
export async function archiveBookings(form: FormData) {
  const user = await requireStaff();
  const ids = tickedIds(form);
  if (!ids.length) return;
  const gigs = await prisma.booking.findMany({ where: { id: { in: ids }, agencyId: user.agencyId }, select: { id: true, reference: true } });
  await prisma.booking.updateMany({ where: { id: { in: gigs.map((g) => g.id) }, agencyId: user.agencyId }, data: { archivedAt: new Date() } });
  queueCalendarSync(gigs.map((g) => g.id));
  await logActivities(
    user,
    "BOOKING",
    gigs.map((g) => ({ entityId: g.id, action: "archived", detail: g.reference })),
  );
  revalidatePath("/", "layout");
}

/** Bring archived bookings back. */
export async function restoreBookings(form: FormData) {
  const user = await requireStaff();
  const ids = tickedIds(form);
  if (!ids.length) return;
  const where = { id: { in: ids }, agencyId: user.agencyId, archivedAt: { not: null } };
  const gigs = await prisma.booking.findMany({ where, select: { id: true, reference: true } });
  await prisma.booking.updateMany({ where, data: { archivedAt: null } });
  queueCalendarSync(gigs.map((g) => g.id));
  await logActivities(
    user,
    "BOOKING",
    gigs.map((g) => ({ entityId: g.id, action: "restored from the archive", detail: g.reference })),
  );
  revalidatePath("/", "layout");
}

/** Delete archived bookings for good (admins only). Only archived ones can go, so nothing live is lost by mistake. */
export async function deleteBookings(form: FormData) {
  const user = await requireAdmin();
  const ids = tickedIds(form);
  if (!ids.length) return;
  const where = { id: { in: ids }, agencyId: user.agencyId!, archivedAt: { not: null } };
  const gigs = await prisma.booking.findMany({ where, select: { id: true, reference: true } });
  await prisma.booking.deleteMany({ where });
  // Ids read before deleting: the calendar links are found by them.
  queueCalendarSync(gigs.map((g) => g.id));
  await logActivities(
    user,
    "BOOKING",
    gigs.map((g) => ({ entityId: g.id, action: "deleted", detail: g.reference })),
  );
  revalidatePath("/", "layout");
}

/**
 * Delete the ticked bookings in one go, straight from the list (admins only), e.g. a run of gigs added by
 * mistake. Money is never lost this way: gigs with payments, or that are settled, are archived instead
 * (and can be deleted for good from Archived once checked). Then back to the list, saying what happened.
 */
export async function deleteSelectedBookings(form: FormData) {
  const user = await requireAdmin();
  const ids = tickedIds(form);
  const back = safeBack(str(form, "back"));
  if (!ids.length) redirect(back);
  const gigs = await prisma.booking.findMany({
    where: { id: { in: ids }, agencyId: user.agencyId! },
    select: { id: true, reference: true, status: true, _count: { select: { payments: true } } },
  });
  const keep = gigs.filter((g) => g._count.payments > 0 || g.status === "SETTLED");
  const go = gigs.filter((g) => !keep.includes(g));
  if (go.length) await prisma.booking.deleteMany({ where: { id: { in: go.map((g) => g.id) }, agencyId: user.agencyId! } });
  if (keep.length)
    await prisma.booking.updateMany({ where: { id: { in: keep.map((g) => g.id) }, agencyId: user.agencyId! }, data: { archivedAt: new Date() } });
  // Ids read before deleting: the calendar links are found by them.
  queueCalendarSync(gigs.map((g) => g.id));
  await logActivities(user, "BOOKING", [
    ...go.map((g) => ({ entityId: g.id, action: "deleted", detail: g.reference })),
    ...keep.map((g) => ({ entityId: g.id, action: "archived (has payments, so not deleted)", detail: g.reference })),
  ]);
  revalidatePath("/", "layout");
  redirect(`${back}${back.includes("?") ? "&" : "?"}deleted=${go.length}${keep.length ? `&kept=${keep.length}` : ""}`);
}

/** Only the bookings list (with its filters), so the form can't send anyone elsewhere. */
function safeBack(raw: string) {
  try {
    const u = new URL(raw || "/bookings", "http://x");
    if (u.origin !== "http://x" || u.pathname !== "/bookings") return "/bookings";
    u.searchParams.delete("deleted");
    u.searchParams.delete("kept");
    return `/bookings${u.search}`;
  } catch {
    return "/bookings";
  }
}

/** Archive or restore one booking from its page. */
export async function setBookingArchived(bookingId: string, archived: boolean) {
  const user = await requireStaff();
  const b = await ownBooking(user, bookingId);
  await prisma.booking.update({ where: { id: b.id }, data: { archivedAt: archived ? new Date() : null } });
  queueCalendarSync(b.id);
  await logActivity(user, "BOOKING", b.id, archived ? "archived" : "restored from the archive", b.reference);
  revalidatePath("/", "layout");
  if (archived) redirect("/bookings");
}

export async function addPayment(bookingId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const booking = await ownBooking(user, bookingId);
    const direction = str(form, "direction") === "OUT" ? "OUT" : "IN";
    const kind = oneOf(str(form, "kind"), PAYMENT_KINDS, "BALANCE");
    let amountMinor: number;
    try {
      amountMinor = toMinor(required(form, "amount", "Amount"), booking.currency);
    } catch (e) {
      if (e instanceof FormError) throw e;
      throw new FormError("Enter the amount as a number, like 500.00");
    }
    if (amountMinor <= 0) throw new FormError("Amount must be more than zero");
    const date = str(form, "paidAt") || localDateKey(new Date(), booking.timezone);
    await prisma.payment.create({
      data: { bookingId, direction, kind, amountMinor, paidAt: zonedToUtc(date, "12:00", booking.timezone), note: str(form, "note") },
    });
    // Paying the act by hand here counts towards their invoice, so there's one record of what they've had.
    if (direction === "OUT") await syncActInvoicePaid([bookingId]);
    // Money in on a wedding's gig may be the deposit that books it (src/lib/secure-event.ts). If so, the
    // couple's "you're booked" email says it's arrived, so the plain receipt isn't sent as well.
    const secured = direction === "IN" ? await secureEventQuietly(booking.eventId) : null;
    // The customer hears it's arrived (weddings and private customers only; sendPaymentReceipt checks).
    if (direction === "IN" && str(form, "receipt") === "on" && !secured?.told) await receiptQuietly({ bookingId, amountMinor });
    await logActivity(
      user,
      "BOOKING",
      bookingId,
      direction === "IN" ? "payment received" : "payment sent",
      `${kind.toLowerCase()} ${formatMoney(amountMinor, booking.currency)}`,
    );
    revalidatePath(`/bookings/${bookingId}`);
    return { ok: "Payment logged." };
  });
}

export async function deletePayment(paymentId: string) {
  const user = await requireStaff();
  const p = await prisma.payment.findFirst({ where: { id: paymentId, booking: { agencyId: user.agencyId } } });
  if (!p) return;
  await prisma.payment.delete({ where: { id: p.id } });
  // Taking off a payment to the act puts their invoice back to unpaid.
  if (p.direction === "OUT") await syncActInvoicePaid([p.bookingId]);
  await logActivity(user, "BOOKING", p.bookingId, "payment removed");
  revalidatePath(`/bookings/${p.bookingId}`);
}

/** The agency logs an arrival on the artist's behalf, e.g. the promoter rang to say they are in. */
export async function logCheckInForArtist(bookingId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const booking = await ownBooking(user, bookingId);
    const kind = oneOf(str(form, "kind"), CHECK_IN_KINDS, "ARRIVED");
    const time = str(form, "time");
    let at = new Date();
    if (time) {
      const date = str(form, "date") || localDateKey(new Date(), booking.timezone);
      at = zonedToUtc(date, time, booking.timezone);
    }
    if (at.getTime() > Date.now() + 5 * 60_000) throw new FormError("You can't log a check-in in the future");
    if (!booking.artistId) throw new FormError("Add an act to this booking first");
    await prisma.checkIn.create({
      data: { bookingId, artistId: booking.artistId!, userId: user.id, kind, source: "AGENT", at, note: str(form, "note") },
    });
    await logActivity(user, "BOOKING", bookingId, "check-in logged by agency", kind.toLowerCase().replaceAll("_", " "));
    if (kind === "ARRIVED") await notifyClientOfArrival(bookingId).catch((e) => log.error("Client arrival message failed", { bookingId, err: e }));
    revalidatePath("/", "layout");
    return { ok: "Check-in logged." };
  });
}

export async function deleteCheckIn(checkInId: string) {
  const user = await requireStaff();
  const c = await prisma.checkIn.findFirst({ where: { id: checkInId, booking: { agencyId: user.agencyId } } });
  if (!c) return;
  await prisma.checkIn.delete({ where: { id: c.id } });
  await logActivity(user, "BOOKING", c.bookingId, "check-in removed", c.kind.toLowerCase().replaceAll("_", " "));
  revalidatePath("/", "layout");
}

export type CopyResult = { ok: boolean; message: string; ids: string[]; confirm?: NonNullable<FormState>["confirm"] };

/**
 * Copy a booking to other dates: same venue, times, money, act and details, as new gigs with
 * no payments or check-ins. The copies take the chosen status: Pending, Awaiting confirmation
 * (the act gets one message listing all the offers) or Confirmed. Up to MAX_COPY_DATES at once,
 * saved together in one transaction (copyBookingToDates).
 */
export async function copyBooking(bookingId: string, dates: string[], status: string, keepAct: boolean, anyway = false): Promise<CopyResult> {
  const user = await requireStaff();
  const b = await ownBooking(user, bookingId);
  const unique = cleanDates(dates);
  if (!unique.length) return { ok: false, message: "Pick at least one date.", ids: [] };
  if (unique.length > MAX_COPY_DATES) return { ok: false, message: `That's a lot of dates: copy up to ${MAX_COPY_DATES} at once.`, ids: [] };
  const artistId = keepAct ? b.artistId : null;
  // Copies that keep the act are new bookings for it: an act who hasn't signed up yet is refused, or for an admin
  // "Book anyway" (`anyway`, src/lib/book-signed-up.ts). Copies without the act are always fine.
  let gate: Awaited<ReturnType<typeof signupGate>>;
  try {
    gate = await signupGate(user, [artistId], anyway);
  } catch (e) {
    if (e instanceof FormError) return { ok: false, message: e.message, ids: [] };
    throw e;
  }
  if (gate.hold?.confirm) return { ok: false, message: gate.hold.confirm.title, ids: [], confirm: gate.hold.confirm };
  const wanted = oneOf(status, ["PENDING", "AWAITING", "CONFIRMED"] as const, "PENDING");
  // No act: the copies are Pending whatever was chosen.
  const finalStatus = artistId ? wanted : "PENDING";
  const settings = await getSettings(user.agencyId);
  const { ids, clashes } = await copyBookingToDates(user, b, unique, { status: finalStatus, artistId, settings });
  await logActivity(user, "BOOKING", bookingId, "copied", `${ids.length} date${ids.length === 1 ? "" : "s"}`);
  await logBookedAnyway(user, ids, gate.overridden);
  if (finalStatus === "AWAITING") await sendOffers(ids);
  if (finalStatus === "CONFIRMED") await notifyArtistsOfNewGigs(ids);
  revalidatePath("/", "layout");
  const label = BOOKING_STATUS_LABELS[finalStatus];
  return {
    ok: true,
    ids,
    message: `Copied to ${ids.length} date${ids.length === 1 ? "" : "s"} as ${label}${finalStatus === "AWAITING" ? ": the act has been sent the offers" : ""}.${
      clashes.length ? ` Check ${clashes.slice(0, 5).join(", ")}${clashes.length > 5 ? "…" : ""}: the act may have another booking then.` : ""
    }`,
  };
}
