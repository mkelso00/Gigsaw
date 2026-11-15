"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { owedOnInvoice } from "@/lib/act-invoice-rules";
import { issueActInvoice } from "@/lib/act-invoices";
import { requireStaff } from "@/lib/auth";
import { queueCalendarSync } from "@/lib/calendar-sync/queue";
import { logActivities, prisma } from "@/lib/db";
import { FormError, handleForm, str, type FormState } from "@/lib/forms";
import { formatMoney } from "@/lib/money";
import { outstanding } from "@/lib/payments";
import { localDateKey, zonedToUtc } from "@/lib/time";

/**
 * Mark acts' invoices paid from Pay acts: one ("one"), all of an act's ("act", with its "all_<act>" ids),
 * or the ticked ones ("id"). Each logs a payment out to the act on the gig for what's still owed on the
 * invoice, exactly as paying an act anywhere else in Gigsaw does, so the booking, Payments and reports all
 * agree. A gig that's been and gone and is now paid both ways is marked Settled, as from Payments.
 */
export async function markActInvoicesPaid(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const one = str(form, "one");
    const act = str(form, "act");
    const ids = (one ? [one] : act ? form.getAll(`all_${act}`) : form.getAll("id")).map(String).slice(0, 500);
    if (!ids.length) throw new FormError("Tick the invoices to mark paid first");
    const now = new Date();
    let count = 0;
    let total = 0;
    let currency = "GBP";
    const payments: Prisma.PaymentCreateManyInput[] = [];
    const settled: string[] = [];
    const log: { entityId: string; action: string; detail: string }[] = [];
    await prisma.$transaction(async (tx) => {
      const found = await tx.actInvoice.findMany({ where: { id: { in: ids }, agencyId: user.agencyId, status: "ISSUED" }, select: { bookingId: true } });
      const bookingIds = [...new Set(found.flatMap((f) => (f.bookingId ? [f.bookingId] : [])))];
      // The gigs are locked first, as in Payments, so a double tap waits and then finds nothing left to pay.
      if (bookingIds.length) await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ANY(${bookingIds}) ORDER BY id FOR UPDATE`;
      const invoices = await tx.actInvoice.findMany({
        where: { id: { in: ids }, agencyId: user.agencyId, status: "ISSUED" },
        include: { booking: { include: { payments: true } } },
        orderBy: { seq: "asc" },
      });
      currency = invoices[0]?.currency ?? "GBP";
      for (const inv of invoices) {
        const b = inv.booking;
        const owed = b ? owedOnInvoice(inv, b.payments) : 0;
        if (b && owed > 0) {
          const payment = {
            bookingId: b.id,
            direction: "OUT",
            kind: "SETTLEMENT",
            amountMinor: owed,
            paidAt: zonedToUtc(localDateKey(now, b.timezone), "12:00", b.timezone),
            note: `Invoice ${inv.number}`,
          };
          payments.push(payment);
          log.push({ entityId: b.id, action: "payment sent", detail: `${formatMoney(owed, b.currency)} for ${inv.number}` });
          const after = outstanding({ ...b, payments: [...b.payments, { ...payment, id: "", createdAt: now, cardPaymentId: null }] });
          if (b.status === "CONFIRMED" && b.setStart < now && after.toCollect === 0 && after.toPay === 0) {
            settled.push(b.id);
            log.push({ entityId: b.id, action: "settled", detail: "paid in and out" });
          }
        }
        count++;
        if (inv.currency === currency) total += owed;
      }
      if (payments.length) await tx.payment.createMany({ data: payments });
      await tx.actInvoice.updateMany({ where: { id: { in: invoices.map((i) => i.id) } }, data: { status: "PAID", paidAt: now } });
      if (settled.length) await tx.booking.updateMany({ where: { id: { in: settled } }, data: { status: "SETTLED" } });
    });
    queueCalendarSync(settled);
    await logActivities(user, "BOOKING", log);
    revalidatePath("/", "layout");
    if (!count) return { ok: "Already paid." };
    return { ok: `${count} invoice${count === 1 ? "" : "s"} marked paid (${formatMoney(total, currency)}).` };
  });
}

/** Make an act's invoice now, from Pay acts: for a gig the scheduler hasn't reached, or one older than it looks back. */
export async function makeActInvoice(bookingId: string, _: FormState, _form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const b = await prisma.booking.findFirst({ where: { id: bookingId, agencyId: user.agencyId }, select: { id: true } });
    if (!b) throw new FormError("Booking not found");
    const r = await issueActInvoice(b.id, { byHand: true });
    if ("skipped" in r) throw new FormError(r.skipped === "Already invoiced" ? "This gig already has an invoice." : r.skipped);
    revalidatePath("/", "layout");
    return { ok: `Invoice ${r.number} made.` };
  });
}
