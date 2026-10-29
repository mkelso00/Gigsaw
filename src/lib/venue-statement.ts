import "server-only";
import { prisma } from "./db";
import { dealBreakdown, paymentTotals } from "./money";
import { addDaysToKey, zonedToUtc } from "./time";

// A venue's statement for a date range: the gigs played there, what the venue owes for them
// (the sale, plus VAT), what each act is paid (the cost), and what's been received and paid out.
// Gigs booked by a private customer (e.g. a wedding at the venue) aren't the venue's to pay, so
// they're left out unless asked for. Cancelled gigs, enquiries and gigs with no act are left out.

export async function venueStatement(agencyId: string, venueId: string, from: string, to: string, includeCustomers = false, invoiceOnly = false) {
  const venue = await prisma.venue.findFirst({ where: { id: venueId, agencyId } });
  if (!venue) return null;
  const tz = venue.timezone;
  const gigs = await prisma.booking.findMany({
    where: {
      agencyId,
      venueId,
      artistId: { not: null },
      status: { notIn: ["CANCELLED", "ENQUIRY"] },
      arriveBy: { gte: zonedToUtc(from, "00:00", tz), lt: zonedToUtc(addDaysToKey(to, 1), "00:00", tz) },
      AND: [
        ...(includeCustomers ? [] : [{ eventId: null }, { OR: [{ promoterId: null }, { promoter: { type: { not: "CLIENT" } } }] }]),
        // The invoice only bills gigs that are on (confirmed or settled) or that clearly happened.
        ...(invoiceOnly ? [{ OR: [{ status: { in: ["CONFIRMED", "SETTLED"] } }, { checkIns: { some: { kind: "ARRIVED" } } }] }] : []),
      ],
    },
    include: {
      artist: { select: { name: true, colour: true } },
      payments: true,
      promoter: true,
      checkIns: { where: { kind: "ARRIVED" }, select: { at: true }, take: 1 },
    },
    orderBy: { setStart: "asc" },
  });
  const rows = gigs.map((b) => {
    const d = dealBreakdown(b);
    const p = paymentTotals(b.payments);
    // The sale here includes any booking fee, so the venue sees one line per gig.
    return {
      b,
      sale: d.grossMinor + d.bookingFeeMinor,
      vat: d.vatMinor,
      due: d.totalDueMinor,
      cost: d.artistMinor,
      received: p.receivedMinor,
      paidOut: p.paidOutMinor,
    };
  });
  const sum = (k: "sale" | "vat" | "due" | "cost" | "received" | "paidOut") => rows.reduce((t, r) => t + r[k], 0);
  const totals = {
    gigs: rows.length,
    sale: sum("sale"),
    vat: sum("vat"),
    due: sum("due"),
    received: sum("received"),
    owed: Math.max(0, sum("due") - sum("received")),
    cost: sum("cost"),
    paidOut: sum("paidOut"),
    owedToActs: Math.max(0, sum("cost") - sum("paidOut")),
    margin: sum("sale") - sum("cost"),
    unconfirmed: rows.filter((r) => r.b.status !== "CONFIRMED" && r.b.status !== "SETTLED").length,
  };
  // Who to bill: the contact named on most of these gigs, if any.
  const counts = new Map<string, { n: number; c: (typeof gigs)[number]["promoter"] }>();
  for (const g of gigs) if (g.promoter) counts.set(g.promoter.id, { n: (counts.get(g.promoter.id)?.n ?? 0) + 1, c: g.promoter });
  const billTo = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.c ?? null;
  const currency = gigs[0]?.currency ?? "GBP";
  return { venue, rows, totals, billTo, currency };
}

/** This month and last month, as [from, to] date keys, for the quick buttons. */
export function monthRange(today: string, back = 0): [string, string] {
  const [y, m] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 - back, 1));
  const end = new Date(Date.UTC(y, m - back, 0));
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}
