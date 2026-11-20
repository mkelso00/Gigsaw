import "server-only";
import type { ActInvoice, XeroConnection } from "@prisma/client";
import { log } from "@/server/log";
import { prisma } from "./db";
import { claimReminder } from "./reminders";
import { weekdayOf } from "./rota";
import { localDateKey, localTime } from "./time";
import {
  createBill,
  getInvoiceStatuses,
  isoDay,
  PAYMENTS_NOT_ALLOWED,
  recordBillPayment,
  setBillStatus,
  xeroBillUrl,
  xeroConnectionFor,
  XeroError,
  XeroNotConnected,
  XeroRateLimited,
  XeroReconnectNeeded,
  type XeroOpts,
} from "./xero";

// Acts' self-billing invoices (src/lib/act-invoices.ts) in the agency's Xero, as bills to pay, and their payments.
// Server functions with no login check inside: each is scoped to the agency it's given, and the callers (the pay
// run's Send and Paid buttons, the scheduler) decide who may use them.
//
//  - pushActInvoicesToXero: a bill for each invoice not sent yet (Settings, Xero: the act fees account, and DRAFT or
//    AUTHORISED). A voided Gigsaw invoice whose bill is in Xero has the bill taken back out: VOIDED, or DELETED while
//    it's still a draft (Xero can't void a draft). A bill with a payment against it is never touched: it's flagged
//    for someone to sort out in Xero.
//  - recordActInvoicePaymentsInXero: for each paid invoice whose bill has no payment yet, records the payment from
//    the bank account chosen in Settings, Xero, on the day it was paid. Xero only takes payments on approved bills.
//  - runActBillsToXero: the scheduler's job when "Send act invoices to Xero automatically" is on: every hour in
//    office hours, sends invoices made since it was turned on, records payments and takes voided ones out.
//
// The ActInvoice row keeps the bill's id (xeroBillId), Xero's status for it as last seen (xeroBillStatus), the
// payment's id (xeroPaymentId) and anything that needs a person to look at it (xeroProblem).

export type ActBillAction = "created" | "voided" | "deleted" | "paid" | "already" | "skipped";

export type ActBillResult =
  | { id: string; number: string; ok: true; action: ActBillAction; billId?: string; status?: string; url?: string; note?: string }
  | { id: string; number: string; ok: false; error: string; reconnect?: boolean };

export type ActBillRun = { ok: boolean; error?: string; reconnect?: boolean; results: ActBillResult[] };

/** Up to this many in one go, so one press stays well inside Xero's 60 calls a minute. */
export const MAX_PER_RUN = 50;

const GONE = ["VOIDED", "DELETED"];

/** A problem that stops the whole run: Xero needs connecting again, or its limit is reached. */
const stopsRun = (e: unknown) => e instanceof XeroReconnectNeeded || e instanceof XeroRateLimited || e instanceof XeroNotConnected;

function failure(inv: Pick<ActInvoice, "id" | "number">, e: unknown): ActBillResult {
  if (e instanceof XeroError)
    return { id: inv.id, number: inv.number, ok: false, error: e.message, ...(e instanceof XeroReconnectNeeded ? { reconnect: true } : {}) };
  throw e;
}

async function load(agencyId: string, invoiceIds: string[]) {
  const ids = [...new Set(invoiceIds)].slice(0, MAX_PER_RUN);
  const rows = await prisma.actInvoice.findMany({ where: { agencyId, id: { in: ids } }, orderBy: { seq: "asc" } });
  return { rows, missing: ids.filter((id) => !rows.some((r) => r.id === id)) };
}

async function connection(agencyId: string): Promise<XeroConnection | string> {
  const conn = await xeroConnectionFor(agencyId);
  if (!conn) return "Xero isn't connected. An admin can connect it in Settings, Xero.";
  if (conn.needsReconnect) return "Xero needs connecting again. An admin can do it in Settings, Xero.";
  return conn;
}

/** Everyone the run didn't get to, with the reason it stopped. */
function stopped(rows: Pick<ActInvoice, "id" | "number">[], done: Set<string>, e: XeroError): ActBillResult[] {
  return rows
    .filter((r) => !done.has(r.id))
    .map((r) => ({ id: r.id, number: r.number, ok: false as const, error: e.message, ...(e instanceof XeroReconnectNeeded ? { reconnect: true } : {}) }));
}

