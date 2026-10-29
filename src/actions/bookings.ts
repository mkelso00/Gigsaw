"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { notifyClientOfArrival } from "@/lib/alerts";
import { notifyArtistIfChanged, snapshotOf } from "@/lib/notify";
import { requireStaff, type AgencyUser } from "@/lib/auth";
import { createBookingWithReference, parseBookingForm } from "@/lib/bookings";
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, CHECK_IN_KINDS, LIVE_STATUSES, NEEDS_ACT, PAYMENT_KINDS, type BookingStatus } from "@/lib/constants";
import { onConfirmed } from "@/lib/confirmations";
import { sendOffers } from "@/lib/offers";
import { findClashes } from "@/lib/clash-check";
import { getSettings, logActivity, prisma } from "@/lib/db";
import { FormError, confirmed, handleForm, oneOf, required, str, type FormState } from "@/lib/forms";
import { formatMoney, toMinor } from "@/lib/money";
import { localDateKey, zonedToUtc } from "@/lib/time";

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
        : "Hold on: check there's time to get between gigs",
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
    const data = await parseBookingForm(form, settings, user.agencyId);
    const hold = await clashCheck(user, form, data, settings.changeoverMinutes);
    if (hold) return hold;
    const booking = await createBookingWithReference(user.agencyId, { ...data, createdById: user.id, agentId: data.agentId ?? user.id });
    await logActivity(user, "BOOKING", booking.id, "created", booking.reference);
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
    const data = await parseBookingForm(form, settings, user.agencyId);
    const hold = await clashCheck(user, form, data, settings.changeoverMinutes, bookingId);
    if (hold) return hold;
    await prisma.booking.update({ where: { id: bookingId }, data });
    await logActivity(user, "BOOKING", bookingId, "updated");
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

/** Change a gig's status from its page. Awaiting confirmation sends the act the offer. */
export async function setBookingStatus(bookingId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const status = oneOf(str(form, "status"), BOOKING_STATUSES, "PENDING");
    const before = await ownBooking(user, bookingId);
    if (before.status === status) return { ok: "No change." };
    if (!before.artistId && NEEDS_ACT.includes(status)) throw new FormError(`Add an act first (Edit), then set it to ${BOOKING_STATUS_LABELS[status]}.`);
    await prisma.booking.update({ where: { id: bookingId }, data: { status } });
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
  const user = await requireStaff();
  const b = await ownBooking(user, bookingId);
  await prisma.booking.delete({ where: { id: b.id } });
  await logActivity(user, "BOOKING", bookingId, "deleted", b.reference);
  revalidatePath("/", "layout");
  redirect("/bookings");
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
    if (!booking.artistId) throw new FormError("Add an act to this gig first");
    await prisma.checkIn.create({
      data: { bookingId, artistId: booking.artistId!, userId: user.id, kind, source: "AGENT", at, note: str(form, "note") },
    });
    await logActivity(user, "BOOKING", bookingId, "check-in logged by agency", kind.toLowerCase().replaceAll("_", " "));
    if (kind === "ARRIVED") await notifyClientOfArrival(bookingId).catch((e) => console.error("[gigsaw] client arrival message failed", e));
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
