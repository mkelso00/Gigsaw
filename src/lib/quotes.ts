// Quotes to customers: the money on a quote, which statuses allow what, the customer's link and
// checking what the quote editor sends. Pure (no database, no Node-only modules), so it can be
// unit tested and used by the quote editor in the browser for its live totals.
//
// The money is the events code's own: each line becomes a booking on the wedding or event with a
// sale (fee) and a cost (the act's fee) on a sale-and-cost deal, its own VAT, and the agency's
// booking fee on the first line only. So a quote's totals are exactly what the event will show.

import { FormError } from "./forms";
import { dealBreakdown, toMinor, type DealBreakdown, type DealInput } from "./money";
import { addDaysToKey } from "./time";

// ---------- Statuses ----------

export const QUOTE_STATUSES = ["DRAFT", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  VIEWED: "Opened",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  WITHDRAWN: "Withdrawn",
};

/** A soft badge with a coloured light, in the calm style of booking statuses. */
const QUOTE_STATUS_STYLES: Record<QuoteStatus | "UPDATED", string> = {
  DRAFT: "bg-ink-100 text-ink-700 [--dot:var(--color-ink-400)]",
  SENT: "bg-sky-50 text-sky-800 [--dot:var(--color-sky-500)]",
  VIEWED: "bg-volt-100 text-volt-700 [--dot:var(--color-volt-500)]",
  ACCEPTED: "bg-emerald-50 text-emerald-800 [--dot:var(--color-emerald-500)]",
  DECLINED: "bg-cue-100 text-cue-700 [--dot:var(--color-cue-500)]",
  EXPIRED: "bg-amber-50 text-amber-800 [--dot:var(--color-amber-500)]",
  WITHDRAWN: "bg-ink-100 text-ink-500 [--dot:var(--color-ink-300)]",
  UPDATED: "bg-ink-100 text-ink-500 [--dot:var(--color-ink-300)]",
};

/** Waiting for the customer: sent (or opened) and still open. */
export const OPEN_STATUSES: QuoteStatus[] = ["SENT", "VIEWED"];

export type QuoteState = { status: string; supersededById: string | null; validUntil: string | null };

/**
 * The status as it stands today: a sent quote past its valid-until date is Expired, whether or
 * not anyone has looked at it since (nothing has to run at midnight for this).
 */
export function effectiveStatus(q: QuoteState, today: string): QuoteStatus {
  const s = (QUOTE_STATUSES as readonly string[]).includes(q.status) ? (q.status as QuoteStatus) : "DRAFT";
  if (OPEN_STATUSES.includes(s) && q.validUntil && q.validUntil < today) return "EXPIRED";
  return s;
}

/** The label staff see, e.g. "Opened", or "Updated" for a version a newer one has replaced. */
export function statusLabel(q: QuoteState, today: string) {
  if (q.supersededById && effectiveStatus(q, today) !== "ACCEPTED") return "Updated";
  return QUOTE_STATUS_LABELS[effectiveStatus(q, today)];
}

export function statusStyle(q: QuoteState, today: string) {
  if (q.supersededById && effectiveStatus(q, today) !== "ACCEPTED") return QUOTE_STATUS_STYLES.UPDATED;
  return QUOTE_STATUS_STYLES[effectiveStatus(q, today)];
}

/** The customer can still accept or decline it: sent, not past its date, not withdrawn, not replaced by a newer version. */
export function canAnswer(q: QuoteState, today: string) {
  return !q.supersededById && OPEN_STATUSES.includes(effectiveStatus(q, today));
}

/** Only a draft is edited in place. Once sent, a change makes a new version. */
export const canEdit = (q: QuoteState) => q.status === "DRAFT" && !q.supersededById;
export const canSend = canEdit;
/** Send the same link again (e.g. the customer lost the email). */
export const canResend = canAnswer;
/** Take back a quote that's out with the customer. Its link then only says it's been withdrawn. */
export const canWithdraw = (q: QuoteState) => !q.supersededById && (q.status === "SENT" || q.status === "VIEWED" || q.status === "EXPIRED");
/**
 * Make version + 1: to change a quote that's been sent, or to quote again after a decline,
 * expiry or withdrawal. Not for a draft (just edit it), an accepted quote (the bookings exist:
 * change those) or a version that already has a newer one.
 */
export const canNewVersion = (q: QuoteState) => !q.supersededById && ["SENT", "VIEWED", "DECLINED", "EXPIRED", "WITHDRAWN"].includes(q.status);

/** Why the customer can't answer, in their words, or null if they can. */
export function answerProblem(q: QuoteState, today: string): string | null {
  if (q.supersededById) return "This proposal has been updated.";
  switch (effectiveStatus(q, today)) {
    case "SENT":
    case "VIEWED":
      return null;
    case "ACCEPTED":
      return "You've accepted this proposal.";
    case "DECLINED":
      return "You've declined this proposal.";
    case "EXPIRED":
      return "This proposal has expired.";
    case "WITHDRAWN":
      return "This proposal has been withdrawn.";
    default:
      return "This proposal isn't ready yet.";
  }
}

