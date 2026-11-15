// Self-billing invoices for acts: the rules, kept pure (no database) so they're unit tested in
// tests/act-invoices.test.ts. The database side is in ./act-invoices.ts.
//
// When an invoice is made: the gig is on (Confirmed or Settled, not demo data), it has an act and the
// act's fee is more than nothing, and the gig is over: the act tapped "I've left the venue", or the
// set's end time has passed (three hours after the start when there's no end time). The act must have
// finished their details (bank, address) first; until then staff see "Waiting for the act's details".
// Made automatically for gigs that finished in the last 30 days and the act hasn't already been paid
// for in full, so turning this on doesn't flood the list with years of old gigs. Older ones can be
// made by hand from Pay acts.
//
// After it's issued: while it's unpaid, it always matches the booking and the act. If the fee, the act,
// or the act's name, address, VAT or bank details change, it's voided and a new one, with a new number,
// replaces it (an invoice that's gone out is never edited, and staff never pay into an old account).
// If the gig is cancelled or loses its act, it's voided. Once paid it's never changed.

import { gigOverAt } from "./arrival";
import { dealBreakdown, type DealInput } from "./money";

/** The UK standard rate, added for VAT-registered acts (live music is standard rated). */
export const ACT_VAT_PCT = 20;
/** Gigs that finished this long ago or less get their invoice made by themselves. */
export const AUTO_INVOICE_DAYS = 30;
const DAY = 86_400_000;

export const INVOICE_STATUSES = ["ISSUED", "PAID", "VOID"] as const;
export type ActInvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<ActInvoiceStatus, string> = { ISSUED: "To pay", PAID: "Paid", VOID: "Void" };

/** "SB-0001": SB for self-billed, so they never look like the agency's own customer invoices. */
export function invoiceNumber(seq: number) {
  return `SB-${String(seq).padStart(4, "0")}`;
}

export type ActDetails = {
  name: string;
  address: string;
  vatRegistered: boolean;
  vatNumber: string;
  bankAccountName: string;
  bankSortCode: string;
  bankAccountNumber: string;
  detailsCompletedAt: Date | null;
};

/** Why an act's invoice can't be made yet, or null when their details are ready. */
export function detailsMissing(a: ActDetails): string | null {
  if (!a.detailsCompletedAt) return "Waiting for the act's details";
  // A VAT invoice without the VAT number isn't valid, so wait for it rather than leave the VAT off.
  if (a.vatRegistered && !a.vatNumber.trim()) return "Waiting for the act's VAT number";
  return null;
}

/** What goes on the invoice from the act, copied in when it's issued. */
export function actSnapshot(a: ActDetails) {
  return {
    actName: a.name,
    actAddress: a.address.trim(),
    actVatNumber: a.vatRegistered ? a.vatNumber.trim() : "",
    bankAccountName: a.bankAccountName.trim(),
    bankSortCode: a.bankSortCode.trim(),
    bankAccountNumber: a.bankAccountNumber.trim(),
  };
}
export type ActSnapshot = ReturnType<typeof actSnapshot>;

/** The fee, VAT (only for a VAT-registered act) and total. */
export function invoiceAmounts(netMinor: number, vatNumber: string) {
  const vatPct = vatNumber ? ACT_VAT_PCT : 0;
  const vatMinor = Math.round((netMinor * vatPct) / 100);
  return { netMinor, vatPct, vatMinor, totalMinor: netMinor + vatMinor };
}

/** The act's fee on a booking: what the agency pays them (the cost), never the sale price. */
export function actFeeMinor(b: DealInput) {
  return dealBreakdown(b).artistMinor;
}

/** The gig is over: the act said they've left, or the set's end time has passed. */
export function gigFinished(b: { setStart: Date; setEnd: Date | null; checkIns: { kind: string }[] }, now = new Date()) {
  return b.checkIns.some((c) => c.kind === "DEPARTED") || gigOverAt(b.setStart, b.setEnd) <= now;
}

/** Paid out to the act on a booking so far. */
export function paidOutMinor(payments: { direction: string; amountMinor: number }[]) {
  return payments.reduce((t, p) => t + (p.direction === "OUT" ? p.amountMinor : 0), 0);
}

export type InvoiceableBooking = DealInput & {
  status: string;
  demo: boolean;
  artistId: string | null;
  setStart: Date;
  setEnd: Date | null;
  checkIns: { kind: string }[];
  payments: { direction: string; amountMinor: number }[];
  artist: ActDetails | null;
};

