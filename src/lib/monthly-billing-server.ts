import "server-only";
import type { MonthlyBill, Prisma } from "@prisma/client";
import { log } from "@/server/log";
import { monthLabel, monthSearchWindow, shiftMonth } from "./billing";
import { COUNTABLE } from "./count-statuses";
import { actName } from "./constants";
import { prisma } from "./db";
import { messageFor } from "./message-templates";
import { appUrl, sendEmail } from "./messaging";
import { formatMoney } from "./money";
import {
  BILL_STEPS,
  billName,
  billStep,
  billWarnings,
  billingReminderDue,
  groupBills,
  STILL_TO_DO,
  summarise,
  summaryLine,
  usualPayerOf,
  type BillGig,
  type BillGroup,
  type BillStep,
  type BillWarnings,
  type Payer,
} from "./monthly-billing";
import { claimedReminders, claimReminder } from "./reminders";
import { teamRecipients } from "./team-alerts";
import { getInvoiceStatuses, XeroError, xeroConnectionFor } from "./xero";
import { formatDate, localDateKey, localTime, zonedParts } from "./time";

// The database side of monthly billing (src/lib/monthly-billing.ts has the rules): the month's billable gigs,
// the bills they make, merged with the stored MonthlyBill rows (made the first time a bill is listed), the
// "please send a PO" email, and the reminders to the office on the 1st and 5th of the month.

const payerSelect = { id: true, name: true, company: true, email: true, billing: true } satisfies Prisma.ContactSelect;

const gigSelect = {
  id: true,
  reference: true,
  status: true,
  arriveBy: true,
  setStart: true,
  setEnd: true,
  timezone: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
  dealType: true,
  feeMinor: true,
  artistFeeMinor: true,
  commissionPct: true,
  vatPct: true,
  bookingFeeMinor: true,
  venue: { select: { id: true, name: true, timezone: true } },
  promoter: { select: payerSelect },
  artist: { select: { name: true } },
} satisfies Prisma.BookingSelect;

/**
 * The month's gigs at venues, as the venue statement counts them: every status but cancelled (or only the
 * cancelled ones), dated in the month in the venue's own time zone, and never a wedding's or a private
 * customer's gigs.
 */
async function monthGigs(agencyId: string, month: string, cancelled = false): Promise<BillGig[]> {
  const rows = await prisma.booking.findMany({
    where: {
      agencyId,
      venueId: { not: null },
      status: cancelled ? "CANCELLED" : { in: COUNTABLE.filter((s) => s !== "CANCELLED") },
      arriveBy: monthSearchWindow(month),
      eventId: null,
      OR: [{ promoterId: null }, { promoter: { type: { not: "CLIENT" } } }],
    },
    select: gigSelect,
    orderBy: { setStart: "asc" },
  });
  return rows.flatMap((b) => (b.venue && localDateKey(b.arriveBy, b.venue.timezone).slice(0, 7) === month ? [{ ...b, venue: b.venue }] : []));
}

/** Each venue's usual payer, from the promoters on its weekly slots. */
async function usualPayers(agencyId: string, venueIds: string[]) {
  const slots = venueIds.length
    ? await prisma.venueSlot.findMany({
        where: { agencyId, venueId: { in: venueIds }, promoterId: { not: null }, promoter: { type: { not: "CLIENT" } } },
        select: { venueId: true, active: true, promoter: { select: payerSelect } },
      })
    : [];
  const out = new Map<string, Payer>();
  for (const id of venueIds) {
    const p = usualPayerOf(slots.filter((s) => s.venueId === id));
    if (p) out.set(id, p);
  }
  return out;
}

type StoredBill = MonthlyBill & {
  contact: Payer | null;
  venue: { id: string; name: string; timezone: string } | null;
};

export type BillView = {
  id: string;
  key: string;
  month: string;
  name: string;
  bill: StoredBill;
  group: BillGroup | null;
  step: BillStep;
  warnings: BillWarnings;
  currency: string;
};

