// Money helpers. Amounts are held in minor units (pence / cents) as integers.

const ZERO_DECIMAL = new Set(["JPY"]);

function minorUnitFactor(currency: string): number {
  return ZERO_DECIMAL.has(currency) ? 1 : 100;
}

/** Parse "1,250.50" into minor units. Empty input gives 0. */
export function toMinor(input: string | number | null | undefined, currency = "GBP"): number {
  if (input === null || input === undefined || input === "") return 0;
  const n = typeof input === "number" ? input : Number(String(input).replace(/[,\s£$€]/g, ""));
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${input}`);
  return Math.round(n * minorUnitFactor(currency));
}

export function fromMinor(minor: number, currency = "GBP"): number {
  return minor / minorUnitFactor(currency);
}

export function formatMoney(minor: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(fromMinor(minor, currency));
}

/** Plain number for form inputs, e.g. 125050 -> "1250.50". */
export function minorToInput(minor: number | null | undefined, currency = "GBP"): string {
  if (minor === null || minor === undefined) return "";
  const f = minorUnitFactor(currency);
  return f === 1 ? String(minor) : (minor / f).toFixed(2);
}

export type DealInput = {
  dealType: string;
  feeMinor: number;
  artistFeeMinor: number | null;
  commissionPct: number;
  vatPct: number;
  /** Charged to the venue or client on top of the performance fee, kept in full by the agency. */
  bookingFeeMinor?: number;
  /**
   * VAT on the business's share only (what it keeps, booking fee included), not on the act's fee: the customer
   * pays the act direct (a wedding's deposit pay plan, src/lib/pay-plan.ts), so that part carries no VAT.
   */
  vatOnShare?: boolean;
};

export type DealBreakdown = {
  /** The performance fee the venue or client pays (the sale), before VAT. */
  grossMinor: number;
  /** The booking fee on top, all the agency's. */
  bookingFeeMinor: number;
  /** VAT on the performance fee and the booking fee (or on the business's share only, with vatOnShare). */
  vatMinor: number;
  /** What the venue or client pays in all: performance fee, booking fee and VAT. */
  totalDueMinor: number;
  /** What the agency keeps (commission, or margin on sale and cost deals), plus the booking fee. */
  agencyMinor: number;
  /** What the artist is owed. */
  artistMinor: number;
};

/** Work out who gets what from a booking's fee. */
export function dealBreakdown(d: DealInput): DealBreakdown {
  const gross = d.feeMinor;
  const fee = d.bookingFeeMinor ?? 0;
  let agency: number;
  let artist: number;
  switch (d.dealType) {
    case "BUY_SELL": {
      artist = d.artistFeeMinor ?? 0;
      agency = gross - artist;
      break;
    }
    case "FLAT": {
      agency = 0;
      artist = gross;
      break;
    }
    default: {
      // Standard commission, and the guarantee part of versus / plus deals.
      agency = Math.round((gross * d.commissionPct) / 100);
      artist = gross - agency;
    }
  }
  const vatable = d.vatOnShare ? Math.max(0, agency) + fee : gross + fee;
  const vat = Math.round((vatable * d.vatPct) / 100);
  return { grossMinor: gross, bookingFeeMinor: fee, vatMinor: vat, totalDueMinor: gross + fee + vat, agencyMinor: agency + fee, artistMinor: artist };
}

export type PaymentLike = { direction: string; kind: string; amountMinor: number };

export function paymentTotals(payments: PaymentLike[]) {
  let receivedMinor = 0;
  let paidOutMinor = 0;
  let depositReceivedMinor = 0;
  for (const p of payments) {
    if (p.direction === "IN") {
      receivedMinor += p.amountMinor;
      if (p.kind === "DEPOSIT") depositReceivedMinor += p.amountMinor;
    } else {
      paidOutMinor += p.amountMinor;
    }
  }
  return { receivedMinor, paidOutMinor, depositReceivedMinor };
}

/**
 * The agency's default booking fee for a new booking, if it gets one. Weddings and private events
 * are charged once per event, so a gig joining an event that already carries the fee gets none.
 */
export function defaultBookingFee(settings: { bookingFeeMinor: number; bookingFeeFor: string }, gig: { eventType: string; eventHasFee?: boolean }): number {
  if (settings.bookingFeeMinor <= 0 || gig.eventHasFee) return 0;
  if (settings.bookingFeeFor === "ALL") return settings.bookingFeeMinor;
  return gig.eventType !== "GIG" ? settings.bookingFeeMinor : 0;
}

/**
 * The VAT % a new booking starts with: the business's "VAT on sales" from Settings, 0 when it's off.
 * Bookings already made keep their own VAT; this is only for ones being created.
 */
export function defaultVat(settings: { defaultVatPct: number }): number {
  const v = settings.defaultVatPct;
  return Number.isFinite(v) && v > 0 && v <= 100 ? v : 0;
}
