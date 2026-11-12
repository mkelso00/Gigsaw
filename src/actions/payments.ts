"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { queueCalendarSync } from "@/lib/calendar-sync/queue";
import { logActivities, prisma } from "@/lib/db";
import { FormError, handleForm, str, type FormState } from "@/lib/forms";
import { formatMoney } from "@/lib/money";
import { outstanding } from "@/lib/payments";
import { localDateKey, zonedToUtc } from "@/lib/time";

/**
 * Mark gigs as paid in full one way: money in from the venue or client, or out to the act.
 * Logs a payment for whatever is still owed on each. A gig that's been and gone and is now
 * paid both ways is marked Settled.
 */
export async function markPaid(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const direction = str(form, "direction") === "OUT" ? "OUT" : "IN";
    const ids = form.getAll("id").map(String).slice(0, 500);
    if (!ids.length) throw new FormError("Nothing to mark as paid");
    let count = 0;
    let total = 0;
    let currency = "GBP";
    const now = new Date();
    // Worked out gig by gig, then saved in a few queries rather than several per gig.
    const payments: Prisma.PaymentCreateManyInput[] = [];
    const settled: string[] = [];
    const log: { entityId: string; action: string; detail: string }[] = [];
    // The gigs are locked while what's owed is worked out and logged, so a double tap (or two
    // people at once) waits for the first and then finds nothing left to log.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ANY(${ids}) AND "agencyId" = ${user.agencyId} ORDER BY id FOR UPDATE`;
      const gigs = await tx.booking.findMany({
        where: { id: { in: ids }, agencyId: user.agencyId, status: { in: ["CONFIRMED", "SETTLED"] } },
        include: { payments: true },
      });
      currency = gigs[0]?.currency ?? "GBP";
      for (const b of gigs) {
        const o = outstanding(b);
        const amount = direction === "IN" ? o.toCollect : o.toPay;
        if (amount <= 0) continue;
        const today = localDateKey(now, b.timezone);
        const payment = {
          bookingId: b.id,
          direction,
          kind: direction === "IN" ? "BALANCE" : "SETTLEMENT",
          amountMinor: amount,
          paidAt: zonedToUtc(today, "12:00", b.timezone),
          note: "Marked paid from Payments",
        };
        payments.push(payment);
        count++;
        if (b.currency === currency) total += amount;
        log.push({ entityId: b.id, action: direction === "IN" ? "payment received" : "payment sent", detail: formatMoney(amount, b.currency) });
        // Paid both ways and the gig has happened: it's settled.
        const after = outstanding({ ...b, payments: [...b.payments, payment] });
        if (b.status === "CONFIRMED" && b.setStart < now && after.toCollect === 0 && after.toPay === 0) {
          settled.push(b.id);
          log.push({ entityId: b.id, action: "settled", detail: "paid in and out" });
        }
      }
      if (payments.length) await tx.payment.createMany({ data: payments });
      if (settled.length) await tx.booking.updateMany({ where: { id: { in: settled } }, data: { status: "SETTLED" } });
    });
    queueCalendarSync(settled);
    await logActivities(user, "BOOKING", log);
    revalidatePath("/", "layout");
    if (!count) return { ok: "Already paid." };
    return { ok: `${count} booking${count === 1 ? "" : "s"} marked paid (${formatMoney(total, currency)} ${direction === "IN" ? "in" : "out"}).` };
  });
}
