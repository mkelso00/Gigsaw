"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, str, type FormState } from "@/lib/forms";
import { isEmail } from "@/lib/messaging";
import { formatMoney } from "@/lib/money";
import { monthlyBill, poRecipient, sendPoRequest } from "@/lib/monthly-billing-server";

// Monthly billing's buttons (Money, Monthly billing). Admins only; staff can look. Each works on one stored
// bill (MonthlyBill), checked against the user's agency, and logs what was done on the bill.

async function ownBill(agencyId: string, billId: string) {
  const v = await monthlyBill(agencyId, billId);
  if (!v) throw new FormError("That bill isn't there any more. Reload the page.");
  return v;
}

const done = (ok: string): FormState => {
  revalidatePath("/billing");
  return { ok };
};

/**
 * Ask for a PO: with "send", emails the client a summary of the month's gigs asking for a PO number (to the
 * address in the form, which starts as the payer's or the venue's); without, just notes that it's been asked
 * for (e.g. by phone). Either way the bill moves on to Waiting for PO.
 */
export async function askForPo(billId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const v = await ownBill(user.agencyId, billId);
    if (form.get("mode") === "send") {
      if (!v.group?.lines.length) throw new FormError("There are no gigs on this bill to ask about.");
      const suggested = await poRecipient(user.agencyId, v);
      const to = (str(form, "to") || suggested?.email || "").toLowerCase();
      if (!isEmail(to)) throw new FormError("Put in the email address to send it to.");
      const first = suggested && suggested.email.toLowerCase() === to ? suggested.firstName : "";
      const status = await sendPoRequest(user.agencyId, v, to, first);
      if (status === "FAILED") throw new FormError("The email couldn't be sent. Try again, or Mark as asked if you've asked another way.");
      await prisma.monthlyBill.update({ where: { id: v.id }, data: { poRequestedAt: new Date() } });
      await logActivity(user, "BILL", v.id, "asked for a PO", `${v.name}, ${v.month}, emailed ${to}`);
      return done(status === "SENT" ? `PO request sent to ${to}.` : `PO request saved for ${to}. It's in the Outbox (no email provider is set up).`);
    }
    await prisma.monthlyBill.update({ where: { id: v.id }, data: { poRequestedAt: new Date() } });
    await logActivity(user, "BILL", v.id, "asked for a PO", `${v.name}, ${v.month}`);
    return done("Marked as asked.");
  });
}

/** The PO number came in. */
export async function savePo(billId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const po = str(form, "poNumber").slice(0, 100);
    if (!po) throw new FormError("Put in the PO number.");
    const v = await ownBill(user.agencyId, billId);
    await prisma.monthlyBill.update({
      where: { id: v.id },
      data: { poNumber: po, poReceivedAt: v.bill.poReceivedAt ?? new Date(), poRequestedAt: v.bill.poRequestedAt ?? new Date() },
    });
    await logActivity(user, "BILL", v.id, "PO received", `${v.name}, ${v.month}: ${po}`);
    return done(`PO ${po} saved.`);
  });
}

/**
 * Mark it invoiced, with the invoice number, keeping the total as it is now so a later change to the gigs shows.
 * Done again on an invoiced bill (e.g. after a credit note and a new invoice), it saves the new number and total.
 */
export async function markInvoiced(billId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const number = str(form, "invoiceNumber").slice(0, 100);
    if (!number) throw new FormError("Put in the invoice number.");
    const v = await ownBill(user.agencyId, billId);
    if (!v.group?.lines.length) throw new FormError("There are no gigs on this bill to invoice.");
    const total = v.group.totals.total;
    await prisma.monthlyBill.update({
      where: { id: v.id },
      data: { invoicedAt: new Date(), invoiceNumber: number, invoicedTotalMinor: total, nothingToBill: false },
    });
    await logActivity(user, "BILL", v.id, "invoiced", `${v.name}, ${v.month}: ${number}, ${formatMoney(total, v.currency)}`);
    return done(`Invoice ${number} saved (${formatMoney(total, v.currency)}).`);
  });
}

export async function markPaid(billId: string, _: FormState): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const v = await ownBill(user.agencyId, billId);
    if (!v.bill.invoicedAt) throw new FormError("Mark it invoiced first.");
    await prisma.monthlyBill.update({ where: { id: v.id }, data: { paidAt: new Date() } });
    await logActivity(user, "BILL", v.id, "paid", `${v.name}, ${v.month}`);
    return done("Marked paid.");
  });
}

export async function markNothingToBill(billId: string, _: FormState): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const v = await ownBill(user.agencyId, billId);
    await prisma.monthlyBill.update({ where: { id: v.id }, data: { nothingToBill: true } });
    await logActivity(user, "BILL", v.id, "nothing to bill", `${v.name}, ${v.month}`);
    return done("Marked nothing to bill.");
  });
}

const UNDO = {
  PO_REQUEST: { data: { poRequestedAt: null }, log: "PO request undone" },
  PO: { data: { poNumber: "", poReceivedAt: null }, log: "PO removed" },
  INVOICED: { data: { invoicedAt: null, invoiceNumber: "", invoicedTotalMinor: null, paidAt: null }, log: "invoice undone" },
  PAID: { data: { paidAt: null }, log: "payment undone" },
  NOTHING: { data: { nothingToBill: false }, log: "nothing to bill undone" },
} as const;

/** Take a step back: the PO request, the PO, the invoice, the payment or "nothing to bill". */
export async function undoBillStep(billId: string, step: keyof typeof UNDO, _: FormState): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const undo = UNDO[step];
    if (!undo) throw new FormError("Nothing to undo.");
    const v = await ownBill(user.agencyId, billId);
    await prisma.monthlyBill.update({ where: { id: v.id }, data: undo.data });
    await logActivity(user, "BILL", v.id, undo.log, `${v.name}, ${v.month}`);
    return done("Undone.");
  });
}

export async function saveBillNote(billId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const note = str(form, "note").slice(0, 2000);
    const { count } = await prisma.monthlyBill.updateMany({ where: { id: billId, agencyId: user.agencyId }, data: { note } });
    if (!count) throw new FormError("That bill isn't there any more. Reload the page.");
    return done("Note saved.");
  });
}
