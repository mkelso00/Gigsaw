// Self-billing invoices for acts: the rules, kept pure (no database) so they're unit tested in
// tests/act-invoices.test.ts. The database side is in ./act-invoices.ts.
//
// When an invoice is made: the gig is on (Confirmed or Settled, not demo data), it has an act and the
// act's fee is more than nothing, and the gig is over: the act tapped "I've left the venue", or the
// set's end time has passed (three hours after the start when there's no end time). The invoice is made
// out to the act's payee (a band's lead person, the one person in a solo act, or the act itself when it
// has nobody on file: src/lib/payee.ts), who must have finished their details (bank, address) first;
// until then staff see "Waiting for details from …".
// Made automatically for gigs that finished in the last 30 days and the act hasn't already been paid
// for in full, so turning this on doesn't flood the list with years of old gigs. Older ones can be
// made by hand from Pay acts.
//
// After it's issued: while it's unpaid, it always matches the booking and the act. If the fee, the act,
// who it's made out to, or the payee's name, address, VAT or bank details change, it's voided and a new one, with a new number,
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

/**
 * Who the invoice is made out to and paid to, with their details: the band's lead person, the one person in a
 * solo act, or the act itself (personId null). See src/lib/payee.ts for who that is.
 */
export type PayeeDetails = {
  personId: string | null;
  name: string;
  address: string;
  vatRegistered: boolean;
  vatNumber: string;
  bankAccountName: string;
  bankSortCode: string;
  bankAccountNumber: string;
  detailsCompletedAt: Date | null;
  /** When the payee last agreed to self-billing (src/lib/self-billing.ts). An invoice is made either way. */
  selfBillingAgreedAt?: Date | null;
};

/** Why nothing can be made for a band with no payee yet (see payeeOf). */
export const NO_PAYEE = "Choose who the band's invoices go to";

/** Why an invoice can't be made yet, or null when the payee's details are ready. */
export function detailsMissing(p: PayeeDetails): string | null {
  if (!p.detailsCompletedAt) return p.personId ? `Waiting for details from ${p.name}` : "Waiting for the act's details";
  // A VAT invoice without the VAT number isn't valid, so wait for it rather than leave the VAT off.
  if (p.vatRegistered && !p.vatNumber.trim()) return p.personId ? `Waiting for a VAT number from ${p.name}` : "Waiting for the act's VAT number";
  return null;
}

/** What goes on the invoice from the act and its payee, copied in when it's issued. */
export function invoiceSnapshot(actName: string, p: PayeeDetails) {
  return {
    actName,
    payeeName: p.name,
    payeePersonId: p.personId,
    actAddress: p.address.trim(),
    actVatNumber: p.vatRegistered ? p.vatNumber.trim() : "",
    bankAccountName: p.bankAccountName.trim(),
    bankSortCode: p.bankSortCode.trim(),
    bankAccountNumber: p.bankAccountNumber.trim(),
  };
}
export type InvoiceSnapshot = ReturnType<typeof invoiceSnapshot>;

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
  artist: { name: string } | null;
  /** Null for a band with nobody chosen to get its invoices. */
  payee: PayeeDetails | null;
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
  if (!b.payee) return { issue: false, reason: NO_PAYEE, waiting: true };
  const missing = detailsMissing(b.payee);
  if (missing) return { issue: false, reason: missing, waiting: true };
  return { issue: true, netMinor: net };
}

export type LiveInvoice = InvoiceSnapshot & { artistId: string | null; currency: string; netMinor: number; vatMinor: number };

/**
 * Why an unpaid invoice no longer matches its booking and act, or null if it still does. `keep: false`
 * means the gig shouldn't have an invoice at all any more (cancelled, no act, no fee).
 */
export function invoiceChange(
  inv: LiveInvoice,
  b: (DealInput & { status: string; artistId: string | null; currency: string; artist: { name: string } | null; payee: PayeeDetails | null }) | null,
): { keep: boolean; reason: string } | null {
  if (!b) return { keep: false, reason: "The booking was deleted" };
  if (b.status === "CANCELLED") return { keep: false, reason: "The gig was cancelled" };
  if (b.status !== "CONFIRMED" && b.status !== "SETTLED") return { keep: false, reason: "The gig is no longer confirmed" };
  if (!b.artistId || !b.artist) return { keep: false, reason: "The gig no longer has an act" };
  if (b.artistId !== inv.artistId) return { keep: false, reason: "The act on the gig changed" };
  const net = actFeeMinor(b);
  if (net <= 0) return { keep: false, reason: "The act's fee was taken off" };
  if (net !== inv.netMinor || b.currency !== inv.currency) return { keep: true, reason: "The fee changed" };
  // No payee chosen (the band's lead was taken off), or details being edited (no completion date for now): the
  // invoice stays as it is until they're done again.
  if (!b.payee || detailsMissing(b.payee)) return null;
  const now = invoiceSnapshot(b.artist.name, b.payee);
  if (now.payeePersonId !== inv.payeePersonId) return { keep: true, reason: "Who it's made out to changed" };
  const whose = now.payeePersonId ? "The payee's" : "The act's";
  if (now.actVatNumber !== inv.actVatNumber) return { keep: true, reason: `${whose} VAT registration changed` };
  if (now.bankAccountName !== inv.bankAccountName || now.bankSortCode !== inv.bankSortCode || now.bankAccountNumber !== inv.bankAccountNumber) {
    return { keep: true, reason: `${whose} bank details changed` };
  }
  if (now.payeeName !== inv.payeeName || now.actAddress !== inv.actAddress) return { keep: true, reason: `${whose} name or address changed` };
  if (now.actName !== inv.actName) return { keep: true, reason: "The act's name changed" };
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
