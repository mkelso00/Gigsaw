// The weekly pay run, kept pure (no database) so it's unit tested in tests/pay-run.test.ts. The database side
// is in ./pay-run-server.ts and the page is Money, Weekly pay run (/payments/run).
//
// A pay run is one week, Monday to Sunday in the business's time zone, by gig date (the invoice's date of
// performance). It's that week's live self-billing invoices (to pay or paid, never void), grouped by who's paid:
// the payee on each invoice (a band's lead, the one person in a solo act, or the act: src/lib/payee.ts). One
// person who leads two acts is one payee and one bank transfer for the week.
//
// The steps: check the invoices (warnings for anything that may need a look), send them to the business for its
// records (the email says which were sent; anything made, replaced or voided afterwards shows as "Changed since
// sent", and only the changes are sent next time), then pay each payee from the bank and mark them paid here.

import { formatSortCode, owedOnInvoice } from "./act-invoice-rules";
import type { BankPayment } from "./bank-file";
import { formatMoney, minorToInput } from "./money";
import { addDaysToKey, localDateKey, zonedToUtc } from "./time";

// ---------------------------------------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------------------------------------

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The Monday of the week a "YYYY-MM-DD" day is in. */
export function mondayOf(day: string) {
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday 0 ... Sunday 6
  return addDaysToKey(day, -weekday);
}

/** This week's Monday, in the business's time zone. */
export function thisWeekStart(now: Date, timeZone: string) {
  return mondayOf(localDateKey(now, timeZone));
}

/** Last week's Monday: the week a pay run is usually for. */
export function lastWeekStart(now: Date, timeZone: string) {
  return addDaysToKey(thisWeekStart(now, timeZone), -7);
}