/** "Q-0012", or "Q-0012 v2" for a later version. */
export function quoteRef(q: { number: string; version: number }) {
  return q.version > 1 ? `${q.number} v${q.version}` : q.number;
}

/** The next quote number after the highest one an agency has used, e.g. "Q-0013". */
export function nextQuoteNumber(highest: number | null) {
  return `Q-${String((highest ?? 0) + 1).padStart(4, "0")}`;
}

// ---------- The customer's link ----------

/** Links are 24 random bytes, base64url: 32 characters. Anything else is turned away before the database. */
const QUOTE_TOKEN = /^[A-Za-z0-9_-]{32}$/;
export const looksLikeQuoteToken = (t: unknown): t is string => typeof t === "string" && QUOTE_TOKEN.test(t);

/** How long after the last date on the quote (or its valid-until date, if later) the link still opens. */
const TOKEN_DAYS_AFTER = 90;

/** When a quote's link stops opening at all: well after the event, so the customer can still look back at what they accepted. */
export function tokenExpiry(lineDates: string[], validUntil: string | null): Date {
  const last = [...lineDates, validUntil ?? ""].filter(Boolean).sort().at(-1);
  const base = last ?? new Date().toISOString().slice(0, 10);
  return new Date(`${addDaysToKey(base, TOKEN_DAYS_AFTER)}T23:59:59Z`);
}

/** The link opens: it's this version's own token and it hasn't run out. */
export function tokenOpens(q: { token: string | null; tokenExpiresAt: Date | null }, token: string, now = new Date()) {
  return !!q.token && q.token === token && (!q.tokenExpiresAt || q.tokenExpiresAt > now);
}

// ---------- Money ----------

export type QuoteLineMoney = { saleMinor: number; costMinor: number | null; vatPct: number };

/** A line as the booking it becomes: a sale-and-cost deal, with the booking fee on the first line only. */
export function lineDeal(line: QuoteLineMoney, bookingFeeMinor: number): DealInput {
  return { dealType: "BUY_SELL", feeMinor: line.saleMinor, artistFeeMinor: line.costMinor, commissionPct: 0, vatPct: line.vatPct, bookingFeeMinor };
}

/** The booking fee each line carries: all of it on the first. */
export const lineFee = (index: number, bookingFeeMinor: number) => (index === 0 ? bookingFeeMinor : 0);

export type QuoteTotals = {
  lines: DealBreakdown[];
  /** The acts' prices together, before VAT: what the customer pays for the performances. */
  saleMinor: number;
  bookingFeeMinor: number;
  vatMinor: number;
  /** What the customer pays in all. */
  totalMinor: number;
  /** Staff only: what the acts are paid. */
  costMinor: number;
  /** Staff only: what the agency makes (sale less cost, plus the booking fee). */
  agencyMinor: number;
  /** Some lines have a price but no cost yet, so the agency's share is a guess. */
  costMissing: boolean;
};

/** Add a quote up with dealBreakdown, line by line, as the event will once it's accepted. */
export function quoteTotals(lines: QuoteLineMoney[], bookingFeeMinor: number): QuoteTotals {
  if (!lines.length) {
    return {
      lines: [],
      saleMinor: 0,
      bookingFeeMinor,
      vatMinor: 0,
      totalMinor: bookingFeeMinor,
      costMinor: 0,
      agencyMinor: bookingFeeMinor,
      costMissing: false,
    };
  }
  const parts = lines.map((l, i) => dealBreakdown(lineDeal(l, lineFee(i, bookingFeeMinor))));
  const sum = (f: (d: DealBreakdown) => number) => parts.reduce((t, d) => t + f(d), 0);
  return {
    lines: parts,
    saleMinor: sum((d) => d.grossMinor),
    bookingFeeMinor: sum((d) => d.bookingFeeMinor),
    vatMinor: sum((d) => d.vatMinor),
    totalMinor: sum((d) => d.totalDueMinor),
    costMinor: sum((d) => d.artistMinor),
    agencyMinor: sum((d) => d.agencyMinor),
    costMissing: lines.some((l) => l.costMinor === null && l.saleMinor > 0),
  };
}

/**
 * Share the deposit across the bookings it becomes, in line order: each takes up to what it costs
 * the customer, and anything left over goes on the last (as card payments are shared). The pay
 * link and the deposit checks then add them back up for the whole event.
 */
export function spreadDeposit(depositMinor: number, dues: number[]): number[] {
  if (!dues.length) return [];
  let left = Math.max(0, depositMinor);
  const out = dues.map((due) => {
    const part = Math.min(left, Math.max(0, due));
    left -= part;
    return part;
  });
  out[out.length - 1] += left;
  return out;
}

// ---------- What the editor sends ----------

export type QuoteLineInput = {
  artistId: string | null;
  description: string;
  date: string;
  arriveTime: string;
  startTime: string;
  endTime: string;
  venueId: string | null;
  place: string;
  saleMinor: number;
  costMinor: number | null;
  vatPct: number;
};