export type IssueDecision = { issue: true; netMinor: number } | { issue: false; reason: string; waiting?: boolean };

/**
 * Whether an invoice should be made for this booking now (one that has no live invoice). `byHand` is
 * staff asking for one, or a replacement for a voided one: no 30-day limit, and made even if the act
 * has been paid already (it's then marked paid straight away).
 */
export function issueDecision(b: InvoiceableBooking, now = new Date(), byHand = false): IssueDecision {
  if (b.demo) return { issue: false, reason: "Demo data" };
  if (b.status !== "CONFIRMED" && b.status !== "SETTLED") return { issue: false, reason: "The gig isn't confirmed" };
  if (!b.artistId || !b.artist) return { issue: false, reason: "No act" };
  const net = actFeeMinor(b);
  if (net <= 0) return { issue: false, reason: "No fee for the act" };
  if (!gigFinished(b, now)) return { issue: false, reason: "The gig hasn't finished yet" };
  if (!byHand) {
    if (gigOverAt(b.setStart, b.setEnd).getTime() < now.getTime() - AUTO_INVOICE_DAYS * DAY) {
      return { issue: false, reason: `Finished more than ${AUTO_INVOICE_DAYS} days ago` };
    }
    if (paidOutMinor(b.payments) >= net) return { issue: false, reason: "The act has been paid already" };
  }
  const missing = detailsMissing(b.artist);
  if (missing) return { issue: false, reason: missing, waiting: true };
  return { issue: true, netMinor: net };
}

export type LiveInvoice = ActSnapshot & { artistId: string | null; currency: string; netMinor: number; vatMinor: number };

/**
 * Why an unpaid invoice no longer matches its booking and act, or null if it still does. `keep: false`
 * means the gig shouldn't have an invoice at all any more (cancelled, no act, no fee).
 */
export function invoiceChange(
  inv: LiveInvoice,
  b: (DealInput & { status: string; artistId: string | null; currency: string; artist: ActDetails | null }) | null,
): { keep: boolean; reason: string } | null {
  if (!b) return { keep: false, reason: "The booking was deleted" };
  if (b.status === "CANCELLED") return { keep: false, reason: "The gig was cancelled" };
  if (b.status !== "CONFIRMED" && b.status !== "SETTLED") return { keep: false, reason: "The gig is no longer confirmed" };
  if (!b.artistId || !b.artist) return { keep: false, reason: "The gig no longer has an act" };
  if (b.artistId !== inv.artistId) return { keep: false, reason: "The act on the gig changed" };
  const net = actFeeMinor(b);
  if (net <= 0) return { keep: false, reason: "The act's fee was taken off" };
  if (net !== inv.netMinor || b.currency !== inv.currency) return { keep: true, reason: "The fee changed" };
  // Details being edited (no completion date for now) keep the invoice as it is until they're done again.
  if (detailsMissing(b.artist)) return null;
  const now = actSnapshot(b.artist);
  if (now.actVatNumber !== inv.actVatNumber) return { keep: true, reason: "The act's VAT registration changed" };
  if (now.bankAccountName !== inv.bankAccountName || now.bankSortCode !== inv.bankSortCode || now.bankAccountNumber !== inv.bankAccountNumber) {
    return { keep: true, reason: "The act's bank details changed" };
  }
  if (now.actName !== inv.actName || now.actAddress !== inv.actAddress) return { keep: true, reason: "The act's name or address changed" };
  return null;
}

/** "••••5678": enough to recognise the account, not enough to pay into it. */
export function maskAccount(n: string) {
  const digits = n.replace(/\s/g, "");
  if (!digits) return "";
  return `••••${digits.slice(-4)}`;
}

/** "12-34-56" from however it was typed. */
export function formatSortCode(s: string) {
  const d = s.replace(/\D/g, "");
  return d.length === 6 ? `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}` : s.trim();
}

/** Still to pay on an invoice: its total, less whatever has been paid out to the act on the gig. */
export function owedOnInvoice(inv: { status: string; totalMinor: number }, payments: { direction: string; amountMinor: number }[]) {
  if (inv.status !== "ISSUED") return 0;
  return Math.max(0, inv.totalMinor - paidOutMinor(payments));
}
