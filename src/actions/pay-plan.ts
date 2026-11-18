"use server";

import { receiptQuietly } from "@/lib/receipts";
import { revalidatePath } from "next/cache";
import { syncActInvoicePaid } from "@/lib/act-invoices";
import { requireStaff } from "@/lib/auth";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, str, type FormState } from "@/lib/forms";
import { formatMoney } from "@/lib/money";
import { DIRECT_NOTE, directSplit, isDirectPlan, isPayPlan, PAY_PLAN_LABELS } from "@/lib/pay-plan";

// A wedding or event's "How the couple pays" (src/lib/pay-plan.ts), and marking an act's part paid
// when the couple paid them straight (cash on the day or bank transfer).

export async function setPayPlan(eventId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const plan = str(form, "payPlan");
    if (!isPayPlan(plan)) throw new FormError("Choose how the couple pays");
    const e = await prisma.event.findFirst({ where: { id: eventId, agencyId: user.agencyId }, select: { id: true, payPlan: true } });
    if (!e) throw new FormError("Not found");
    if (e.payPlan === plan) return { ok: "Saved." };
    await prisma.event.update({ where: { id: e.id }, data: { payPlan: plan } });
    await logActivity(user, "EVENT", e.id, "changed how the couple pays", PAY_PLAN_LABELS[plan]);
    revalidatePath(`/events/${e.id}`);
    return { ok: "Saved." };
  });
}

/**
 * The couple paid this act their fee themselves: logged as paid in by the couple and paid out to the act,
 * so neither shows as owed and the act's invoice reads paid. Take it back by removing the two payments
 * on the booking's page.
 */
export async function markPaidDirect(bookingId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const b = await prisma.booking.findFirst({
      where: { id: bookingId, agencyId: user.agencyId },
      include: { payments: true, event: { select: { id: true, payPlan: true } }, artist: { select: { name: true } } },
    });
    if (!b?.event || !isDirectPlan(b.event.payPlan)) throw new FormError("This act isn't paid direct by the couple");
    const left = directSplit(b).actLeft;
    if (left <= 0) return { ok: "Already paid." };
    const how = b.event.payPlan === "DEPOSIT_CASH" ? "in cash" : "by bank transfer";
    const paidAt = new Date();
    await prisma.$transaction([
      prisma.payment.create({ data: { bookingId: b.id, direction: "IN", kind: "BALANCE", amountMinor: left, paidAt, note: DIRECT_NOTE } }),
      prisma.payment.create({ data: { bookingId: b.id, direction: "OUT", kind: "SETTLEMENT", amountMinor: left, paidAt, note: DIRECT_NOTE } }),
    ]);
    await syncActInvoicePaid([b.id]);
    await receiptQuietly({ eventId: b.event.id, amountMinor: left, paidTo: b.artist?.name ?? "the act" });
    await logActivity(user, "BOOKING", b.id, `couple paid ${b.artist?.name ?? "the act"} direct ${how}`, formatMoney(left, b.currency));
    revalidatePath(`/events/${b.event.id}`);
    revalidatePath(`/bookings/${b.id}`);
    return { ok: `Marked ${formatMoney(left, b.currency)} paid to ${b.artist?.name ?? "the act"}.` };
  });
}