/** A line as the editor holds it: everything as typed. */
export type QuoteLineDraft = {
  artistId: string;
  description: string;
  date: string;
  arriveTime: string;
  startTime: string;
  endTime: string;
  venueId: string;
  place: string;
  sale: string;
  cost: string;
  vatPct: string;
};

export const MAX_LINES = 30;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v: unknown, max: number) =>
  (typeof v === "string" ? v : "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** An amount as typed, in minor units. Blank gives null. */
export function parseAmount(raw: unknown, currency: string, label: string): number | null {
  const s = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!s) return null;
  let v: number;
  try {
    v = toMinor(s, currency);
  } catch {
    throw new FormError(`Enter the ${label} as a number, like 450.00`);
  }
  if (v < 0) throw new FormError(`The ${label} can't be negative`);
  if (v > 100_000_000_00) throw new FormError(`Check the ${label}: it's very large`);
  return v;
}

/** A VAT rate as typed: blank is no VAT. */
function parseVat(raw: unknown): number {
  const s = typeof raw === "string" ? raw.trim().replace(/%$/, "") : "";
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new FormError("VAT must be between 0 and 100%");
  return n;
}

/**
 * Check the editor's lines (sent as JSON). Act and venue ids are kept only if they're the
 * agency's own (pass their ids); anything else becomes "act to be confirmed" or a typed place.
 * Throws a FormError naming the line that's wrong.
 */
export function parseQuoteLines(raw: string, currency: string, own: { artistIds: Set<string>; venueIds: Set<string> }): QuoteLineInput[] {
  let list: unknown;
  try {
    list = JSON.parse(raw || "[]");
  } catch {
    throw new FormError("The lines couldn't be read. Reload the page and try again.");
  }
  if (!Array.isArray(list)) throw new FormError("The lines couldn't be read. Reload the page and try again.");
  if (list.length > MAX_LINES) throw new FormError(`A proposal can have up to ${MAX_LINES} lines`);
  return list.map((item, i) => {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const n = list.length > 1 ? ` on line ${i + 1}` : "";
    const date = text(r.date, 10);
    if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) throw new FormError(`Choose the date${n}`);
    const startTime = text(r.startTime, 5);
    if (!TIME.test(startTime)) throw new FormError(`Enter the start time${n}, like 19:30`);
    const arriveTime = text(r.arriveTime, 5);
    if (arriveTime && !TIME.test(arriveTime)) throw new FormError(`Check the arrival time${n}`);
    const endTime = text(r.endTime, 5);
    if (endTime && !TIME.test(endTime)) throw new FormError(`Check the finish time${n}`);
    const artistId = text(r.artistId, 40);
    const venueId = text(r.venueId, 40);
    let vatPct: number;
    try {
      vatPct = parseVat(r.vatPct);
    } catch (e) {
      throw new FormError(`${(e as Error).message}${n}`);
    }
    return {
      artistId: artistId && own.artistIds.has(artistId) ? artistId : null,
      description: text(r.description, 120),
      date,
      arriveTime,
      startTime,
      endTime,
      venueId: venueId && own.venueIds.has(venueId) ? venueId : null,
      place: venueId && own.venueIds.has(venueId) ? "" : text(r.place, 200),
      saleMinor: parseAmount(r.sale, currency, `price${n}`) ?? 0,
      costMinor: parseAmount(r.cost, currency, `act's fee${n}`),
      vatPct,
    };
  });
}

/** The editor's money as minor units, for live totals while typing. Anything not yet a number counts as nothing. */
export function draftMoney(l: Pick<QuoteLineDraft, "sale" | "cost" | "vatPct">, currency: string): QuoteLineMoney {
  const safe = (s: string) => {
    try {
      return s.trim() ? Math.max(0, toMinor(s, currency)) : null;
    } catch {
      return null;
    }
  };
  const vat = Number(l.vatPct);
  return { saleMinor: safe(l.sale) ?? 0, costMinor: safe(l.cost), vatPct: Number.isFinite(vat) && vat > 0 && vat <= 100 ? vat : 0 };
}

/** What the customer sees for a line: what it is, who, when. Never the cost. */
export function lineTitle(l: { description: string; artist: { name: string } | null }) {
  const act = l.artist?.name ?? "Act to be confirmed";
  return l.description ? `${l.description}: ${act}` : act;
}

/** "19:30 to 23:30", or "From 19:30". */
export function lineTimes(l: { startTime: string; endTime: string }) {
  return l.endTime ? `${l.startTime} to ${l.endTime}` : `From ${l.startTime}`;
}

/** The kinds of event a quote can be for, and the wedding or event type each becomes. */
export function eventKindFor(eventType: string): "WEDDING" | "CORPORATE" | "PRIVATE_PARTY" | "OTHER" {
  return eventType === "WEDDING" || eventType === "CORPORATE" || eventType === "PRIVATE_PARTY" ? eventType : "OTHER";
}