const notFound = (id: string): ActBillResult => ({ id, number: "", ok: false, error: "Invoice not found." });

/** The email to put on a new supplier contact: the person's own, or the act's. */
async function supplierEmails(rows: ActInvoice[]) {
  const personIds = [...new Set(rows.flatMap((r) => (r.payeePersonId ? [r.payeePersonId] : [])))];
  const artistIds = [...new Set(rows.flatMap((r) => (!r.payeePersonId && r.artistId ? [r.artistId] : [])))];
  const [people, acts] = await Promise.all([
    personIds.length ? prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, email: true } }) : [],
    artistIds.length ? prisma.artist.findMany({ where: { id: { in: artistIds } }, select: { id: true, email: true } }) : [],
  ]);
  const byPerson = new Map(people.map((p) => [p.id, p.email]));
  const byAct = new Map(acts.map((a) => [a.id, a.email]));
  return (r: ActInvoice) => (r.payeePersonId ? byPerson.get(r.payeePersonId) : r.artistId ? byAct.get(r.artistId) : "") ?? "";
}

/** Takes voided invoices' bills back out of Xero, or flags the ones with a payment. */
async function voidBills(conn: XeroConnection, rows: ActInvoice[], opts: XeroOpts): Promise<ActBillResult[]> {
  if (!rows.length) return [];
  const found = await getInvoiceStatuses(
    conn,
    rows.map((r) => r.xeroBillId),
    opts,
  );
  const out: ActBillResult[] = [];
  for (const inv of rows) {
    const s = found.get(inv.xeroBillId.toLowerCase());
    try {
      // Gone from Xero already (deleted there, or voided by hand).
      if (!s || GONE.includes(s.status)) {
        const status = s?.status ?? "DELETED";
        await prisma.actInvoice.update({ where: { id: inv.id }, data: { xeroBillStatus: status, xeroProblem: "" } });
        out.push({ id: inv.id, number: inv.number, ok: true, action: "already", billId: inv.xeroBillId, status, note: "Already out of Xero." });
        continue;
      }
      if (s.amountPaidMinor > 0 || s.status === "PAID") {
        const problem = `${inv.number} is void in Gigsaw, but its bill in Xero has a payment against it. Take the payment off in Xero, then void the bill there.`;
        await prisma.actInvoice.update({ where: { id: inv.id }, data: { xeroBillStatus: s.status, xeroProblem: problem } });
        out.push({ id: inv.id, number: inv.number, ok: false, error: problem });
        continue;
      }
      // Xero voids an approved bill; a draft (or one awaiting approval) can only be deleted.
      const to = s.status === "AUTHORISED" ? "VOIDED" : "DELETED";
      const status = await setBillStatus(conn, inv.xeroBillId, to, opts);
      await prisma.actInvoice.update({ where: { id: inv.id }, data: { xeroBillStatus: status, xeroProblem: "" } });
      out.push({ id: inv.id, number: inv.number, ok: true, action: to === "VOIDED" ? "voided" : "deleted", billId: inv.xeroBillId, status });
    } catch (e) {
      if (stopsRun(e)) throw e;
      const r = failure(inv, e);
      if (!r.ok) await prisma.actInvoice.update({ where: { id: inv.id }, data: { xeroProblem: r.error.slice(0, 500) } });
      out.push(r);
    }
  }
  return out;
}

/**
 * Sends these invoices to the agency's Xero as bills: a bill for each live one (to pay, or paid) that hasn't been
 * sent, and voided ones' bills taken back out. Others are left alone. Ids from another agency are "not found".
 * Never throws for a Xero problem: each invoice's result says what happened.
 */
