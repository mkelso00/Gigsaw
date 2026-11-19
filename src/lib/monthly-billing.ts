import { dealBreakdown, type DealInput } from "./money";

// Monthly billing (Money, Monthly billing): the bills a business sends each month, and how far each has got.
// Which gigs go on a bill is worked out afresh from the bookings, using the venue statement's rules
// (src/lib/venue-statement.ts): every status but cancelled, and never a wedding's gigs or a private
// customer's. The steps (PO asked for, PO in, invoiced, paid) are kept in MonthlyBill rows; the database
// side is in src/lib/monthly-billing-server.ts. Everything here is pure, so it can be unit tested.
//
// Who pays for a gig: the booking's promoter, else the venue's usual payer (the promoter on its weekly
// slots). A company billed COMBINED gets one bill for all its venues (e.g. Rekom); PER_VENUE gets one per
// venue. A gig with nobody to bill goes on its venue's own bill.

export const BILLING_MODES = ["COMBINED", "PER_VENUE"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];
export const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  COMBINED: "One bill for all their venues",
  PER_VENUE: "One bill per venue",
};
export const billingModeOf = (v: string | null | undefined): BillingMode => (v === "PER_VENUE" ? "PER_VENUE" : "COMBINED");

/** Statuses that mean the gig isn't settled yet, so the bill may still change. */
export const NOT_CONFIRMED = ["ENQUIRY", "PENDING", "AWAITING", "HOLD"];

export type Payer = { id: string; name: string; company: string; email: string; billing: string };
export type BillVenue = { id: string; name: string; timezone: string };

export type BillGig = DealInput & {
  id: string;
  reference: string;
  status: string;
  arriveBy: Date;
  setStart: Date;
  setEnd: Date | null;
  timezone: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  venue: BillVenue;
  /** The booking's own promoter: who pays, if set. */
  promoter: Payer | null;
  artist: { name: string } | null;
};

export type BillLine = { gig: BillGig; exVat: number; vat: number; total: number };

export type BillGroup = {
  key: string;
  contactId: string | null;
  venueId: string | null;
  payer: Payer | null;
  /** The venues on the bill, by name. */
  venues: BillVenue[];
  lines: BillLine[];
  currency: string;
  totals: { gigs: number; exVat: number; vat: number; total: number };
  /** Gigs that aren't confirmed yet (enquiry, pending, awaiting the act, on hold). */
  unconfirmed: BillGig[];
};

/** The bill's key in MonthlyBill: unique per agency and month. */
export function billKey(payer: { id: string; billing: string } | null, venueId: string) {
  if (!payer) return `v:${venueId}`;
  return billingModeOf(payer.billing) === "PER_VENUE" ? `cv:${payer.id}:${venueId}` : `c:${payer.id}`;
}

/** Who a key is for: the company, the venue, or both. Null for a key that isn't one of ours. */
export function parseBillKey(key: string): { contactId: string | null; venueId: string | null } | null {
  const [kind, a, b] = key.split(":");
  if (kind === "c" && a && b === undefined) return { contactId: a, venueId: null };
  if (kind === "cv" && a && b) return { contactId: a, venueId: b };
  if (kind === "v" && a && b === undefined) return { contactId: null, venueId: a };
  return null;
}

/** Who pays for a gig: its own promoter, else the venue's usual payer. */
export function payerOf(gig: Pick<BillGig, "promoter" | "venue">, usualPayers: Map<string, Payer>): Payer | null {
  return gig.promoter ?? usualPayers.get(gig.venue.id) ?? null;
}

/**
 * The venue's usual payer, from its weekly slots: the promoter named on most of them (active ones first),
 * so a venue whose slots are all paid by Rekom bills Rekom even for a one-off gig with no promoter.
 */
