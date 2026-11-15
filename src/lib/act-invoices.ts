import "server-only";
import { Prisma } from "@prisma/client";
import { log } from "@/server/log";
import {
  AUTO_INVOICE_DAYS,
  actFeeMinor,
  actSnapshot,
  invoiceAmounts,
  invoiceChange,
  invoiceNumber,
  issueDecision,
  paidOutMinor,
  type IssueDecision,
} from "./act-invoice-rules";
import { prisma } from "./db";
import { ownActIds } from "./people";
import { formatDate } from "./time";

// Self-billing invoices for acts, in the database. The rules (when one is made, when it's replaced)
// are in ./act-invoice-rules.ts. Every change here runs in a transaction that locks the booking row
// first, and numbers are taken with the agency row locked, so two servers (or the scheduler and an
// act checking out at the same moment) can't make two invoices for one gig or reuse a number. The
// unique liveBookingId is the last word if anything gets past that.

/** The client inside prisma.$transaction (the app's extended one, so not Prisma.TransactionClient). */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const DAY = 86_400_000;

const bookingInclude = {
  artist: true,
  venue: { select: { name: true, city: true } },
  payments: { select: { direction: true, amountMinor: true, paidAt: true } },
  checkIns: { where: { kind: "DEPARTED" }, select: { kind: true } },
} satisfies Prisma.BookingInclude;
type BookingForInvoice = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

/** What the invoice says it's for. The act's own fee only: nothing about what the venue or customer pays. */
function describe(b: BookingForInvoice) {
  const where = b.venue ? ` at ${b.venue.name}${b.venue.city ? `, ${b.venue.city}` : ""}` : "";
  return `Live performance by ${b.artist?.name ?? "the act"}${where} on ${formatDate(b.setStart, b.timezone)}${b.eventName ? ` (${b.eventName})` : ""}`;
}

async function lockBooking(tx: Tx, bookingId: string) {
  await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
  return tx.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
}

/** The agency's next invoice number. Call inside the transaction that creates the invoice. */
async function nextSeq(tx: Tx, agencyId: string) {
  await tx.$queryRaw`SELECT id FROM "Agency" WHERE id = ${agencyId} FOR UPDATE`;
  const last = await tx.actInvoice.aggregate({ where: { agencyId }, _max: { seq: true } });
  return (last._max.seq ?? 0) + 1;
}

/** Make the invoice for a locked booking that has no live one, if the rules say so. */
async function createFor(tx: Tx, b: BookingForInvoice, now: Date, byHand: boolean, note = ""): Promise<IssueDecision & { number?: string }> {
  const d = issueDecision(b, now, byHand);
  if (!d.issue || !b.artist) return d;
  const seq = await nextSeq(tx, b.agencyId);
  const snap = actSnapshot(b.artist);
  const amounts = invoiceAmounts(d.netMinor, snap.actVatNumber);
  const paidOut = paidOutMinor(b.payments);
  // Already paid in full (staff made one by hand for a gig paid before): it goes straight to paid.
  const paid = paidOut >= amounts.totalMinor;
  const lastOut = b.payments.filter((p) => p.direction === "OUT").sort((x, y) => y.paidAt.getTime() - x.paidAt.getTime())[0];
  const inv = await tx.actInvoice.create({
    data: {
      agencyId: b.agencyId,
      artistId: b.artistId,
      bookingId: b.id,
      liveBookingId: b.id,
      seq,
      number: invoiceNumber(seq),
      currency: b.currency,
      ...amounts,
      status: paid ? "PAID" : "ISSUED",
      issuedAt: now,
      paidAt: paid ? (lastOut?.paidAt ?? now) : null,
      note,
      bookingRef: b.reference,
      description: describe(b),
      gigDate: b.setStart,
      ...snap,
    },
  });
  await tx.activity.create({
    data: { agencyId: b.agencyId, entity: "BOOKING", entityId: b.id, action: "act invoice issued", detail: `${inv.number}${note ? ` (${note})` : ""}` },
  });
  return { ...d, number: inv.number };
}