export async function pushActInvoicesToXero(agencyId: string, invoiceIds: string[], opts: XeroOpts = {}): Promise<ActBillRun> {
  const { rows, missing } = await load(agencyId, invoiceIds);
  const conn = await connection(agencyId);
  if (typeof conn === "string") {
    return {
      ok: false,
      error: conn,
      results: [...rows.map((r) => ({ id: r.id, number: r.number, ok: false as const, error: conn })), ...missing.map(notFound)],
    };
  }
  const results: ActBillResult[] = [];
  const done = new Set<string>();
  const toVoid = rows.filter((r) => r.status === "VOID" && r.xeroBillId && !GONE.includes(r.xeroBillStatus));
  const toSend = rows.filter((r) => r.status !== "VOID" && !r.xeroBillId);
  for (const r of rows) {
    if (toVoid.includes(r) || toSend.includes(r)) continue;
    done.add(r.id);
    results.push(
      r.status === "VOID"
        ? { id: r.id, number: r.number, ok: true, action: "skipped", note: r.xeroBillId ? "Already out of Xero." : "Void, so it isn't sent." }
        : {
            id: r.id,
            number: r.number,
            ok: true,
            action: "already",
            billId: r.xeroBillId,
            status: r.xeroBillStatus,
            url: xeroBillUrl(r.xeroBillId, conn.shortCode),
          },
    );
  }
  try {
    const emailOf = await supplierEmails(toSend);
    // One search for each payee in a run, however many bills they have.
    const contacts = new Map<string, string>();
    for (const inv of toSend) {
      const supplierName = (inv.payeeName || inv.actName).trim();
      const nameKey = supplierName.toLowerCase().replace(/\s+/g, " ");
      try {
        const bill = await createBill(
          conn,
          {
            invoiceNumber: inv.number,
            supplierName,
            supplierEmail: emailOf(inv),
            supplierContactId: contacts.get(nameKey),
            vatNumber: inv.actVatNumber,
            description: inv.description,
            netMinor: inv.netMinor,
            vatMinor: inv.vatMinor,
            currency: inv.currency,
            date: inv.issuedAt,
            idempotencyKey: `gigsaw-${agencyId}-actbill-${inv.id}`,
          },
          opts,
        );
        contacts.set(nameKey, bill.contactId);
        // Xero works out the total itself: if it doesn't match Gigsaw's invoice, someone should look.
        const problem =
          bill.totalMinor && bill.totalMinor !== inv.totalMinor
            ? `The bill in Xero comes to a different total from ${inv.number}. Check its VAT and amount in Xero.`
            : "";
        // Only if nothing else saved a bill for it first (the Idempotency-Key makes a repeat the same bill in Xero).
        await prisma.actInvoice.updateMany({
          where: { id: inv.id, xeroBillId: "" },
          data: { xeroBillId: bill.billId, xeroBillStatus: bill.status, xeroProblem: problem },
        });
        done.add(inv.id);
        results.push({
          id: inv.id,
          number: inv.number,
          ok: true,
          action: "created",
          billId: bill.billId,
          status: bill.status,
          url: bill.url,
          note: problem || undefined,
        });
      } catch (e) {
        if (stopsRun(e)) throw e;
        const r = failure(inv, e);
        if (!r.ok) await prisma.actInvoice.update({ where: { id: inv.id }, data: { xeroProblem: r.error.slice(0, 500) } });
        done.add(inv.id);
        results.push(r);
      }
    }
    for (const r of await voidBills(conn, toVoid, opts)) {
      done.add(r.id);
      results.push(r);
    }
  } catch (e) {
    if (!(e instanceof XeroError)) throw e;
    log.warn("Sending act invoices to Xero stopped", { agencyId, reason: e.message });
    results.push(...stopped(rows, done, e));
    return { ok: false, error: e.message, ...(e instanceof XeroReconnectNeeded ? { reconnect: true } : {}), results: [...results, ...missing.map(notFound)] };
  }
  return { ok: true, results: [...results, ...missing.map(notFound)] };
}

/**
 * Records in Xero that these invoices have been paid: for each paid invoice whose bill is in Xero with no payment
 * recorded yet, a payment of what's due on the bill (the invoice's total, or less if some was paid in Xero), from the
 * bank account in Settings, Xero, on the day it was marked paid. Others are left alone. Never throws for a Xero
 * problem.
 */
