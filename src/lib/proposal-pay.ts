// How the couple pay for a wedding proposal. Everything is paid to the business, never to the band:
//
//   the deposit   the business's share (each line's price less the act's fee, plus any booking fee) plus VAT on
//                 it. It secures the date, and it's the same whichever way they pay the balance.
//   the balance   the acts' fees, either
//     CASH        in cash with no VAT, delivered to the business's address for cash payments (Settings), or
//     TRANSFER    by bank transfer (or card) with VAT on it, like everything else.
//
// The couple choose when they sign. CASH becomes the wedding's BALANCE_CASH pay plan (VAT on the business's share
// only, Booking.vatOnShare); TRANSFER is FULL (VAT on the whole sale, as every booking had before). Each booking's
// deposit is its line's share plus VAT, so the money here is exactly what dealBreakdown shows for the bookings once
// they're made: on the wedding page, the couple's page, the balance emails and the secure gate.
//
// The balance is the acts' fees by design (the business has accepted that for weddings): the couple only ever see it
// as "the balance", never as a fee. Pure, for the editor's live preview, the customer's page and acceptance.

import { balanceDueDate } from "./event-plan";
import { FormError } from "./forms";
import { dealBreakdown } from "./money";
import type { PayPlan } from "./pay-plan";
import { eventKindFor, lineDeal, lineFee, type ProposalLineMoney } from "./proposals";

export const BALANCE_OPTIONS = ["CASH", "TRANSFER"] as const;
export type BalanceOption = (typeof BALANCE_OPTIONS)[number];
export const isBalanceOption = (s: unknown): s is BalanceOption => s === "CASH" || s === "TRANSFER";

/** The wedding's pay plan (src/lib/pay-plan.ts) for each way to pay the balance. */
export const PLAN_FOR: Record<BalanceOption, PayPlan> = { CASH: "BALANCE_CASH", TRANSFER: "FULL" };

/**
 * The note under the ways to pay, when the business hasn't written its own (Settings, Contracts and invoices).
 * {business} is the business's name and {cashAddress} its address for cash payments.
 */
export const DEFAULT_PAY_NOTE =
  "The price shown is your deposit, including VAT. This secures your date. The remaining balance is the musicians' fee and has no VAT added. It's collected by {business} and passed directly to your musicians in full. It can be paid in cash and delivered to the following address: {cashAddress}. If you would like to transfer the remaining balance direct to {business} there will be an additional 20% added onto the remaining balance quoted in this proposal.";

/** The address for cash payments on one line, e.g. "63 Boverton Road, Llantwit Major, CF61 1YA". "" when there's none. */
export const cashAddressLine = (address: string | null | undefined) => (address ?? "").trim().replace(/\s*\n\s*/g, ", ");

/** The note with the business's name and cash address put in. */
export function payNoteText(note: string, o: { business: string; cashAddress: string }) {
  const address = cashAddressLine(o.cashAddress) || "the address we'll send you";
  return (note.trim() || DEFAULT_PAY_NOTE).replaceAll("{business}", o.business).replaceAll("{cashAddress}", address);
}

/** The box staff tick in the editor ("Offer: ..."), and its hint. */
export const BALANCE_OPTION_STAFF: Record<BalanceOption, { label: string; hint: string }> = {
  CASH: { label: "Cash balance (no VAT)", hint: "The acts' fees, paid to you in cash. No VAT on it." },
  TRANSFER: { label: "Bank transfer balance (+20% VAT)", hint: "The acts' fees plus VAT, paid to you by bank transfer or card." },
};

/** What the couple read on each, e.g. "Bank transfer balance, plus 20% VAT". */
export function balanceTitle(o: BalanceOption, vatPct: number | null) {
  if (o === "CASH") return "Pay the balance in cash, no VAT";
  return vatPct === 0 ? "Pay the balance by bank transfer" : `Pay the balance by bank transfer, plus ${vatPct ? `${vatPct}% ` : ""}VAT`;
}

/** The ways to pay the balance a new proposal offers: both for a wedding; anything else is paid as before. */
export function defaultPayOptions(eventType: string): BalanceOption[] {
  return eventKindFor(eventType) === "WEDDING" ? [...BALANCE_OPTIONS] : [];
}

/** The boxes ticked in the editor. A wedding needs at least one; anything else has none (paid as before). */
export function parsePayOptions(ticked: unknown[], eventType: string): BalanceOption[] {
  if (eventKindFor(eventType) !== "WEDDING") return [];
  const options = BALANCE_OPTIONS.filter((p) => ticked.includes(p));
  if (!options.length) throw new FormError("Tick at least one way the couple can pay the balance");
  return options;
}

type Offered = { eventType: string; payOptions: string[] };

/**
 * The ways to pay the balance the couple choose from. None for anything but a wedding, or for a proposal sent
 * before couples chose: those are paid as they always were (the proposal's own deposit, VAT on everything).
 */
export function payChoices(q: Offered): BalanceOption[] {
  if (eventKindFor(q.eventType) !== "WEDDING") return [];
  return BALANCE_OPTIONS.filter((p) => q.payOptions.includes(p));
}

/** The way to pay the couple chose (or the only one offered), or null when there's no choice (yet). */
export function chosenOption(q: Offered & { payPlan: string | null }): BalanceOption | null {
  const choices = payChoices(q);
  return choices.find((p) => p === q.payPlan) ?? (choices.length === 1 ? choices[0] : null);
}

