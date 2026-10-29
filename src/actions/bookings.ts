"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createBookingWithReference, parseBookingForm } from "@/lib/bookings";
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, CHECK_IN_KINDS, PAYMENT_KINDS } from "@/lib/constants";
import { getSettings, logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, oneOf, required, str, type FormState } from "@/lib/forms";
import { formatMoney, toMinor } from "@/lib/money";
import { localDateKey, zonedToUtc } from "@/lib/time";

export async function createBooking(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  let id = "";
  const result = await handleForm(async () => {
    const data = await parseBookingForm(form, await getSettings());
    const booking = await createBookingWithReference({ ...data, createdById: user.id, agentId: data.agentId ?? user.id });
    await logActivity(user.id, "BOOKING", booking.id, "created", booking.reference);
    id = booking.id;
  });
  if (result?.error) return result;
  revalidatePath("/", "layout");
  redirect(`/bookings/${id}`);
}

export async function updateBooking(bookingId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  const result = await handleForm(async () => {
    const data = await parseBookingForm(form, await getSettings());
    await prisma.booking.update({ where: { id: bookingId }, data });
    await logActivity(user.id, "BOOKING", bookingId, "updated");
  });
  if (result?.error) return result;
  revalidatePath("/", "layout");
  redirect(`/bookings/${bookingId}`);
}

export async function setBookingStatus(bookingId: string, form: FormData) {
  const user = await requireStaff();
  const status = oneOf(str(form, "status"), BOOKING_STATUSES, "HOLD");
  const before = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { status: true } });
  if (before.status !== status) {
    await prisma.booking.update({ where: { id: bookingId }, data: { status } });
    await logActivity(user.id, "BOOKING", bookingId, "status changed", `${BOOKING_STATUS_LABELS[before.status as keyof typeof BOOKING_STATUS_LABELS] ?? before.status} → ${BOOKING_STATUS_LABELS[status]}`);
  }
  revalidatePath("/", "layout");
}

export async function deleteBooking(bookingId: string) {
  const user = await requireStaff();
  const b = await prisma.booking.delete({ where: { id: bookingId } });
  await logActivity(user.id, "BOOKING", bookingId, "deleted", b.reference);
  revalidatePath("/", "layout");
  redirect("/bookings");
}

export async function addPayment(bookingId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
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
    await logActivity(user.id, "BOOKING", bookingId, direction === "IN" ? "payment received" : "payment sent", `${kind.toLowerCase()} ${formatMoney(amountMinor, booking.currency)}`);
    revalidatePath(`/bookings/${bookingId}`);
    return { ok: "Payment logged." };
  });
}

export async function deletePayment(paymentId: string) {
  const user = await requireStaff();
  const p = await prisma.payment.delete({ where: { id: paymentId } });
  await logActivity(user.id, "BOOKING", p.bookingId, "payment removed");
  revalidatePath(`/bookings/${p.bookingId}`);
}

/** The agency logs an arrival on the artist's behalf, e.g. the promoter rang to say they are in. */
export async function logCheckInForArtist(bookingId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const kind = oneOf(str(form, "kind"), CHECK_IN_KINDS, "ARRIVED");
    const time = str(form, "time");
    let at = new Date();
    if (time) {
      const date = str(form, "date") || localDateKey(new Date(), booking.timezone);
      at = zonedToUtc(date, time, booking.timezone);
    }
    if (at.getTime() > Date.now() + 5 * 60_000) throw new FormError("You can't log a check-in in the future");
    await prisma.checkIn.create({
      data: { bookingId, artistId: booking.artistId, userId: user.id, kind, source: "AGENT", at, note: str(form, "note") },
    });
    await logActivity(user.id, "BOOKING", bookingId, "check-in logged by agency", kind.toLowerCase().replaceAll("_", " "));
    revalidatePath("/", "layout");
    return { ok: "Check-in logged." };
  });
}

export async function deleteCheckIn(checkInId: string) {
  const user = await requireStaff();
  const c = await prisma.checkIn.delete({ where: { id: checkInId } });
  await logActivity(user.id, "BOOKING", c.bookingId, "check-in removed", c.kind.toLowerCase().replaceAll("_", " "));
  revalidatePath("/", "layout");
}