export async function recordActInvoicePaymentsInXero(agencyId: string, invoiceIds: string[], opts: XeroOpts = {}): Promise<ActBillRun> {
  const { rows, missing } = await load(agencyId, invoiceIds);
  const conn = await connection(agencyId);
  if (typeof conn === "string") {
    return {
      ok: false,
      error: conn,
      results: [...rows.map((r) => ({ id: r.id, number: r.number, ok: false as const, error: conn })), ...missing.map(notFound)],
    };
  }
  const results: ActBillResult[] = [];
  const done = new Set<string>();
  const due = rows.filter((r) => r.status === "PAID" && r.xeroBillId && !r.xeroPaymentId && r.xeroBillStatus !== "PAID");
  for (const r of rows) {
    if (due.includes(r)) continue;
    done.add(r.id);
    const note = r.status !== "PAID" ? "Not paid yet." : !r.xeroBillId ? "Not in Xero yet. Send it first." : "The payment is in Xero already.";
    results.push({
      id: r.id,
      number: r.number,
      ok: true,
      action: r.status === "PAID" && r.xeroBillId ? "already" : "skipped",
      billId: r.xeroBillId || undefined,
      note,
    });
  }
  if (due.length && !conn.payFromBankAccountCode.trim()) {
    const error = "Choose the bank account acts are paid from in Settings, Xero, and the payments can be recorded.";
    return {
      ok: false,
      error,
      results: [...results, ...due.map((r) => ({ id: r.id, number: r.number, ok: false as const, error })), ...missing.map(notFound)],
    };
  }
  try {
    const found = due.length
      ? await getInvoiceStatuses(
          conn,
          due.map((r) => r.xeroBillId),
          opts,
        )
      : new Map();
    for (const inv of due) {
      const s = found.get(inv.xeroBillId.toLowerCase());
      const fail = async (error: string, status?: string) => {
        await prisma.actInvoice.update({ where: { id: inv.id }, data: { xeroProblem: error.slice(0, 500), ...(status ? { xeroBillStatus: status } : {}) } });
        done.add(inv.id);
        results.push({ id: inv.id, number: inv.number, ok: false, error });
      };
      if (!s) {
        await fail(`Xero couldn't find the bill for ${inv.number}. It may have been deleted there.`);
        continue;
      }
      if (s.status === "PAID" || (s.status === "AUTHORISED" && s.amountDueMinor <= 0)) {
        // Paid in Xero already (by hand, or a bank feed match): nothing to add.
        await prisma.actInvoice.update({ where: { id: inv.id }, data: { xeroBillStatus: "PAID", xeroProblem: "" } });
        done.add(inv.id);
        results.push({ id: inv.id, number: inv.number, ok: true, action: "already", billId: inv.xeroBillId, status: "PAID", note: "Already paid in Xero." });
        continue;
      }
      if (GONE.includes(s.status)) {
        await fail(`The bill for ${inv.number} is ${s.status === "VOIDED" ? "voided" : "deleted"} in Xero, so its payment can't be recorded there.`, s.status);
        continue;
      }
      if (s.status !== "AUTHORISED") {
        await fail(`The bill for ${inv.number} is still a draft in Xero. Approve it there and the payment is recorded next time.`, s.status);
        continue;
      }
      try {
        const amountMinor = Math.min(inv.totalMinor, s.amountDueMinor);
        const pay = await recordBillPayment(
          conn,
          {
            invoiceId: inv.xeroBillId,
            amountMinor,
            date: isoDay(inv.paidAt ?? new Date()),
            bankAccountCode: conn.payFromBankAccountCode,
            currency: inv.currency,
            reference: inv.number,
          },
          { ...opts, idempotencyKey: `gigsaw-${agencyId}-actpay-${inv.id}` },
        );
        const status = amountMinor >= s.amountDueMinor ? "PAID" : "AUTHORISED";
        await prisma.actInvoice.update({ where: { id: inv.id }, data: { xeroPaymentId: pay.paymentId, xeroBillStatus: status, xeroProblem: "" } });
        done.add(inv.id);
        results.push({ id: inv.id, number: inv.number, ok: true, action: "paid", billId: inv.xeroBillId, status });
      } catch (e) {
        // Not allowed to record payments: the same for every invoice, so the run stops.
        if (stopsRun(e) || (e instanceof XeroError && e.message === PAYMENTS_NOT_ALLOWED)) throw e;
        const r = failure(inv, e);
        if (!r.ok) await fail(r.error);
        else results.push(r);
      }
    }
  } catch (e) {
    if (!(e instanceof XeroError)) throw e;
    log.warn("Recording act payments in Xero stopped", { agencyId, reason: e.message });
    results.push(...stopped(due, done, e));
    return { ok: false, error: e.message, ...(e instanceof XeroReconnectNeeded ? { reconnect: true } : {}), results: [...results, ...missing.map(notFound)] };
  }
  return { ok: true, results: [...results, ...missing.map(notFound)] };
}