export function usualPayerOf<P extends { id: string }>(slots: { promoter: P | null; active: boolean }[]): P | null {
  const counts = new Map<string, { n: number; p: P }>();
  for (const s of slots) {
    if (!s.promoter) continue;
    const c = counts.get(s.promoter.id) ?? { n: 0, p: s.promoter };
    // An active slot outweighs any number of stopped ones.
    c.n += s.active ? 1000 : 1;
    counts.set(s.promoter.id, c);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.p ?? null;
}

/** The lines and totals for a list of gigs, as the venue statement works them out (the sale includes any booking fee). */
export function billLine(gig: BillGig): BillLine {
  const d = dealBreakdown(gig);
  return { gig, exVat: d.grossMinor + d.bookingFeeMinor, vat: d.vatMinor, total: d.totalDueMinor };
}

const byDate = (a: BillLine, b: BillLine) => a.gig.setStart.getTime() - b.gig.setStart.getTime();

/** Group a month's billable gigs into the bills that should exist. */
export function groupBills(gigs: BillGig[], usualPayers: Map<string, Payer>): BillGroup[] {
  const groups = new Map<string, BillGroup>();
  for (const gig of gigs) {
    const payer = payerOf(gig, usualPayers);
    const key = billKey(payer, gig.venue.id);
    let g = groups.get(key);
    if (!g) {
      const perVenue = !payer || billingModeOf(payer.billing) === "PER_VENUE";
      g = {
        key,
        contactId: payer?.id ?? null,
        venueId: perVenue ? gig.venue.id : null,
        payer,
        venues: [],
        lines: [],
        currency: gig.currency,
        totals: { gigs: 0, exVat: 0, vat: 0, total: 0 },
        unconfirmed: [],
      };
      groups.set(key, g);
    }
    const line = billLine(gig);
    g.lines.push(line);
    if (!g.venues.some((v) => v.id === gig.venue.id)) g.venues.push(gig.venue);
    g.totals.gigs++;
    g.totals.exVat += line.exVat;
    g.totals.vat += line.vat;
    g.totals.total += line.total;
    if (NOT_CONFIRMED.includes(gig.status)) g.unconfirmed.push(gig);
  }
  for (const g of groups.values()) {
    g.lines.sort(byDate);
    g.venues.sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...groups.values()];
}

export type BillSteps = {
  poRequestedAt: Date | null;
  poNumber: string;
  poReceivedAt: Date | null;
  invoicedAt: Date | null;
  invoicedTotalMinor: number | null;
  paidAt: Date | null;
  nothingToBill: boolean;
};

export const BILL_STEPS = ["ASK_PO", "WAITING_PO", "TO_INVOICE", "INVOICED", "PAID", "NOTHING"] as const;
export type BillStep = (typeof BILL_STEPS)[number];
export const BILL_STEP_LABELS: Record<BillStep, string> = {
  ASK_PO: "Ask for PO",
  WAITING_PO: "Waiting for PO",
  TO_INVOICE: "Ready to invoice",
  INVOICED: "Invoiced",
  PAID: "Paid",
  NOTHING: "Nothing to bill",
};

/** How far a bill has got. A bill can be invoiced without a PO (some clients don't use them). */
export function billStep(b: BillSteps | null): BillStep {
  if (!b) return "ASK_PO";
  if (b.nothingToBill) return "NOTHING";
  if (b.paidAt) return "PAID";
  if (b.invoicedAt) return "INVOICED";
  if (b.poReceivedAt || b.poNumber) return "TO_INVOICE";
  if (b.poRequestedAt) return "WAITING_PO";
  return "ASK_PO";
}

/** A cancelled gig, for spotting ones cancelled after the bill was invoiced. */
export type CancelledGig = BillGig;

export type BillWarnings = {
  /** Gigs not confirmed yet. */
  unconfirmed: number;
  /** Invoiced, and the total now is different. */
  totalChanged: { invoiced: number; now: number } | null;
  /** Gigs added or edited since it was invoiced. */
  changedGigs: BillGig[];
  /** Gigs cancelled since it was invoiced. */
  cancelledSince: CancelledGig[];
  /** A bill that was listed before but has no gigs now (moved, cancelled or deleted). */
  noGigs: boolean;
  /** Marked nothing to bill, but it has gigs now. */
  gigsAfterNothing: boolean;
};

/** What to warn about on a bill: anything that means it might be wrong, or the invoice is out of date. */
export function billWarnings(group: BillGroup | null, steps: BillSteps | null, cancelled: CancelledGig[] = []): BillWarnings {
  const gigs = group?.lines.map((l) => l.gig) ?? [];
  const invoicedAt = steps?.invoicedAt ?? null;
  const now = group?.totals.total ?? 0;
  const invoiced = steps?.invoicedTotalMinor ?? null;
  const changedGigs = invoicedAt ? gigs.filter((g) => g.updatedAt > invoicedAt) : [];
  const cancelledSince = invoicedAt ? cancelled.filter((g) => g.updatedAt > invoicedAt) : [];
  return {
    unconfirmed: steps?.nothingToBill ? 0 : (group?.unconfirmed.length ?? 0),
    totalChanged: invoicedAt && invoiced !== null && invoiced !== now ? { invoiced, now } : null,
    changedGigs,
    cancelledSince,
    noGigs: gigs.length === 0 && !steps?.nothingToBill,
    gigsAfterNothing: gigs.length > 0 && !!steps?.nothingToBill,
  };
}

export type BillSummary = { toBill: number; askPo: number; waitingPo: number; toInvoice: number; waitingPayment: number; paid: number; nothing: number };

/** The counts at the top of the page: "12 to bill · 4 POs to ask for · …". "To bill" is every bill that isn't paid or nothing to bill. */
export function summarise(steps: BillStep[]): BillSummary {
  const n = (s: BillStep) => steps.filter((x) => x === s).length;
  return {
    toBill: steps.filter((s) => s !== "PAID" && s !== "NOTHING").length,
    askPo: n("ASK_PO"),
    waitingPo: n("WAITING_PO"),
    toInvoice: n("TO_INVOICE"),
    waitingPayment: n("INVOICED"),
    paid: n("PAID"),
    nothing: n("NOTHING"),
  };
}

/** The summary as one line of words, e.g. "12 to bill · 4 POs to ask for · 3 waiting for PO · 5 to invoice · 2 waiting for payment". */
export function summaryLine(s: BillSummary) {
  const parts = [
    `${s.toBill} to bill`,
    s.askPo ? `${s.askPo} PO${s.askPo === 1 ? "" : "s"} to ask for` : "",
    s.waitingPo ? `${s.waitingPo} waiting for PO` : "",
    s.toInvoice ? `${s.toInvoice} to invoice` : "",
    s.waitingPayment ? `${s.waitingPayment} waiting for payment` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The client's name on a bill: "Rekom: 3 venues", "Rekom: The Crown" for one venue, or the venue's name when nobody else pays. */
export function billName(b: { payer: Pick<Payer, "name" | "company"> | null; venues: { name: string }[] }, fallback = "Bill") {
  const venues = b.venues.length === 1 ? b.venues[0].name : b.venues.length > 1 ? `${b.venues.length} venues` : "";
  if (!b.payer) return venues || fallback;
  const who = b.payer.company || b.payer.name;
  return venues ? `${who}: ${venues}` : who;
}

/** "2026-10" from a date key or a month key, or null if it isn't one. */
export function readMonth(s: string | undefined | null): string | null {
  return s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : null;
}

/** Steps that mean a bill is still missing a PO or hasn't been invoiced: what the reminder on the 5th lists. */
export const STILL_TO_DO: BillStep[] = ["ASK_PO", "WAITING_PO", "TO_INVOICE"];

/**
 * The monthly reminders to the office, in the business's time zone, on weekdays from 9am to 5pm: the
 * "time to bill last month" note from the 1st (to the 4th, if the 1st is a weekend), and the "still to do"
 * reminder from the 5th (to the 9th). Each goes once; this only says which one is due now.
 */
export function billingReminderDue(local: { day: number; weekday: number; time: string }): "START" | "CHASE" | null {
  if (local.weekday > 5 || local.time < "09:00" || local.time >= "17:00") return null;
  if (local.day >= 1 && local.day <= 4) return "START";
  if (local.day >= 5 && local.day <= 9) return "CHASE";
  return null;
}
