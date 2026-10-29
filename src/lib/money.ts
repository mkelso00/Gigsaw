// Money helpers. Amounts are held in minor units (pence / cents) as integers.

const ZERO_DECIMAL = new Set(["JPY"]);

export function minorUnitFactor(currency: string): number {
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
};

export type DealBreakdown = {
  /** What the promoter pays, before VAT. */
  grossMinor: number;
  vatMinor: number;
  /** What the promoter pays including VAT. */
  totalDueMinor: number;
  /** What the agency keeps (commission, or margin on buy/sell deals). */
  agencyMinor: number;
  /** What the artist is owed. */
  artistMinor: number;
};

/** Work out who gets what from a booking's fee. */
export function dealBreakdown(d: DealInput): DealBreakdown {
  const gross = d.feeMinor;
  const vat = Math.round((gross * d.vatPct) / 100);
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
  return { grossMinor: gross, vatMinor: vat, totalDueMinor: gross + vat, agencyMinor: agency, artistMinor: artist };
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
