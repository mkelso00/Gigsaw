import "server-only";
import { Prisma } from "@prisma/client";
import { log } from "@/server/log";
import {
  AUTO_INVOICE_DAYS,
  actFeeMinor,
  gigFinished,
  invoiceAmounts,
  invoiceChange,
  invoiceNumber,
  invoiceSnapshot,
  issueDecision,
  owedOnInvoice,
  paidOutMinor,
  type IssueDecision,
} from "./act-invoice-rules";
import { prisma } from "./db";
import { formatMoney } from "./money";
import { loadPayActs, payeeFor } from "./payee-server";
import { outstanding } from "./payments";
import { agreementInForce } from "./self-billing";
import { formatDate, localDateKey, zonedToUtc } from "./time";

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
type BookingRow = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;
type Payee = ReturnType<typeof payeeFor>;
type BookingForInvoice = BookingRow & { payee: Payee };

/** The bookings with who each one's invoice goes to, and their details (see src/lib/payee.ts). */
async function withPayees<T extends BookingRow>(rows: T[], db: Tx = prisma): Promise<(T & { payee: Payee })[]> {
  const byAgency = new Map<string, string[]>();
  for (const b of rows) if (b.artistId) byAgency.set(b.agencyId, [...(byAgency.get(b.agencyId) ?? []), b.artistId]);
  const payees = new Map<string, Payee>();
  for (const [agencyId, ids] of byAgency) for (const [id, act] of await loadPayActs(agencyId, ids, db)) payees.set(id, payeeFor(act));
  return rows.map((b) => ({ ...b, payee: (b.artistId && payees.get(b.artistId)) || null }));
}

/** What the invoice says it's for. The act's own fee only: nothing about what the venue or customer pays. */
function describe(b: BookingForInvoice) {
  const where = b.venue ? ` at ${b.venue.name}${b.venue.city ? `, ${b.venue.city}` : ""}` : "";
  return `Live performance by ${b.artist?.name ?? "the act"}${where} on ${formatDate(b.setStart, b.timezone)}${b.eventName ? ` (${b.eventName})` : ""}`;
}

async function lockBooking(tx: Tx, bookingId: string) {
  await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
  const b = await tx.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  return b ? (await withPayees([b], tx))[0] : null;
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
  if (!d.issue || !b.artist || !b.payee) return d;
  const seq = await nextSeq(tx, b.agencyId);
  const snap = invoiceSnapshot(b.artist.name, b.payee);
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
      // Made either way, so pay isn't held up; without a current agreement staff see "No self-billing agreement".
      selfBillingAgreedAt: agreementInForce(b.payee, now),
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

// ---------------------------------------------------------------------------------------------------------
// When invoices are made: after each gig (AUTO) or when the week is signed off in the pay run (SIGN_OFF)
// ---------------------------------------------------------------------------------------------------------

export const INVOICE_MODES = ["SIGN_OFF", "AUTO"] as const;
export type InvoiceMode = (typeof INVOICE_MODES)[number];
export const INVOICE_MODE_LABELS: Record<InvoiceMode, string> = {
  SIGN_OFF: "When we sign off the week (weekly pay run)",
  AUTO: "After each gig (automatic)",
};
export const NOT_SIGNED_OFF = "Waiting for the week to be signed off";

/** How this business makes its acts' invoices. */
export async function invoiceModeOf(agencyId: string, db: Pick<Tx, "settings"> = prisma): Promise<InvoiceMode> {
  const s = await db.settings.findUnique({ where: { agencyId }, select: { actInvoiceMode: true } });
  return s?.actInvoiceMode === "AUTO" ? "AUTO" : "SIGN_OFF";
}

/** True once this gig has been signed off as played in a weekly pay run. */
export async function isSignedOff(agencyId: string, bookingId: string, db: Pick<Tx, "payRun"> = prisma) {
  return !!(await db.payRun.findFirst({ where: { agencyId, signedOffBookingIds: { has: bookingId } }, select: { id: true } }));
}

/** Gigs signed off in the last year and a bit, for businesses that make invoices at sign-off. */
async function signedOffBookingIds(agencyId?: string) {
  const since = new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10);
  const runs = await prisma.payRun.findMany({
    where: { ...(agencyId ? { agencyId } : {}), signedOffAt: { not: null }, weekStart: { gte: since }, agency: { status: "ACTIVE" } },
    select: { signedOffBookingIds: true },
  });
  return new Set(runs.flatMap((r) => r.signedOffBookingIds));
}

