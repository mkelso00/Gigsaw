"use server";

import { revalidatePath } from "next/cache";
import { payActInvoices, unpayActInvoices } from "@/lib/act-invoices";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { BANK_FIELDS, BANK_PRESETS, CUSTOM_MAX_COLUMNS, PRESETS, defaultHeader, readBankFile, type BankField, type BankPreset } from "@/lib/bank-file";
import { queueCalendarSync } from "@/lib/calendar-sync/queue";
import { getSettings, logActivities, logActivity, prisma } from "@/lib/db";
import { FormError, confirmed, handleForm, str, type FormState } from "@/lib/forms";
import { formatMoney } from "@/lib/money";
import { readWeek, weekShort, weekWindow } from "@/lib/pay-run";
import { PayRunError, sendPayRunRecords, signOffWeek } from "@/lib/pay-run-server";
import { pushActInvoicesToXero, recordActInvoicePaymentsInXero, type ActBillRun } from "@/lib/act-invoices-xero";
import { log } from "@/server/log";

// The weekly pay run's buttons (src/app/(agency)/payments/run). Sending for the records is for admins; marking
// payees paid is for staff, as on Pay acts, and goes through the same payActInvoices so the bookings and Payments
// stay right. Every id posted is checked against this business and this week before anything changes.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function weekOf(weekStart: string) {
  const week = readWeek(weekStart);
  if (!week) throw new FormError("Choose a week");
  return week;
}

/**
 * With "Send act invoices to Xero automatically" on (Settings, Xero): the week's invoices go to Xero as bills when
 * they're sent for the records, and payments are recorded there when payees are marked paid. A Xero problem never
 * stops the pay run; it's added to the message, and each invoice's own problem shows in Settings, Xero.
 */
async function xeroFollowUp(agencyId: string, what: "bills" | "payments", ids: string[]) {
  if (!ids.length) return "";
  const conn = await prisma.xeroConnection.findUnique({ where: { agencyId }, select: { actBillsAuto: true, needsReconnect: true, tenantId: true } });
  if (!conn?.actBillsAuto || !conn.tenantId) return "";
  if (conn.needsReconnect) return " Xero needs connecting again (Settings, Xero), so nothing went there.";
  let r: ActBillRun;
  try {
    r = what === "bills" ? await pushActInvoicesToXero(agencyId, ids) : await recordActInvoicePaymentsInXero(agencyId, ids);
  } catch (e) {
    log.error("Pay run: Xero follow-up failed", { agencyId, what, err: e });
    return " Xero couldn't be reached just now: it will catch up within the hour.";
  }
  if (!r.ok) return ` Xero: ${r.error ?? "not updated"}.`;
  const done = r.results.filter((x) => x.ok).length;
  const failed = r.results.length - done;
  const word = what === "bills" ? "bill" : "payment";
  return [done ? ` ${plural(done, word)} in Xero.` : "", failed ? ` ${failed} couldn't go to Xero: see Settings, Xero.` : ""].join("");
}