/**
 * Every bill for the month: one for each group of gigs (made in MonthlyBill if it isn't there yet), plus any
 * bill listed before whose gigs have all gone, until it's marked nothing to bill. Ordered by step, then name.
 */
export async function monthlyBills(agencyId: string, month: string, defaultCurrency = "GBP"): Promise<BillView[]> {
  const gigs = await monthGigs(agencyId, month);
  const payers = await usualPayers(agencyId, [...new Set(gigs.map((g) => g.venue.id))]);
  const groups = groupBills(gigs, payers);
  // Made the first time each bill is listed; a second server (or a double load) making the same one is skipped.
  if (groups.length) {
    await prisma.monthlyBill.createMany({
      data: groups.map((g) => ({ agencyId, month, key: g.key, contactId: g.contactId, venueId: g.venueId })),
      skipDuplicates: true,
    });
  }
  const stored: StoredBill[] = await prisma.monthlyBill.findMany({
    where: { agencyId, month },
    include: { contact: { select: payerSelect }, venue: { select: { id: true, name: true, timezone: true } } },
  });
  // Gigs cancelled since a bill was invoiced: only looked for when something has been invoiced.
  const cancelledByKey = new Map<string, BillGig[]>();
  if (stored.some((b) => b.invoicedAt)) {
    const cancelled = await monthGigs(agencyId, month, true);
    const more = await usualPayers(
      agencyId,
      [...new Set(cancelled.map((g) => g.venue.id))].filter((id) => !payers.has(id)),
    );
    for (const g of groupBills(cancelled, new Map([...payers, ...more])))
      cancelledByKey.set(
        g.key,
        g.lines.map((l) => l.gig),
      );
  }
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const views = stored.map((bill): BillView => {
    const group = byKey.get(bill.key) ?? null;
    const step = billStep(bill);
    const fallback = { payer: bill.contact, venues: bill.venue ? [bill.venue] : [] };
    return {
      id: bill.id,
      key: bill.key,
      month,
      name: billName(group ?? fallback, "Venue or company deleted"),
      bill,
      group,
      step,
      warnings: billWarnings(group, bill, cancelledByKey.get(bill.key)),
      currency: group?.currency ?? defaultCurrency,
    };
  });
  // A bill with no gigs that was never worked on (e.g. the gigs moved before anyone looked) isn't worth showing.
  const shown = views.filter((v) => v.group || v.bill.nothingToBill || worked(v.bill));
  return shown.sort((a, b) => BILL_STEPS.indexOf(a.step) - BILL_STEPS.indexOf(b.step) || a.name.localeCompare(b.name));
}

/** Anything done on a bill yet: a PO asked for or in, invoiced, paid or a note. */
function worked(b: MonthlyBill) {
  return !!(b.poRequestedAt || b.poNumber || b.poReceivedAt || b.invoicedAt || b.paidAt || b.note);
}

/** One bill, worked out afresh, for an action or a print. Null if it isn't this agency's. */
export async function monthlyBill(agencyId: string, billId: string) {
  const row = await prisma.monthlyBill.findFirst({ where: { id: billId, agencyId }, select: { month: true } });
  if (!row) return null;
  const settings = await prisma.settings.findUnique({ where: { agencyId }, select: { defaultCurrency: true } });
  const views = await monthlyBills(agencyId, row.month, settings?.defaultCurrency);
  return views.find((v) => v.id === billId) ?? null;
}

/** The bill for a venue (its own, or the one its gigs go on) in a month, for the printed venue statement. */
export async function billForVenueMonth(agencyId: string, venueId: string, month: string) {
  const rows = await prisma.monthlyBill.findMany({
    where: { agencyId, month, OR: [{ venueId }, { venueId: null, contactId: { not: null } }] },
  });
  if (!rows.length) return null;
  const own = rows.find((r) => r.venueId === venueId);
  if (own) return own;
  // A company's combined bill covers this venue when this month's gigs here are on it.
  const gigs = await monthGigs(agencyId, month);
  const here = gigs.filter((g) => g.venue.id === venueId);
  if (!here.length) return null;
  const groups = groupBills(here, await usualPayers(agencyId, [venueId]));
  return rows.find((r) => groups.some((g) => g.key === r.key)) ?? null;
}