function isUniqueClash(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Make the act's invoice for a booking if it's due (see issueDecision). Safe to call any number of
 * times: a booking with a live invoice is left alone. `byHand` is staff asking for one from Pay acts.
 */
export async function issueActInvoice(bookingId: string, opts: { now?: Date; byHand?: boolean } = {}): Promise<{ number: string } | { skipped: string }> {
  const now = opts.now ?? new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const b = await lockBooking(tx, bookingId);
      if (!b) return { skipped: "Booking not found" };
      if (await tx.actInvoice.findUnique({ where: { liveBookingId: b.id }, select: { id: true } })) return { skipped: "Already invoiced" };
      const r = await createFor(tx, b, now, !!opts.byHand);
      return r.issue && r.number ? { number: r.number } : { skipped: r.issue ? "Not made" : r.reason };
    });
  } catch (e) {
    // Someone else made it a moment ago.
    if (isUniqueClash(e)) return { skipped: "Already invoiced" };
    throw e;
  }
}

/**
 * Bring an unpaid invoice into line with its booking and act: marked paid once the act has been paid
 * in full, voided (and replaced when the gig still needs one) when what it says no longer holds.
 */
export async function reconcileActInvoice(invoiceId: string, now = new Date()): Promise<"paid" | "voided" | "reissued" | null> {
  const first = await prisma.actInvoice.findUnique({ where: { id: invoiceId }, select: { bookingId: true } });
  if (!first) return null;
  try {
    return await prisma.$transaction(async (tx) => {
      const b = first.bookingId ? await lockBooking(tx, first.bookingId) : null;
      const inv = await tx.actInvoice.findUnique({ where: { id: invoiceId } });
      if (!inv || inv.status !== "ISSUED") return null;
      if (b && paidOutMinor(b.payments) >= inv.totalMinor) {
        await tx.actInvoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: now } });
        return "paid";
      }
      const change = invoiceChange(inv, b);
      if (!change) return null;
      await tx.actInvoice.update({ where: { id: inv.id }, data: { status: "VOID", voidedAt: now, liveBookingId: null, note: change.reason } });
      if (b)
        await tx.activity.create({
          data: { agencyId: b.agencyId, entity: "BOOKING", entityId: b.id, action: "act invoice voided", detail: `${inv.number}: ${change.reason}` },
        });
      if (!change.keep || !b) return "voided";
      const r = await createFor(tx, b, now, true, `Replaces ${inv.number}: ${change.reason.charAt(0).toLowerCase()}${change.reason.slice(1)}`);
      return r.issue ? "reissued" : "voided";
    });
  } catch (e) {
    if (isUniqueClash(e)) return null;
    throw e;
  }
}

/**
 * Keep live invoices' status in step with the payments on their bookings, after a payment to an act is
 * logged or removed anywhere: paid once the act has had the total, back to unpaid if a payment is taken off.
 */
export async function syncActInvoicePaid(bookingIds: string[], now = new Date(), tx: Tx = prisma) {
  if (!bookingIds.length) return;
  const live = await tx.actInvoice.findMany({
    where: { liveBookingId: { in: bookingIds } },
    include: { booking: { select: { payments: { select: { direction: true, amountMinor: true, paidAt: true } } } } },
  });
  for (const inv of live) {
    const payments = inv.booking?.payments ?? [];
    const paid = paidOutMinor(payments) >= inv.totalMinor;
    if (paid && inv.status === "ISSUED") {
      const last = payments.filter((p) => p.direction === "OUT").sort((x, y) => y.paidAt.getTime() - x.paidAt.getTime())[0];
      await tx.actInvoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: last?.paidAt ?? now } });
    } else if (!paid && inv.status === "PAID") {
      await tx.actInvoice.update({ where: { id: inv.id }, data: { status: "ISSUED", paidAt: null } });
    }
  }
}

/** Gigs that could be due an invoice: on, with an act, finished in the window (with a day to spare). */
function candidateWhere(now: Date, days: number) {
  return {
    demo: false,
    status: { in: ["CONFIRMED", "SETTLED"] },
    artistId: { not: null },
    // The call time comes before the end, so this window holds every gig that ended in the last `days`.
    arriveBy: { gte: new Date(now.getTime() - (days + 2) * DAY), lt: now },
    actInvoices: { none: { status: { not: "VOID" } } },
    agency: { status: "ACTIVE" },
  } satisfies Prisma.BookingWhereInput;
}

/**
 * The scheduler's job, every minute: make the invoices that are due, and bring unpaid ones into line
 * with any change since. Each booking is its own transaction, so one bad row never stops the rest.
 */