/** A week from the address (any day in it), as its Monday, or null if it isn't a real date. */
export function readWeek(s: string | null | undefined): string | null {
  const m = KEY.exec((s ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || y < 2000 || y > 2100) return null;
  return mondayOf(m[0]);
}

/** The week's gig dates as a database range: from Monday 00:00 to the next Monday 00:00, in the business's time zone. */
export function weekWindow(weekStart: string, timeZone: string) {
  return { gte: zonedToUtc(weekStart, "00:00", timeZone), lt: zonedToUtc(addDaysToKey(weekStart, 7), "00:00", timeZone) };
}

/** True when a gig on this date (an instant) belongs to the week, in the business's time zone. */
export function inWeek(at: Date, weekStart: string, timeZone: string) {
  return mondayOf(localDateKey(at, timeZone)) === weekStart;
}

const dayMonth = (key: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(new Date(`${key}T12:00:00Z`));

/** "Mon 9 to Sun 15 November 2026", "Mon 27 October to Sun 2 November 2026" or across a new year, both years. */
export function weekLabel(weekStart: string) {
  const end = addDaysToKey(weekStart, 6);
  const sameYear = weekStart.slice(0, 4) === end.slice(0, 4);
  const sameMonth = sameYear && weekStart.slice(0, 7) === end.slice(0, 7);
  const from = dayMonth(
    weekStart,
    sameMonth ? { day: "numeric" } : sameYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" },
  );
  const to = dayMonth(end, { day: "numeric", month: "long", year: "numeric" });
  return `Mon ${from} to Sun ${to}`;
}

/** "w/c 9 Nov 2026": short, for subjects and file names. */
export function weekShort(weekStart: string) {
  return `w/c ${dayMonth(weekStart, { day: "numeric", month: "short", year: "numeric" })}`;
}

// ---------------------------------------------------------------------------------------------------------
// Payees
// ---------------------------------------------------------------------------------------------------------

/** What the pay run needs of an invoice (an ActInvoice row, with the payments on its gig). */
export type RunInvoice = {
  id: string;
  number: string;
  seq: number;
  status: string;
  currency: string;
  netMinor: number;
  vatMinor: number;
  totalMinor: number;
  gigDate: Date;
  paidAt: Date | null;
  actName: string;
  artistId: string | null;
  payeeName: string;
  payeePersonId: string | null;
  bookingId: string | null;
  bookingRef: string;
  bankAccountName: string;
  bankSortCode: string;
  bankAccountNumber: string;
  payments: { direction: string; amountMinor: number }[];
};

export type RunPayee<T extends RunInvoice = RunInvoice> = {
  /** Safe in a form field's name: letters, digits, _ and -. */
  key: string;
  name: string;
  acts: string[];
  invoices: (T & { owedMinor: number })[];
  currency: string;
  totalMinor: number;
  /** Still to pay this week. */
  owedMinor: number;
  paidMinor: number;
  paid: boolean;
  /** Who to pay: the newest unpaid invoice's bank details (an unpaid invoice always has the payee's current ones). */
  bank: { accountName: string; sortCode: string; accountNumber: string };
  /** The unpaid invoices don't all have the same bank details: pay each one on its own. */
  bankMismatch: boolean;
  reference: string;
  /** Paid since when: the latest invoice's paid date, once they're all paid. */
  paidAt: Date | null;
  /** The person paid (null when it's the act itself), and the act whose page has the details to fix. */
  personId: string | null;
  artistId: string | null;
};

/** Who an invoice is paid to: the person it's made out to, else the act. */
export function payeeKey(inv: Pick<RunInvoice, "payeePersonId" | "artistId" | "actName">) {
  if (inv.payeePersonId) return `p_${inv.payeePersonId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  if (inv.artistId) return `a_${inv.artistId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  return `n_${inv.actName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

const digits = (s: string) => s.replace(/\D/g, "");
const bankOf = (i: RunInvoice) => `${digits(i.bankSortCode)}|${digits(i.bankAccountNumber)}`;

/** The week's invoices, one entry per payee with their total, what's still to pay and the bank reference. A to Z. */
export function groupByPayee<T extends RunInvoice>(invoices: T[], business: string): RunPayee<T>[] {
  const groups = new Map<string, (T & { owedMinor: number })[]>();
  for (const inv of invoices) {
    if (inv.status !== "ISSUED" && inv.status !== "PAID") continue;
    const key = payeeKey(inv);
    groups.set(key, [...(groups.get(key) ?? []), { ...inv, owedMinor: owedOnInvoice(inv, inv.payments) }]);
  }
  const out = [...groups.entries()].map(([key, list]): RunPayee<T> => {
    list.sort((a, b) => a.gigDate.getTime() - b.gigDate.getTime() || a.seq - b.seq);
    const unpaid = list.filter((i) => i.owedMinor > 0);
    const newest = [...(unpaid.length ? unpaid : list)].sort((a, b) => b.seq - a.seq)[0];
    const totalMinor = list.reduce((t, i) => t + i.totalMinor, 0);
    const owedMinor = unpaid.reduce((t, i) => t + i.owedMinor, 0);
    const paidDates = list.flatMap((i) => (i.paidAt ? [i.paidAt.getTime()] : []));
    return {
      key,
      name: newest.payeeName || newest.actName,
      acts: [...new Set(list.map((i) => i.actName))],
      invoices: list,
      currency: newest.currency,
      totalMinor,
      owedMinor,
      paidMinor: totalMinor - owedMinor,
      paid: owedMinor === 0,
      bank: { accountName: newest.bankAccountName.trim(), sortCode: newest.bankSortCode.trim(), accountNumber: digits(newest.bankAccountNumber) },
      bankMismatch: new Set(unpaid.map(bankOf)).size > 1,
      // The reference names the invoices still to pay; once paid, all of them (for the printed list).
      reference: paymentReference(
        business,
        (unpaid.length ? unpaid : list).map((i) => i.number),
      ),
      paidAt: owedMinor === 0 && paidDates.length ? new Date(Math.max(...paidDates)) : null,
      personId: newest.payeePersonId,
      artistId: newest.artistId,
    };
  });
  return out.sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }) || a.key.localeCompare(b.key));
}

/** UK Faster Payments references are up to 18 characters. */
export const REFERENCE_MAX = 18;

/**
 * The bank payment reference: the business's first word and the invoice numbers, the first in full and the rest
 * as digits, e.g. "Suave SB-0012/0019". Only whole numbers, as many as fit in 18 characters (Faster Payments);
 * only the characters UK banks accept.
 */
export function paymentReference(business: string, numbers: string[]) {
  const clean = (s: string) =>
    s
      .replace(/[^A-Za-z0-9 .&/-]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const prefix = clean(business.trim().split(/\s+/)[0] ?? "").slice(0, 8);
  const sorted = [...new Set(numbers)].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const parts = sorted.map((n, i) => clean(i === 0 ? n : n.replace(/^[A-Za-z]+-?/, "")));
  let ref = prefix;
  for (const [i, part] of parts.entries()) {
    const next = i === 0 ? `${ref}${ref ? " " : ""}${part}` : `${ref}/${part}`;
    if (next.length > REFERENCE_MAX) break;
    ref = next;
  }
  // A business name so long that not even one number fits: just the number.
  if (parts.length && ref === prefix) ref = parts[0].slice(0, REFERENCE_MAX);
  return ref.slice(0, REFERENCE_MAX);
}

export type RunProgress = { payees: number; paidPayees: number; invoices: number; totalMinor: number; paidMinor: number; owedMinor: number; done: boolean };

/** "34 of 98 paid · £4,210 of £12,800". Done once there's something and all of it is paid. */
export function runProgress(payees: RunPayee[]): RunProgress {
  const totalMinor = payees.reduce((t, p) => t + p.totalMinor, 0);
  const owedMinor = payees.reduce((t, p) => t + p.owedMinor, 0);
  const paidPayees = payees.filter((p) => p.paid).length;
  return {
    payees: payees.length,
    paidPayees,
    invoices: payees.reduce((t, p) => t + p.invoices.length, 0),
    totalMinor,
    paidMinor: totalMinor - owedMinor,
    owedMinor,
    done: payees.length > 0 && paidPayees === payees.length,
  };
}

export function progressLine(p: RunProgress, currency: string) {
  return `${p.paidPayees} of ${p.payees} paid · ${formatMoney(p.paidMinor, currency)} of ${formatMoney(p.totalMinor, currency)}`;
}

// ---------------------------------------------------------------------------------------------------------
// Sent for the records, and what's changed since
// ---------------------------------------------------------------------------------------------------------

export type SentState = { sentInvoiceIds: string[]; sentNumbers: string[] } | null;

/**
 * What's different from the last send: invoices made or reissued since (`added`, to send next), and those sent
 * that aren't live any more (`removed`: voided, usually replaced by one in `added`). Paying one isn't a change.
 */
export function changesSinceSent(sent: SentState, live: { id: string; number: string }[]) {
  if (!sent) return { sent: false, changed: false, added: [], removed: [] } as const;
  const sentIds = new Set(sent.sentInvoiceIds);
  const liveIds = new Set(live.map((i) => i.id));
  const added = live.filter((i) => !sentIds.has(i.id));
  const removed = sent.sentInvoiceIds.flatMap((id, n) => (liveIds.has(id) ? [] : [{ id, number: sent.sentNumbers[n] ?? "" }]));
  return { sent: true, changed: added.length > 0 || removed.length > 0, added, removed };
}

/** One entry in PayRun.sends. */
export type SendRecord = {
  at: string;
  byName: string;
  to: string;
  kind: "ALL" | "CHANGES";
  numbers: string[];
  voided: string[];
  totalMinor: number;
};

export function readSends(json: unknown): SendRecord[] {
  return Array.isArray(json) ? (json.filter((s) => s && typeof s === "object" && typeof (s as SendRecord).at === "string") as SendRecord[]) : [];
}

// ---------------------------------------------------------------------------------------------------------
// Signing off the week (for a business that makes invoices then: Settings.actInvoiceMode SIGN_OFF)
// ---------------------------------------------------------------------------------------------------------
//
// On Monday an admin checks last week's gigs off: every finished gig with an act and a fee is ticked "Played"; one
// that didn't happen (a no-show) is unticked with a reason and left out, so no invoice is made for it. Signing off
// makes the invoices for the played ones (or as soon as they can be: the payee's details in, the booking confirmed).
// Gigs added to the week afterwards, or a left-out gig edited since, are "Not signed off yet" until signed off too.

export type LeftOutRecord = { bookingId: string; reason: string; at: string; byName: string };
export type SignOffRecord = { at: string; byName: string; bookingIds: string[]; leftOut: string[] };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";

export function readLeftOut(json: unknown): LeftOutRecord[] {
  return Array.isArray(json) ? (json.filter((x) => isObj(x) && typeof x.bookingId === "string" && typeof x.at === "string") as LeftOutRecord[]) : [];
}

export function readSignOffs(json: unknown): SignOffRecord[] {
  return Array.isArray(json) ? (json.filter((x) => isObj(x) && typeof x.at === "string" && Array.isArray(x.bookingIds)) as SignOffRecord[]) : [];
}

export type GigState = "SIGNED_OFF" | "LEFT_OUT" | "TO_SIGN_OFF" | "NOT_FINISHED" | "CANCELLED";

/**
 * Where a gig stands in the week's sign-off. Cancelled and unfinished gigs can't be signed off. A left-out gig
 * that's been edited since (the booking fixed, say) is back to be signed off.
 */
export function gigState(
  g: { id: string; status: string; finished: boolean; updatedAt: Date },
  signedOff: Set<string>,
  leftOut: Map<string, LeftOutRecord>,
): { state: GigState; leftOut: LeftOutRecord | null; editedSinceLeftOut: boolean } {
  const out = leftOut.get(g.id) ?? null;
  if (g.status === "CANCELLED") return { state: "CANCELLED", leftOut: out, editedSinceLeftOut: false };
  if (signedOff.has(g.id)) return { state: "SIGNED_OFF", leftOut: null, editedSinceLeftOut: false };
  if (!g.finished) return { state: "NOT_FINISHED", leftOut: null, editedSinceLeftOut: false };
  if (out) {
    const edited = g.updatedAt.getTime() > new Date(out.at).getTime();
    return { state: edited ? "TO_SIGN_OFF" : "LEFT_OUT", leftOut: out, editedSinceLeftOut: edited };
  }
  return { state: "TO_SIGN_OFF", leftOut: null, editedSinceLeftOut: false };
}

/** A sign-off added to what's on the week's PayRun: played gigs signed off, the rest left out with their reasons. */
export function mergeSignOff(
  before: { signedOffBookingIds: string[]; leftOut: unknown; signOffs: unknown },
  played: string[],
  out: { bookingId: string; reason: string }[],
  by: { name: string; at: Date },
) {
  const at = by.at.toISOString();
  const touched = new Set([...played, ...out.map((o) => o.bookingId)]);
  return {
    signedOffBookingIds: [...new Set([...before.signedOffBookingIds, ...played])],
    leftOut: [...readLeftOut(before.leftOut).filter((l) => !touched.has(l.bookingId)), ...out.map((o) => ({ ...o, at, byName: by.name }))],
    signOffs: [...readSignOffs(before.signOffs), { at, byName: by.name, bookingIds: played, leftOut: out.map((o) => o.bookingId) }],
  };
}

// ---------------------------------------------------------------------------------------------------------
// Files: the payment list for the bank, and the invoices for the records
// ---------------------------------------------------------------------------------------------------------

/**
 * The payees still to pay, as payments for the bank file (src/lib/bank-file.ts, which lays them out for the bank
 * and leaves out any with a bad sort code or account number). `emails` is by payee key.
 */
export function bankPayments(payees: RunPayee[], emails: Map<string, string> = new Map()): BankPayment[] {
  return payees
    .filter((p) => p.owedMinor > 0)
    .map((p) => ({
      key: p.key,
      payeeName: p.name,
      accountName: p.bank.accountName,
      sortCode: p.bank.sortCode,
      accountNumber: p.bank.accountNumber,
      amountMinor: p.owedMinor,
      currency: p.currency,
      reference: p.reference,
      email: emails.get(p.key) ?? "",
      artistId: p.artistId,
    }));
}

export const RECORDS_HEADER = ["Invoice", "Status", "Gig date", "Act", "Made out to", "Booking", "Net", "VAT", "Total", "Currency", "Paid on"];

/** The week's invoices for the records: one row per invoice. Never bank details. */
export function recordsRows(invoices: RunInvoice[], timeZone: string) {
  return [...invoices]
    .sort((a, b) => a.seq - b.seq)
    .map((i) => [
      i.number,
      i.status === "PAID" ? "Paid" : i.status === "VOID" ? "Void" : "To pay",
      localDateKey(i.gigDate, timeZone),
      i.actName,
      i.payeeName || i.actName,
      i.bookingRef,
      minorToInput(i.netMinor, i.currency),
      minorToInput(i.vatMinor, i.currency),
      minorToInput(i.totalMinor, i.currency),
      i.currency,
      i.paidAt ? localDateKey(i.paidAt, timeZone) : "",
    ]);
}

/** "12-34-56 12345678", for showing. */
export function bankLine(p: Pick<RunPayee, "bank">) {
  return [p.bank.sortCode && formatSortCode(p.bank.sortCode), p.bank.accountNumber].filter(Boolean).join(" ");
}