/** Office hours for sending to Xero by itself: weekdays, 9am to 5pm in the business's time zone. */
export function inXeroHours(now: Date, timeZone: string) {
  const t = localTime(now, timeZone);
  return weekdayOf(localDateKey(now, timeZone)) <= 5 && t >= "09:00" && t < "17:00";
}

/** How many of each go in one hourly run for a business. */
const PER_HOUR = 20;

/**
 * The scheduler's job, every minute: for each business with "Send act invoices to Xero automatically" on, once an
 * hour in office hours, sends the invoices made since it was turned on, records the payments of paid ones and takes
 * voided ones' bills out. A few at a time, oldest first, with ones that went wrong before tried last.
 */
export async function runActBillsToXero(now = new Date(), opts: XeroOpts = {}) {
  const conns = await prisma.xeroConnection.findMany({
    where: { actBillsAuto: true, needsReconnect: false, tenantId: { not: "" }, refreshTokenEnc: { not: "" }, agency: { status: "ACTIVE" } },
    select: { agencyId: true, actBillsAutoFrom: true, agency: { select: { settings: { select: { defaultTimezone: true } } } } },
  });
  const total = { sent: 0, paid: 0, voided: 0, problems: 0 };
  for (const c of conns) {
    const tz = c.agency.settings?.defaultTimezone ?? "Europe/London";
    if (!inXeroHours(now, tz)) continue;
    if (!(await claimReminder("XERO_ACT_BILLS", `agency:${c.agencyId}`, `${localDateKey(now, tz)}T${localTime(now, tz).slice(0, 2)}`))) continue;
    const from = c.actBillsAutoFrom ?? now;
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
    const order = [{ xeroProblem: "asc" as const }, { issuedAt: "asc" as const }];
    try {
      const [toSend, toVoid, toPay] = await Promise.all([
        prisma.actInvoice.findMany({
          where: { agencyId: c.agencyId, status: { in: ["ISSUED", "PAID"] }, xeroBillId: "", issuedAt: { gte: from } },
          select: { id: true },
          orderBy: order,
          take: PER_HOUR,
        }),
        prisma.actInvoice.findMany({
          where: { agencyId: c.agencyId, status: "VOID", xeroBillId: { not: "" }, xeroBillStatus: { notIn: GONE } },
          select: { id: true },
          orderBy: order,
          take: PER_HOUR,
        }),
        prisma.actInvoice.findMany({
          where: { agencyId: c.agencyId, status: "PAID", xeroBillId: { not: "" }, xeroPaymentId: "", xeroBillStatus: { not: "PAID" } },
          select: { id: true },
          orderBy: order,
          take: PER_HOUR,
        }),
      ]);
      if (toSend.length || toVoid.length) {
        const r = await pushActInvoicesToXero(c.agencyId, [...ids(toSend), ...ids(toVoid)], opts);
        for (const x of r.results) {
          if (!x.ok) total.problems++;
          else if (x.action === "created") total.sent++;
          else if (x.action === "voided" || x.action === "deleted") total.voided++;
        }
        if (!r.ok) continue;
      }
      // Bills just made as drafts can't take a payment yet; approved ones can, straight away.
      const payIds = [...new Set([...ids(toPay), ...ids(toSend)])];
      if (payIds.length) {
        const r = await recordActInvoicePaymentsInXero(c.agencyId, payIds, opts);
        for (const x of r.results) {
          if (!x.ok) total.problems++;
          else if (x.action === "paid") total.paid++;
        }
      }
    } catch (e) {
      log.error("Sending act invoices to Xero failed", { job: "act-bills-xero", agencyId: c.agencyId, err: e });
    }
  }
  return total;
}