export async function runActInvoices(now = new Date()) {
  const result = { issued: 0, paid: 0, voided: 0, reissued: 0 };
  // Only acts whose details are done: the rest are listed for staff as waiting, not tried every minute.
  const due = await prisma.booking.findMany({
    where: { ...candidateWhere(now, AUTO_INVOICE_DAYS), artist: { detailsCompletedAt: { not: null } } },
    include: bookingInclude,
  });
  for (const b of due) {
    if (!issueDecision(b, now).issue) continue;
    try {
      if ("number" in (await issueActInvoice(b.id, { now }))) result.issued++;
    } catch (e) {
      log.error("Act invoice failed", { bookingId: b.id, err: e });
    }
  }
  // Unpaid invoices are few (they're paid within days), so each is checked against its booking.
  const open = await prisma.actInvoice.findMany({ where: { status: "ISSUED" }, include: { booking: { include: bookingInclude } } });
  for (const inv of open) {
    const b = inv.booking;
    const paid = !!b && paidOutMinor(b.payments) >= inv.totalMinor;
    if (!paid && !invoiceChange(inv, b)) continue;
    try {
      const r = await reconcileActInvoice(inv.id, now);
      if (r) result[r]++;
    } catch (e) {
      log.error("Act invoice check failed", { invoiceId: inv.id, err: e });
    }
  }
  return result;
}

/**
 * Finished gigs still owed to the act that have no invoice, for staff: waiting for the act's details,
 * or older than the automatic window (made by hand). Up to a year back.
 */
export async function uninvoicedGigs(agencyId: string, now = new Date()) {
  const rows = await prisma.booking.findMany({ where: { ...candidateWhere(now, 365), agencyId }, include: bookingInclude, orderBy: { setStart: "asc" } });
  return rows.flatMap((b) => {
    const owedMinor = Math.max(0, actFeeMinor(b) - paidOutMinor(b.payments));
    if (owedMinor <= 0) return [];
    // Due now, but the scheduler hasn't got to it yet (or isn't running on this server).
    if (issueDecision(b, now).issue) return [{ booking: b, owedMinor, reason: "Due now", canMake: true }];
    const d = issueDecision(b, now, true);
    if (d.issue) return [{ booking: b, owedMinor, reason: `Finished more than ${AUTO_INVOICE_DAYS} days ago`, canMake: true }];
    if (d.waiting) return [{ booking: b, owedMinor, reason: d.reason, canMake: false }];
    return [];
  });
}

/**
 * What an act's login may see of its invoices: the acts it's directly in (not bands a solo act is
 * part of), and only what the invoice says. Nothing from the booking's money: no sale price, booking
 * fee or what the venue or customer pays.
 */
export const actInvoiceSelect = {
  id: true,
  number: true,
  status: true,
  currency: true,
  netMinor: true,
  vatPct: true,
  vatMinor: true,
  totalMinor: true,
  issuedAt: true,
  paidAt: true,
  voidedAt: true,
  note: true,
  bookingId: true,
  bookingRef: true,
  description: true,
  gigDate: true,
  actName: true,
  actAddress: true,
  actVatNumber: true,
  bankAccountName: true,
  bankSortCode: true,
  bankAccountNumber: true,
  artistId: true,
} satisfies Prisma.ActInvoiceSelect;

export async function invoicesForActLogin(user: { agencyId: string; artistId: string | null; personId: string | null }) {
  const actIds = await ownActIds(user);
  if (!actIds.length) return [];
  return prisma.actInvoice.findMany({
    where: { agencyId: user.agencyId, artistId: { in: actIds } },
    select: actInvoiceSelect,
    orderBy: [{ issuedAt: "desc" }, { seq: "desc" }],
  });
}

/** One invoice for whoever is looking: staff of the agency, or the act it's for. Null if they can't see it. */
export async function invoiceForViewer(user: { role: string; agencyId: string; artistId: string | null; personId: string | null }, id: string) {
  const inv = await prisma.actInvoice.findFirst({ where: { id, agencyId: user.agencyId }, select: actInvoiceSelect });
  if (!inv) return null;
  if (user.role === "ARTIST" && (!inv.artistId || !(await ownActIds(user)).includes(inv.artistId))) return null;
  return inv;
}