/** What the couple picked on signing, checked against what's offered. Null when it isn't one of them. */
export function pickOption(q: Offered, asked: string | null | undefined): BalanceOption | null {
  const choices = payChoices(q);
  if (choices.length === 1) return choices[0];
  return choices.find((p) => p === asked) ?? null;
}

export type PayQuote = Offered & { depositMinor: number; bookingFeeMinor: number; lines: ProposalLineMoney[] };

export type BalancePlan = {
  option: BalanceOption;
  /** The deposit: the business's share plus VAT on it, due now. The same for both options. */
  depositMinor: number;
  /** The VAT in the deposit. */
  depositVatMinor: number;
  /** The balance: the acts' fees, with VAT on them for a bank transfer. */
  balanceMinor: number;
  /** The VAT in the balance (none in cash). */
  balanceVatMinor: number;
  /** What the couple pay in all. */
  totalMinor: number;
  /** All the VAT. */
  vatMinor: number;
  /** The deposit each line's booking asks for, in line order. They add up to depositMinor. */
  lineDeposits: number[];
  /** The VAT rate, when every priced line has the same one (null when they differ). */
  vatPct: number | null;
};

/** Each line as the booking it becomes: VAT on the business's share only when the balance is paid in cash. */
export function lineDeals(lines: ProposalLineMoney[], bookingFeeMinor: number, option: BalanceOption | null) {
  return lines.map((l, i) => dealBreakdown({ ...lineDeal(l, lineFee(i, bookingFeeMinor)), vatOnShare: option === "CASH" }));
}

function vatRateOf(lines: ProposalLineMoney[]) {
  const rates = [...new Set(lines.filter((l) => l.saleMinor > 0).map((l) => l.vatPct))];
  return rates.length === 1 ? rates[0] : rates.length === 0 ? 0 : null;
}

/** What paying the balance one way asks of the couple, deposit included. */
export function balancePlan(q: Pick<PayQuote, "bookingFeeMinor" | "lines">, option: BalanceOption): BalancePlan {
  const deals = lineDeals(q.lines, q.bookingFeeMinor, option);
  // The deposit is the share plus VAT on it whichever way the balance goes: worked out on the cash basis.
  const shares = lineDeals(q.lines, q.bookingFeeMinor, "CASH");
  const lineDeposits = shares.map((s, i) => Math.min(Math.max(0, s.agencyMinor + s.vatMinor), deals[i].totalDueMinor));
  const depositMinor = lineDeposits.reduce((t, x) => t + x, 0);
  const depositVatMinor = shares.reduce((t, s) => t + s.vatMinor, 0);
  const totalMinor = deals.reduce((t, d) => t + d.totalDueMinor, 0);
  const vatMinor = deals.reduce((t, d) => t + d.vatMinor, 0);
  return {
    option,
    depositMinor,
    depositVatMinor,
    balanceMinor: Math.max(0, totalMinor - depositMinor),
    balanceVatMinor: Math.max(0, vatMinor - depositVatMinor),
    totalMinor,
    vatMinor,
    lineDeposits,
    vatPct: vatRateOf(q.lines),
  };
}

/** Every way to pay the balance the proposal offers, with its money. Empty when the couple don't choose. */
export function balancePlans(q: PayQuote): BalancePlan[] {
  return payChoices(q).map((p) => balancePlan(q, p));
}

/** The deposit the couple are asked for: the share plus VAT on a wedding they choose on, else the proposal's own. */
export function proposalDeposit(q: PayQuote): number {
  const choices = payChoices(q);
  return choices.length ? balancePlan(q, choices[0]).depositMinor : q.depositMinor;
}

/**
 * A wedding proposal with a deposit isn't booked when it's accepted: the couple's terms say it's booked once
 * the deposit is in too. Until then its gigs are on Hold (src/lib/secure-event.ts). Other events, and a
 * wedding with no deposit, are booked as soon as they're accepted.
 */
export function holdsUntilDeposit(q: PayQuote) {
  return eventKindFor(q.eventType) === "WEDDING" && proposalDeposit(q) > 0;
}

/** When the balance is due: 3 months before the wedding (its first date). */
export const balanceDueFor = (lines: { date: string }[]) => {
  const first = lines
    .map((l) => l.date)
    .filter(Boolean)
    .sort()[0];
  return first ? balanceDueDate(first) : null;
};

/**
 * Why the ways to pay can't go to the couple yet, or null. The deposit is the business's share of each line and
 * the balance is the acts' fees, so every line needs its act's fee, and no more than its price.
 */
export function payProblem(q: PayQuote): string | null {
  if (!payChoices(q).length) return null;
  const n = (i: number) => (q.lines.length > 1 ? ` on line ${i + 1}` : "");
  for (const [i, l] of q.lines.entries()) {
    if (l.costMinor === null) return `Put in the act's fee${n(i)}. The deposit is your share of the price plus VAT, and the balance is the act's fee.`;
    if (l.costMinor > l.saleMinor) return `The act's fee${n(i)} is more than the price. Check them both.`;
  }
  return null;
}

/** What the couple tick to say how they'll pay, with what's due now and the balance. */
export function payPromise(p: BalancePlan, money: (x: number) => string) {
  return `I'll pay the deposit of ${money(p.depositMinor)} now, and the balance of ${money(p.balanceMinor)} ${p.option === "CASH" ? "in cash, with no VAT" : "by bank transfer"}`;
}