// ---------------------------------------------------------------------------------------------------------
// Asking for a PO
// ---------------------------------------------------------------------------------------------------------

/** Who to email for a PO: the paying company's email, else someone at the company, else someone at the venue. */
export async function poRecipient(agencyId: string, v: Pick<BillView, "bill" | "group">) {
  const payer = v.group?.payer ?? v.bill.contact;
  if (payer?.email) return { email: payer.email, firstName: payer.name.trim().split(/\s+/)[0] ?? "" };
  const venueIds = v.group?.venues.map((x) => x.id) ?? (v.bill.venueId ? [v.bill.venueId] : []);
  const someone = (where: Prisma.PersonWhereInput) =>
    prisma.person.findFirst({ where: { agencyId, email: { not: "" }, ...where }, orderBy: { createdAt: "asc" }, select: { email: true, firstName: true } });
  const person = (payer ? await someone({ companyId: payer.id }) : null) ?? (venueIds.length ? await someone({ venueId: { in: venueIds } }) : null);
  return person ? { email: person.email, firstName: person.firstName } : null;
}

/**
 * Email the client a summary of the month's gigs (date, venue, act and what each costs them, never what the
 * act is paid) asking for a PO number, with replies going to the business's email. Returns the send status.
 */
export async function sendPoRequest(agencyId: string, v: BillView, to: string, firstName: string) {
  const settings = await prisma.settings.findUnique({ where: { agencyId } });
  if (!settings) return "SKIPPED";
  const business = settings.agencyName;
  const month = monthLabel(v.month);
  const m = (x: number) => formatMoney(x, v.currency);
  const client = v.group?.payer ? v.group.payer.company || v.group.payer.name : v.name;
  const lines = v.group?.lines ?? [];
  const totals = v.group?.totals ?? { gigs: 0, exVat: 0, vat: 0, total: 0 };
  const t = messageFor(settings.messageTemplates, "BILL_PO_REQUEST", {
    first_name: firstName,
    month,
    client,
    total: m(totals.total),
    business,
  });
  const rows: [string, string][] = lines.map((l) => [
    formatDate(l.gig.arriveBy, l.gig.timezone),
    `${l.gig.venue.name}: ${actName(l.gig)}, ${localTime(l.gig.setStart, l.gig.timezone)}\n${m(l.exVat)}${l.vat ? ` + VAT` : ""}`,
  ]);
  rows.push([
    "Total",
    `${m(totals.exVat)}${totals.vat ? ` + VAT ${m(totals.vat)} = ${m(totals.total)}` : ""} (${totals.gigs} gig${totals.gigs === 1 ? "" : "s"})`,
  ]);
  const title = `Purchase order for ${month}`;
  return sendEmail({
    kind: "BILLING",
    agencyId,
    to,
    replyTo: settings.agencyEmail,
    subject: t.subject ?? `Purchase order needed: ${client}, ${month}`,
    email: {
      brand: business,
      preheader: `${totals.gigs} gig${totals.gigs === 1 ? "" : "s"} in ${month}, ${m(totals.total)}`,
      title,
      intro:
        t.intro ??
        `Hi ${firstName || "there"}, here are the gigs ${business} will be billing ${client} for in ${month}. Please could you send us a purchase order (PO) number for them? Just reply to this email.`,
      rowsTitle: `${client}: ${month}`,
      rows,
      outro: "If anything here doesn't look right, reply and let us know before we raise the invoice.",
    },
  });
}

// ---------------------------------------------------------------------------------------------------------
// Reminders to the office
// ---------------------------------------------------------------------------------------------------------