/** Only the ids that are this business's act invoices for gigs in this week. */
async function idsInWeek(agencyId: string, week: string, ids: string[]) {
  if (!ids.length) return [];
  const { defaultTimezone } = await getSettings(agencyId);
  const rows = await prisma.actInvoice.findMany({
    where: { id: { in: ids.slice(0, 2000) }, agencyId, gigDate: weekWindow(week, defaultTimezone) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Send the week's invoices to the business for its records (`mode` ALL), or only what's changed since (CHANGES). */
export async function sendPayRun(weekStart: string, mode: "ALL" | "CHANGES", _: FormState, _form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const week = weekOf(weekStart);
    try {
      const r = await sendPayRunRecords(user.agencyId, week, { id: user.id, name: user.name, email: user.email }, mode === "CHANGES" ? "CHANGES" : "ALL");
      const what = [r.count ? plural(r.count, "invoice") : "", r.voided ? `${r.voided} voided` : ""].filter(Boolean).join(" and ");
      await logActivity(user, "PAY_RUN", week, mode === "CHANGES" ? "changes sent for the records" : "sent for the records", `${what} to ${r.to}`);
      const { defaultTimezone } = await getSettings(user.agencyId);
      const live = await prisma.actInvoice.findMany({
        where: { agencyId: user.agencyId, gigDate: weekWindow(week, defaultTimezone), status: { in: ["ISSUED", "PAID"] } },
        select: { id: true },
      });
      const xero = await xeroFollowUp(
        user.agencyId,
        "bills",
        live.map((i) => i.id),
      );
      revalidatePath("/payments/run");
      return { ok: `${mode === "CHANGES" ? "Changes sent" : "Sent"} to ${r.to}: ${what} for ${weekShort(week)}.${xero}` };
    } catch (e) {
      if (e instanceof PayRunError) throw new FormError(e.message);
      throw e;
    }
  });
}

/**
 * Sign off the week's gigs (admins): every gig listed (gig) that's ticked (played) is signed off and its invoice
 * made; an unticked one is left out with its reason (reason_<id>), logged on the booking, with no invoice.
 */
export async function signOffGigs(weekStart: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const week = weekOf(weekStart);
    const gigIds = form.getAll("gig").map(String).slice(0, 2000);
    const reasons = Object.fromEntries(gigIds.map((id) => [id, str(form, `reason_${id}`)]));
    try {
      const r = await signOffWeek(user.agencyId, week, { id: user.id, name: user.name }, { gigIds, played: form.getAll("played").map(String), reasons });
      await logActivity(user, "PAY_RUN", week, "week signed off", `${plural(r.played, "gig")} played, ${r.leftOut} left out`);
      revalidatePath("/", "layout");
      const parts = [
        `Signed off: ${plural(r.played, "gig")} played${r.leftOut ? `, ${r.leftOut} left out` : ""}.`,
        `${plural(r.issued, "invoice")} made.`,
        r.waiting.length ? `${r.waiting.length} more as soon as they can be (${r.waiting.join("; ")}).` : "",
      ];
      return { ok: parts.filter(Boolean).join(" ") };
    } catch (e) {
      if (e instanceof PayRunError) throw new FormError(e.message);
      throw e;
    }
  });
}

/**
 * Mark payees paid, or undo it, from the payment list: "payee" pays one payee's unpaid invoices for the week (posted
 * as ids_<key>), "undo" puts one payee's paid ones back to unpaid (paid_<key>), and "ticked" pays every ticked payee.
 */
export async function payPayees(weekStart: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const week = weekOf(weekStart);
    const one = str(form, "payee");
    const undo = str(form, "undo");
    const keys = one ? [one] : undo ? [undo] : form.getAll("tick").map(String);
    if (!keys.length) throw new FormError("Tick who you've paid first");
    const posted = keys.flatMap((k) => form.getAll(`${undo ? "paid" : "ids"}_${k}`).map(String));
    const ids = await idsInWeek(user.agencyId, week, posted);
    const who = (k: string) => str(form, `name_${k}`) || "them";
    if (undo) {
      const r = await unpayActInvoices(user.agencyId, ids);
      queueCalendarSync(r.unsettled);
      await logActivities(user, "BOOKING", r.activity);
      revalidatePath("/", "layout");
      const stuck = r.notUndone.length
        ? ` ${r.notUndone.join(", ")} ${r.notUndone.length === 1 ? "was" : "were"} paid on the booking itself: take the payment off there.`
        : "";
      if (!r.count) return r.notUndone.length ? { error: stuck.trim() } : { ok: "Already unpaid." };
      return { ok: `${who(undo)} back to unpaid (${formatMoney(r.totalMinor, r.currency)}).${stuck}` };
    }
    if (!ids.length) throw new FormError("Nothing to pay there.");
    const r = await payActInvoices(user.agencyId, ids);
    queueCalendarSync(r.settled);
    await logActivities(user, "BOOKING", r.activity);
    revalidatePath("/", "layout");
    if (!r.count) return { ok: "Already paid." };
    const whom = one ? who(one) : plural(keys.length, "payee");
    const xero = await xeroFollowUp(user.agencyId, "payments", r.paidIds);
    return { ok: `Paid: ${whom}, ${formatMoney(r.totalMinor, r.currency)} (${plural(r.count, "invoice")}).${xero}` };
  });
}

