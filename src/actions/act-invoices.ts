"use server";

import { revalidatePath } from "next/cache";
import { issueActInvoice, payActInvoices } from "@/lib/act-invoices";
import { requireStaff } from "@/lib/auth";
import { queueCalendarSync } from "@/lib/calendar-sync/queue";
import { logActivities, prisma } from "@/lib/db";
import { FormError, handleForm, str, type FormState } from "@/lib/forms";
import { formatMoney } from "@/lib/money";

/**
 * Mark acts' invoices paid from Pay acts: one ("one"), all of an act's ("act", with its "all_<act>" ids),
 * or the ticked ones ("id"). Each logs a payment out to the act on the gig for what's still owed on the
 * invoice, exactly as paying an act anywhere else in Gigsaw does, so the booking, Payments and reports all
 * agree. A gig that's been and gone and is now paid both ways is marked Settled, as from Payments
 * (payActInvoices in src/lib/act-invoices.ts, shared with the weekly pay run).
 */
export async function markActInvoicesPaid(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const one = str(form, "one");
    const act = str(form, "act");
    const ids = (one ? [one] : act ? form.getAll(`all_${act}`) : form.getAll("id")).map(String).slice(0, 500);
    if (!ids.length) throw new FormError("Tick the invoices to mark paid first");
    const r = await payActInvoices(user.agencyId, ids);
    queueCalendarSync(r.settled);
    await logActivities(user, "BOOKING", r.activity);
    revalidatePath("/", "layout");
    if (!r.count) return { ok: "Already paid." };
    return { ok: `${r.count} invoice${r.count === 1 ? "" : "s"} marked paid (${formatMoney(r.totalMinor, r.currency)}).` };
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