export const START_KIND = "BILL_START";
export const CHASE_KIND = "BILL_CHASE";
const recipientOf = (agencyId: string) => `agency:${agencyId}`;

/**
 * The monthly billing reminders, run by the scheduler: on the 1st, "Monthly billing for <last month>: N to bill",
 * and on the 5th, the bills still missing a PO or not invoiced. Weekdays, 9am to 5pm in the business's time zone
 * (so a 1st on a Saturday sends on the Monday). Each is claimed once per business and month in the Reminder table.
 */
export async function runBillingReminders(now = new Date()) {
  const agencies = await prisma.agency.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      settings: { select: { defaultTimezone: true, agencyName: true, agencyEmail: true, defaultCurrency: true, messageTemplates: true } },
    },
  });
  const due: Due[] = [];
  for (const a of agencies) {
    if (!a.settings) continue;
    const tz = a.settings.defaultTimezone;
    const p = zonedParts(now, tz);
    const today = localDateKey(now, tz);
    const weekday = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const which = billingReminderDue({ day: p.day, weekday, time: localTime(now, tz) });
    if (!which) continue;
    due.push({ agencyId: a.id, kind: which === "START" ? START_KIND : CHASE_KIND, month: shiftMonth(today.slice(0, 7), -1), s: a.settings, name: a.name });
  }
  if (!due.length) return { sent: 0 };
  // Runs every minute: skip the ones already sent without working out their bills again.
  const claimed = await claimedReminders(
    [START_KIND, CHASE_KIND],
    due.map((d) => recipientOf(d.agencyId)),
    due.map((d) => d.month),
  );
  let sent = 0;
  for (const d of due) {
    if (claimed.has(`${d.kind}|${recipientOf(d.agencyId)}|${d.month}`)) continue;
    if (!(await claimReminder(d.kind, recipientOf(d.agencyId), d.month))) continue;
    // One business's trouble (e.g. deleted while this ran) never stops the others'.
    try {
      if (await sendBillingReminder(d)) sent++;
    } catch (e) {
      log.error("Monthly billing reminder failed", { job: "monthly-billing", agencyId: d.agencyId, err: e });
    }
  }
  return { sent };
}

type Due = {
  agencyId: string;
  kind: string;
  month: string;
  name: string;
  s: { agencyName: string; agencyEmail: string; defaultCurrency: string; messageTemplates: unknown };
};

/** Send one business its reminder, if there's anything to say. True if it went. */
async function sendBillingReminder(d: Due) {
  const views = await monthlyBills(d.agencyId, d.month, d.s.defaultCurrency);
  const start = d.kind === START_KIND;
  const summary = summarise(views.map((v) => v.step));
  const toDo = views.filter((v) => STILL_TO_DO.includes(v.step));
  const count = start ? summary.toBill : toDo.length;
  if (!count) return false;
  const business = d.s.agencyName || d.name;
  const month = monthLabel(d.month);
  const t = messageFor(d.s.messageTemplates, start ? "BILL_MONTH_START" : "BILL_MONTH_CHASE", { month, count: String(count), business });
  if (!t.on) return false;
  const m = (v: BillView) => formatMoney(v.group?.totals.total ?? 0, v.currency);
  const list = start ? views.filter((v) => v.step !== "PAID" && v.step !== "NOTHING") : toDo;
  const subject = t.subject ?? (start ? `Monthly billing for ${month}: ${count} to bill` : `Monthly billing for ${month}: ${count} still to do`);
  const intro =
    t.intro ??
    (start
      ? `${month} is over, so it's time to ask for POs and raise the invoices. ${summaryLine(summary)}.`
      : `These bills for ${month} are still missing a PO or haven't been invoiced yet.`);
  // Settings, Notifications says who: by default the business email, or each admin's when there isn't one.
  for (const to of (await teamRecipients(d.agencyId, "BILLING")).emails) {
    await sendEmail({
      kind: "BILLING",
      agencyId: d.agencyId,
      to,
      subject,
      email: {
        brand: business,
        preheader: subject,
        title: subject,
        intro,
        rows: list.slice(0, 50).map((v) => [v.name, `${m(v)}, ${stepWords(v)}`]),
        cta: { label: "Open monthly billing", url: `${appUrl()}/billing?month=${d.month}` },
        ...(list.length > 50 ? { outro: `And ${list.length - 50} more.` } : {}),
      },
    });
  }
  return true;
}