/**
 * Save the bank file layout: a bank's preset, or Custom with the columns (col_field_0.., col_header_0.. in order;
 * a blank field leaves that row out), header row, separator, date format and length limits. Admins only.
 */
export async function saveBankFile(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  return handleForm(async () => {
    const preset = str(form, "preset");
    if (!(BANK_PRESETS as readonly string[]).includes(preset)) throw new FormError("Choose your bank");
    const columns = Array.from({ length: CUSTOM_MAX_COLUMNS }, (_, i) => {
      const field = str(form, `col_field_${i}`);
      if (!(BANK_FIELDS as readonly string[]).includes(field)) return null;
      return { field, header: str(form, `col_header_${i}`).slice(0, 60) || defaultHeader(field as BankField) };
    }).filter((c) => c !== null);
    if (preset === "CUSTOM" && !columns.length) throw new FormError("Choose at least one column for your own layout");
    const before = readBankFile((await getSettings(user.agencyId)).bankFile);
    const custom = form.has("separator")
      ? readBankFile({
          custom: {
            columns,
            header: str(form, "header") === "on",
            separator: str(form, "separator"),
            dateFormat: str(form, "dateFormat"),
            referenceMax: str(form, "referenceMax"),
            nameMax: str(form, "nameMax"),
          },
        }).custom
      : before.custom;
    await prisma.settings.update({ where: { agencyId: user.agencyId }, data: { bankFile: { preset, custom } } });
    await logActivity(user, "SETTINGS", user.agencyId, "bank file changed", PRESETS[preset as BankPreset].label);
    revalidatePath("/payments/run");
    return { ok: `Bank file saved: ${PRESETS[preset as BankPreset].label}.` };
  });
}

/** Mark every unpaid invoice in the week paid (the ids on the page), after a confirm. */
export async function payWholeWeek(weekStart: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const week = weekOf(weekStart);
    const ids = await idsInWeek(user.agencyId, week, form.getAll("id").map(String));
    const open = await prisma.actInvoice.findMany({
      where: { id: { in: ids }, status: "ISSUED" },
      select: { totalMinor: true, currency: true, payeePersonId: true, artistId: true },
    });
    if (!open.length) return { ok: "Everyone's paid already." };
    if (!confirmed(form)) {
      const payees = new Set(open.map((o) => o.payeePersonId ?? o.artistId)).size;
      return {
        confirm: {
          title: `Mark all ${plural(payees, "payee")} paid?`,
          items: [
            `${plural(open.length, "invoice")} for ${weekShort(week)}, ${formatMoney(
              open.reduce((t, o) => t + o.totalMinor, 0),
              open[0].currency,
            )} at most (less anything paid already).`,
            "Only do this once every bank transfer has gone. Each payee can be put back to unpaid with Undo.",
          ],
          button: "Yes, mark all paid",
        },
      };
    }
    const r = await payActInvoices(user.agencyId, ids);
    queueCalendarSync(r.settled);
    await logActivities(user, "BOOKING", r.activity);
    revalidatePath("/", "layout");
    const xero = await xeroFollowUp(user.agencyId, "payments", r.paidIds);
    return { ok: `All paid: ${plural(r.count, "invoice")}, ${formatMoney(r.totalMinor, r.currency)}.${xero}` };
  });
}