/**
 * Make the act's invoice for a booking if it's due (see issueDecision). Safe to call any number of
 * times: a booking with a live invoice is left alone. `byHand` is staff asking for one from Pay acts, or the
 * week being signed off. `auto` is Gigsaw making it by itself (the scheduler, or the act checking out): for a
 * business that makes invoices at sign-off, only once the gig has been signed off.
 */
export async function issueActInvoice(
  bookingId: string,
  opts: { now?: Date; byHand?: boolean; auto?: boolean } = {},
): Promise<{ number: string } | { skipped: string }> {
  const now = opts.now ?? new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const b = await lockBooking(tx, bookingId);
      if (!b) return { skipped: "Booking not found" };
      if (await tx.actInvoice.findUnique({ where: { liveBookingId: b.id }, select: { id: true } })) return { skipped: "Already invoiced" };
      let byHand = !!opts.byHand;
      if (opts.auto && (await invoiceModeOf(b.agencyId, tx)) === "SIGN_OFF") {
        if (!(await isSignedOff(b.agencyId, b.id, tx))) return { skipped: NOT_SIGNED_OFF };
        // Signed off as played: made whenever it can be (details in, confirmed), however long that takes.
        byHand = true;
      }
      const r = await createFor(tx, b, now, byHand);
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
  // Only acts where someone's details are done (the act's own, or a person's in it): the rest are listed for staff
  // as waiting, not tried every minute. Whether they're the payee's is worked out by issueDecision.
  const done = { detailsCompletedAt: { not: null } };
  const detailsIn = {
    OR: [done, { members: { some: { person: done } } }, { partActs: { some: { child: { OR: [done, { members: { some: { person: done } } }] } } } }],
  } satisfies Prisma.ArtistWhereInput;
  // Businesses that make invoices at sign-off: only the gigs signed off as played, whenever they're ready (the payee's
  // details came in late, or the booking was confirmed after). The rest: each gig as it finishes.
  const signedOff = await signedOffBookingIds();
  const auto = { status: "ACTIVE", settings: { is: { actInvoiceMode: "AUTO" } } } satisfies Prisma.AgencyWhereInput;
  const due = await withPayees(
    await prisma.booking.findMany({
      where: {
        OR: [
          { ...candidateWhere(now, AUTO_INVOICE_DAYS), agency: auto, artist: detailsIn },
          ...(signedOff.size
            ? [
                {
                  id: { in: [...signedOff] },
                  demo: false,
                  status: { in: ["CONFIRMED", "SETTLED"] },
                  artistId: { not: null },
                  actInvoices: { none: { status: { not: "VOID" } } },
                  artist: detailsIn,
                },
              ]
            : []),
        ],
      },
      include: bookingInclude,
    }),
  );
  for (const b of due) {
    if (!issueDecision(b, now, signedOff.has(b.id)).issue) continue;
    try {
      if ("number" in (await issueActInvoice(b.id, { now, auto: true }))) result.issued++;
    } catch (e) {
      log.error("Act invoice failed", { bookingId: b.id, err: e });
    }
  }
  // Unpaid invoices are few (they're paid within days), so each is checked against its booking.
  const open = await prisma.actInvoice.findMany({ where: { status: "ISSUED" }, include: { booking: { include: bookingInclude } } });
  const bookings = new Map((await withPayees(open.flatMap((i) => (i.booking ? [i.booking] : [])))).map((b) => [b.id, b]));
  for (const inv of open) {
    const b = inv.bookingId ? (bookings.get(inv.bookingId) ?? null) : null;
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
  const rows = await withPayees(
    await prisma.booking.findMany({ where: { ...candidateWhere(now, 365), agencyId }, include: bookingInclude, orderBy: { setStart: "asc" } }),
  );
  // A business that makes invoices at sign-off: a gig that isn't signed off waits for the weekly pay run.
  const signOff = (await invoiceModeOf(agencyId)) === "SIGN_OFF";
  const signedOff = signOff ? await signedOffBookingIds(agencyId) : new Set<string>();
  return rows.flatMap((b) => {
    const owedMinor = Math.max(0, actFeeMinor(b) - paidOutMinor(b.payments));
    if (owedMinor <= 0) return [];
    if (signOff && !signedOff.has(b.id)) {
      const d = issueDecision(b, now, true);
      return [{ booking: b, owedMinor, reason: d.issue || !d.waiting ? NOT_SIGNED_OFF : `${d.reason} (and the week to be signed off)`, canMake: false }];
    }
    // Due now, but the scheduler hasn't got to it yet (or isn't running on this server).
    if (issueDecision(b, now).issue) return [{ booking: b, owedMinor, reason: "Due now", canMake: true }];
    const d = issueDecision(b, now, true);
    if (d.issue) return [{ booking: b, owedMinor, reason: `Finished more than ${AUTO_INVOICE_DAYS} days ago`, canMake: true }];
    if (d.waiting) return [{ booking: b, owedMinor, reason: d.reason, canMake: false }];
    return [];
  });
}

export type WeekGapKind = "DUE" | "WAITING" | "UNCONFIRMED" | "NOT_FINISHED";

/**
 * The gigs in a range of dates (by start) with an act to pay and no live invoice, for the weekly pay run: due
 * now (the scheduler hasn't got to it, or it's older than it looks back), waiting for the payee's details, not
 * confirmed yet, or not finished yet. Never cancelled gigs, enquiries, demo data, or acts paid already.
 */
export async function gigsWithoutInvoice(agencyId: string, range: { gte: Date; lt: Date }, now = new Date()) {
  const rows = await withPayees(
    await prisma.booking.findMany({
      where: {
        agencyId,
        demo: false,
        artistId: { not: null },
        setStart: range,
        status: { notIn: ["CANCELLED", "ENQUIRY"] },
        actInvoices: { none: { status: { not: "VOID" } } },
      },
      include: bookingInclude,
      orderBy: { setStart: "asc" },
    }),
  );
  return rows.flatMap((b) => {
    const owedMinor = Math.max(0, actFeeMinor(b) - paidOutMinor(b.payments));
    if (owedMinor <= 0) return [];
    const d = issueDecision(b, now, true);
    const row = (kind: WeekGapKind, reason: string) => [{ booking: b, owedMinor, kind, reason, canMake: kind === "DUE" }];
    if (d.issue) return row("DUE", "No invoice yet");
    if (b.status !== "CONFIRMED" && b.status !== "SETTLED") return row("UNCONFIRMED", "Not confirmed yet");
    if (!gigFinished(b, now)) return row("NOT_FINISHED", "Hasn't finished yet");
    if (d.waiting) return row("WAITING", d.reason);
    return [];
  });
}

/**
 * Every gig in a range of dates (by start) with an act and a fee for it, cancelled ones too (to show them), for
 * signing off the week: with who the invoice goes to and why it can't be made yet, the line-up changes and the
 * live invoice if it has one. Never enquiries or demo data.
 */
export async function weekGigsForSignOff(agencyId: string, range: { gte: Date; lt: Date }, now = new Date()) {
  const rows = await withPayees(
    await prisma.booking.findMany({
      where: { agencyId, demo: false, artistId: { not: null }, setStart: range, status: { not: "ENQUIRY" } },
      include: {
        ...bookingInclude,
        lineup: { select: { change: true, person: { select: { firstName: true, surname: true, alias: true } } } },
        actInvoices: { where: { status: { not: "VOID" } }, select: { id: true, number: true, status: true } },
      },
      orderBy: [{ setStart: "asc" }, { reference: "asc" }],
    }),
  );
  return rows.flatMap((b) => {
    const feeMinor = actFeeMinor(b);
    if (feeMinor <= 0) return [];
    const d = issueDecision(b, now, true);
    return [{ booking: b, feeMinor, finished: gigFinished(b, now), invoice: b.actInvoices[0] ?? null, waiting: !d.issue && d.waiting ? d.reason : "" }];
  });
}

// ---------------------------------------------------------------------------------------------------------
// Paying invoices, and undoing it
// ---------------------------------------------------------------------------------------------------------

/** The note on the payment logged when an invoice is marked paid, which is how undoing it finds the payment again. */
export const paymentNoteFor = (number: string) => `Invoice ${number}`;

type ActivityLine = { entityId: string; action: string; detail: string };

/**
 * Mark these unpaid invoices (of this agency) paid: each logs a payment out to the act on its gig for what's
 * still owed on it, exactly as paying an act anywhere else in Gigsaw does, so the booking, Payments and reports
 * all agree. A gig that's been and gone and is now paid both ways is marked Settled, as from Payments. The gigs
 * are locked first, so a double tap waits and then finds nothing left to pay. Used by Pay acts and the pay run.
 */
export async function payActInvoices(agencyId: string, ids: string[], now = new Date()) {
  let count = 0;
  let totalMinor = 0;
  let currency = "GBP";
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const settled: string[] = [];
  const activity: ActivityLine[] = [];
  const paidIds: string[] = [];
  if (!ids.length) return { count, totalMinor, currency, settled, activity, paidIds };
  await prisma.$transaction(async (tx) => {
    const found = await tx.actInvoice.findMany({ where: { id: { in: ids }, agencyId, status: "ISSUED" }, select: { bookingId: true } });
    const bookingIds = [...new Set(found.flatMap((f) => (f.bookingId ? [f.bookingId] : [])))];
    if (bookingIds.length) await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ANY(${bookingIds}) ORDER BY id FOR UPDATE`;
    const invoices = await tx.actInvoice.findMany({
      where: { id: { in: ids }, agencyId, status: "ISSUED" },
      include: { booking: { include: { payments: true } } },
      orderBy: { seq: "asc" },
    });
    currency = invoices[0]?.currency ?? "GBP";
    // A gig has one live invoice at most (liveBookingId is unique), so each invoice here is on a gig of its own.
    for (const inv of invoices) {
      const b = inv.booking;
      const owed = b ? owedOnInvoice(inv, b.payments) : 0;
      if (b && owed > 0) {
        const payment = {
          bookingId: b.id,
          direction: "OUT",
          kind: "SETTLEMENT",
          amountMinor: owed,
          paidAt: zonedToUtc(localDateKey(now, b.timezone), "12:00", b.timezone),
          note: paymentNoteFor(inv.number),
        };
        payments.push(payment);
        activity.push({ entityId: b.id, action: "payment sent", detail: `${formatMoney(owed, b.currency)} for ${inv.number}` });
        const after = outstanding({ ...b, payments: [...b.payments, payment] });
        if (b.status === "CONFIRMED" && b.setStart < now && after.toCollect === 0 && after.toPay === 0) {
          settled.push(b.id);
          activity.push({ entityId: b.id, action: "settled", detail: "paid in and out" });
        }
      }
      count++;
      paidIds.push(inv.id);
      if (inv.currency === currency) totalMinor += owed;
    }
    if (payments.length) await tx.payment.createMany({ data: payments });
    await tx.actInvoice.updateMany({ where: { id: { in: invoices.map((i) => i.id) } }, data: { status: "PAID", paidAt: now } });
    if (settled.length) await tx.booking.updateMany({ where: { id: { in: settled } }, data: { status: "SETTLED" } });
  });
  return { count, totalMinor, currency, settled, activity, paidIds };
}

/**
 * Undo marking these invoices paid: the payment logged for each (the one noted "Invoice SB-0012") is taken off its
 * gig, the invoice goes back to unpaid, and a gig that was Settled by it goes back to Confirmed. An invoice paid
 * some other way (e.g. a payment logged on the booking by hand) is left as it is and listed in `notUndone`.
 */
export async function unpayActInvoices(agencyId: string, ids: string[], now = new Date()) {
  let count = 0;
  let totalMinor = 0;
  let currency = "GBP";
  const notUndone: string[] = [];
  const unsettled: string[] = [];
  const activity: ActivityLine[] = [];
  if (!ids.length) return { count, totalMinor, currency, notUndone, unsettled, activity };
  await prisma.$transaction(async (tx) => {
    const found = await tx.actInvoice.findMany({ where: { id: { in: ids }, agencyId, status: "PAID" }, select: { bookingId: true } });
    const bookingIds = [...new Set(found.flatMap((f) => (f.bookingId ? [f.bookingId] : [])))];
    if (bookingIds.length) await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ANY(${bookingIds}) ORDER BY id FOR UPDATE`;
    const invoices = await tx.actInvoice.findMany({
      where: { id: { in: ids }, agencyId, status: "PAID" },
      include: { booking: { include: { payments: true } } },
      orderBy: { seq: "asc" },
    });
    currency = invoices[0]?.currency ?? "GBP";
    const removed = new Set<string>();
    for (const inv of invoices) {
      const b = inv.booking;
      const mine = b?.payments.filter((p) => p.direction === "OUT" && p.note === paymentNoteFor(inv.number)) ?? [];
      if (!b || !mine.length) {
        notUndone.push(inv.number);
        continue;
      }
      await tx.payment.deleteMany({ where: { id: { in: mine.map((p) => p.id) } } });
      for (const p of mine) removed.add(p.id);
      const amount = mine.reduce((t, p) => t + p.amountMinor, 0);
      activity.push({ entityId: b.id, action: "payment removed", detail: `${formatMoney(amount, b.currency)} for ${inv.number} (marked paid by mistake)` });
      count++;
      if (inv.currency === currency) totalMinor += amount;
    }
    const touched = [...new Set(invoices.flatMap((i) => (i.booking && !notUndone.includes(i.number) ? [i.booking] : [])))];
    // Back to unpaid: the same check as when a payment is taken off a booking anywhere.
    await syncActInvoicePaid(
      touched.map((b) => b.id),
      now,
      tx,
    );
    for (const b of touched) {
      const after = outstanding({ ...b, payments: b.payments.filter((p) => !removed.has(p.id)) });
      if (b.status === "SETTLED" && after.toPay > 0) {
        unsettled.push(b.id);
        activity.push({ entityId: b.id, action: "status changed", detail: "back to confirmed: the act isn't paid after all" });
      }
    }
    if (unsettled.length) await tx.booking.updateMany({ where: { id: { in: unsettled } }, data: { status: "CONFIRMED" } });
  });
  return { count, totalMinor, currency, notUndone, unsettled, activity };
}

/**
 * What an act's login may see of its invoices: only what the invoice says. Nothing from the booking's money:
 * no sale price, booking fee or what the venue or customer pays.
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
  payeeName: true,
  payeePersonId: true,
  actAddress: true,
  actVatNumber: true,
  bankAccountName: true,
  bankSortCode: true,
  bankAccountNumber: true,
  selfBillingAgreedAt: true,
  artistId: true,
} satisfies Prisma.ActInvoiceSelect;

/** Acts this person is the only member of. */
async function soloActsOf(personId: string) {
  const acts = await prisma.artist.findMany({ where: { members: { some: { personId } } }, select: { id: true, _count: { select: { members: true } } } });
  return acts.filter((a) => a._count.members === 1).map((a) => a.id);
}

/**
 * The invoices an act's login may see: only those made out to it, as they carry the payee's bank details and
 * what they're paid. A person sees the invoices made out to them (a band's lead sees the band's; the others
 * never see the band's money), and those of a solo act they're the only person in that were made out to the
 * act itself (its details from before were theirs). An act's own login sees those made out to the act, and
 * those of its only person, whose details it fills in (see actLoginFillsIn). Null: none.
 */
export async function invoiceWhereForLogin(user: {
  agencyId: string;
  artistId: string | null;
  personId: string | null;
}): Promise<Prisma.ActInvoiceWhereInput | null> {
  if (user.personId) {
    const solo = await soloActsOf(user.personId);
    return { agencyId: user.agencyId, OR: [{ payeePersonId: user.personId }, ...(solo.length ? [{ payeePersonId: null, artistId: { in: solo } }] : [])] };
  }
  if (!user.artistId) return null;
  const members = await prisma.personAct.findMany({ where: { artistId: user.artistId }, select: { personId: true } });
  const sole = members.length === 1 ? members[0].personId : null;
  return { agencyId: user.agencyId, artistId: user.artistId, OR: [{ payeePersonId: null }, ...(sole ? [{ payeePersonId: sole }] : [])] };
}

export async function invoicesForActLogin(user: { agencyId: string; artistId: string | null; personId: string | null }) {
  const where = await invoiceWhereForLogin(user);
  if (!where) return [];
  return prisma.actInvoice.findMany({ where, select: actInvoiceSelect, orderBy: [{ issuedAt: "desc" }, { seq: "desc" }] });
}

/** One invoice for whoever is looking: staff of the agency, or the login it's made out to. Null if they can't see it. */
export async function invoiceForViewer(user: { role: string; agencyId: string; artistId: string | null; personId: string | null }, id: string) {
  if (user.role !== "ARTIST") return prisma.actInvoice.findFirst({ where: { id, agencyId: user.agencyId }, select: actInvoiceSelect });
  const where = await invoiceWhereForLogin(user);
  if (!where) return null;
  return prisma.actInvoice.findFirst({ where: { AND: [where, { id }] }, select: actInvoiceSelect });
}