function stepWords(v: BillView) {
  switch (v.step) {
    case "ASK_PO":
      return "PO not asked for yet";
    case "WAITING_PO":
      return "waiting for the PO";
    case "TO_INVOICE":
      return `PO ${v.bill.poNumber || "in"}, ready to invoice`;
    case "INVOICED":
      return "invoiced, waiting for payment";
    default:
      return v.step.toLowerCase();
  }
}

// ---------------------------------------------------------------------------------------------
// Xero: which invoices sent from here are paid

/**
 * Ask Xero about the unpaid bills sent to it (this month's, or every one from the last year) and mark the paid
 * ones paid, on the day Xero says. Voided or deleted ones keep their Xero status, which the bill shows.
 */
export async function checkXeroPayments(agencyId: string, month?: string): Promise<{ checked: number; paid: number; error?: string }> {
  const conn = await xeroConnectionFor(agencyId);
  if (!conn) return { checked: 0, paid: 0, error: month ? "Xero isn't connected. Connect it in Settings, Xero first." : undefined };
  const bills = await prisma.monthlyBill.findMany({
    where: {
      agencyId,
      xeroInvoiceId: { not: "" },
      paidAt: null,
      ...(month ? { month } : { invoicedAt: { gte: new Date(Date.now() - 400 * 86_400_000) } }),
    },
    select: { id: true, xeroInvoiceId: true, xeroStatus: true },
  });
  if (!bills.length) return { checked: 0, paid: 0 };
  let found: Awaited<ReturnType<typeof getInvoiceStatuses>>;
  try {
    found = await getInvoiceStatuses(
      conn,
      bills.map((b) => b.xeroInvoiceId),
    );
  } catch (e) {
    if (e instanceof XeroError) return { checked: 0, paid: 0, error: e.message };
    throw e;
  }
  let paid = 0;
  for (const b of bills) {
    const s = found.get(b.xeroInvoiceId.toLowerCase());
    if (!s) continue;
    const isPaid = s.state === "paid";
    if (!isPaid && s.status === b.xeroStatus) continue;
    await prisma.monthlyBill.updateMany({
      where: { id: b.id, paidAt: null },
      data: { xeroStatus: s.status, ...(isPaid ? { paidAt: s.fullyPaidOn ? new Date(`${s.fullyPaidOn.slice(0, 10)}T12:00:00Z`) : new Date() } : {}) },
    });
    if (isPaid) paid++;
  }
  return { checked: bills.length, paid };
}

/** Once a day (from 10am, the business's time), for each business with Xero connected. */
export async function runXeroPaymentChecks(now = new Date()) {
  const conns = await prisma.xeroConnection.findMany({
    where: { needsReconnect: false, tenantId: { not: "" }, agency: { status: "ACTIVE" } },
    select: { agencyId: true, agency: { select: { settings: { select: { defaultTimezone: true } } } } },
  });
  let paid = 0;
  for (const c of conns) {
    const tz = c.agency.settings?.defaultTimezone ?? "Europe/London";
    if (localTime(now, tz) < "10:00") continue;
    if (!(await claimReminder("XERO_PAYMENTS", recipientOf(c.agencyId), localDateKey(now, tz)))) continue;
    try {
      paid += (await checkXeroPayments(c.agencyId)).paid;
    } catch (e) {
      log.error("Checking Xero for payments failed", { job: "monthly-billing", agencyId: c.agencyId, err: e });
    }
  }
  return { paid };
}
