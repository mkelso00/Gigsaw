import "server-only";
import type { Prisma } from "@prisma/client";
import { log } from "@/server/log";
import { gigsWithoutInvoice } from "./act-invoices";
import { bankFile, readBankFile, templateOf } from "./bank-file";
import { toCsv } from "./csv";
import { prisma } from "./db";
import { messageFor } from "./message-templates";
import { appUrl, sendEmail } from "./messaging";
import { formatMoney } from "./money";
import {
  RECORDS_HEADER,
  changesSinceSent,
  bankPayments,
  groupByPayee,
  lastWeekStart,
  readSends,
  recordsRows,
  runProgress,
  weekLabel,
  weekShort,
  weekWindow,
  type RunPayee,
  type SendRecord,
} from "./pay-run";
import { invoicesPdf } from "./pay-run-pdf";
import { personName } from "./person-name";
import { claimedReminders, claimReminder } from "./reminders";
import { localDateKey, localTime } from "./time";

// The database side of the weekly pay run (src/lib/pay-run.ts has the rules): the week's invoices with what may
// need checking, sending them to the business for its records (one email with a summary, the CSV and every
// invoice in one PDF), and the Monday morning "ready to check" email.

const invoiceInclude = {
  artist: { select: { colour: true } },
  booking: {
    select: {
      id: true,
      status: true,
      reference: true,
      setStart: true,
      timezone: true,
      payments: { select: { direction: true, amountMinor: true } },
      lineup: { select: { change: true, person: { select: { firstName: true, surname: true, alias: true } } } },
    },
  },
} satisfies Prisma.ActInvoiceInclude;

export type PayRunInvoice = Prisma.ActInvoiceGetPayload<{ include: typeof invoiceInclude }> & {
  payments: { direction: string; amountMinor: number }[];
};

/** Line-up changes on a gig, in words: "Sam Jones standing in, Jo Drummond off". */
export function lineupWords(lineup: { change: string; person: { firstName: string; surname: string; alias: string } }[]) {
  const ins = lineup.filter((l) => l.change === "IN").map((l) => personName(l.person));
  const outs = lineup.filter((l) => l.change === "OUT").map((l) => personName(l.person));
  return [...ins.map((n) => `${n} standing in`), ...outs.map((n) => `${n} off`)].join(", ");
}

/** Each unpaid payee's email (the person's, or the act's), by payee key, for a bank file's email column. */
async function payeeEmails(agencyId: string, payees: RunPayee[]) {
  const open = payees.filter((p) => p.owedMinor > 0);
  const personIds = open.flatMap((p) => (p.personId ? [p.personId] : []));
  const actIds = open.flatMap((p) => (!p.personId && p.artistId ? [p.artistId] : []));
  const [people, acts] = await Promise.all([
    personIds.length ? prisma.person.findMany({ where: { agencyId, id: { in: personIds } }, select: { id: true, email: true } }) : [],
    actIds.length ? prisma.artist.findMany({ where: { agencyId, id: { in: actIds } }, select: { id: true, email: true } }) : [],
  ]);
  const byPerson = new Map(people.map((p) => [p.id, p.email]));
  const byAct = new Map(acts.map((a) => [a.id, a.email]));
  return new Map(open.map((p) => [p.key, (p.personId ? byPerson.get(p.personId) : p.artistId ? byAct.get(p.artistId) : "") ?? ""]));
}

/**
 * Everything the pay run page shows for one week: the invoices grouped by payee, how far paying has got, what was
 * sent for the records and what's changed since, the voided ones, and the gigs with no invoice yet.
 */
export async function payRunWeek(
  agencyId: string,
  weekStart: string,
  opts: { timeZone: string; business: string; now?: Date; /** Settings.bankFile: the layout of the payment list. */ bankFile?: unknown },
) {
  const now = opts.now ?? new Date();
  const range = weekWindow(weekStart, opts.timeZone);
  const [rows, voided, run, gaps] = await Promise.all([
    prisma.actInvoice.findMany({
      where: { agencyId, status: { in: ["ISSUED", "PAID"] }, gigDate: range },
      include: invoiceInclude,
      orderBy: { seq: "asc" },
    }),
    prisma.actInvoice.findMany({
      where: { agencyId, status: "VOID", gigDate: range },
      select: { id: true, number: true, note: true, voidedAt: true, actName: true, payeeName: true },
      orderBy: { seq: "asc" },
    }),
    prisma.payRun.findUnique({ where: { agencyId_weekStart: { agencyId, weekStart } } }),
    gigsWithoutInvoice(agencyId, range, now),
  ]);
  const invoices: PayRunInvoice[] = rows.map((r) => ({ ...r, payments: r.booking?.payments ?? [] }));
  const payees = groupByPayee(invoices, opts.business);
  const bank = bankFile(templateOf(readBankFile(opts.bankFile)), bankPayments(payees, await payeeEmails(agencyId, payees)), localDateKey(now, opts.timeZone));
  const sent = run?.sentAt ? { sentInvoiceIds: run.sentInvoiceIds, sentNumbers: run.sentNumbers } : null;
  const changes = changesSinceSent(sent, invoices);
  const voidReason = new Map(voided.map((v) => [v.id, v.note]));
  const added = new Set(changes.added.map((a) => a.id));
  // What may need a look on each invoice, shown under it in Check.
  const notes = new Map<string, string[]>();
  for (const inv of invoices) {
    const n: string[] = [];
    if (changes.sent && added.has(inv.id)) n.push(inv.note.startsWith("Replaces") ? "Reissued since sent" : "New since sent");
    if (inv.note) n.push(inv.note);
    const lineup = inv.booking ? lineupWords(inv.booking.lineup) : "";
    if (lineup) n.push(`Line-up changed (${lineup}): may need checking`);
    if (inv.booking && inv.booking.status !== "CONFIRMED" && inv.booking.status !== "SETTLED")
      n.push(inv.booking.status === "CANCELLED" ? "The gig was cancelled after this was paid" : "The gig isn't confirmed now");
    if (!inv.bookingId) n.push("The booking has been deleted");
    if (n.length) notes.set(inv.id, n);
  }
  const lineupChanged = invoices.filter((i) => i.booking?.lineup.length).length;
  return {
    weekStart,
    range,
    invoices,
    payees,
    progress: runProgress(payees),
    run,
    sends: readSends(run?.sends),
    changes: { ...changes, removed: changes.removed.map((r) => ({ ...r, reason: voidReason.get(r.id) ?? "" })) },
    voided,
    gaps,
    notes,
    lineupChanged,
    bank,
  };
}

export type PayRunView = Awaited<ReturnType<typeof payRunWeek>>;

/** Where the records go: the accounts email, else the business email, else whoever pressed Send. */
export function recordsRecipient(s: { accountsEmail: string; agencyEmail: string }, fallback: string) {
  return s.accountsEmail.trim() || s.agencyEmail.trim() || fallback;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Email the business the week's invoices for its records: a summary (payee, gigs, total), the invoices as a CSV
 * and every invoice in one PDF. `changes` sends only the invoices made or reissued since the last send, and lists
 * the voided ones. Records the send on the week's PayRun. Throws a message for the page when there's nothing to send.
 */
export async function sendPayRunRecords(
  agencyId: string,
  weekStart: string,
  by: { id: string; name: string; email: string },
  mode: "ALL" | "CHANGES",
  now = new Date(),
): Promise<{ status: string; to: string; count: number; voided: number }> {
  const settings = await prisma.settings.findUniqueOrThrow({ where: { agencyId } });
  const business = settings.agencyName;
  const tz = settings.defaultTimezone;
  const v = await payRunWeek(agencyId, weekStart, { timeZone: tz, business, now });
  const changes = mode === "CHANGES" && v.changes.sent;
  const send = changes ? v.invoices.filter((i) => v.changes.added.some((a) => a.id === i.id)) : v.invoices;
  const voided = changes ? v.changes.removed : [];
  if (!send.length && !voided.length) throw new PayRunError(changes ? "Nothing has changed since it was sent." : "There are no invoices for this week.");
  const to = recordsRecipient(settings, by.email);
  const currency = send[0]?.currency ?? v.invoices[0]?.currency ?? settings.defaultCurrency;
  const m = (x: number) => formatMoney(x, currency);
  const week = weekLabel(weekStart);
  const sendTotal = send.reduce((t, i) => t + i.totalMinor, 0);

  // The summary: one row per payee in what's sent.
  const payees = groupByPayee(send, business);
  const rows: [string, string][] = payees.map((p) => [
    p.name,
    `${plural(p.invoices.length, "gig")}, ${m(p.totalMinor)}${p.acts.length > 1 || p.acts[0] !== p.name ? ` (${p.acts.join(", ")})` : ""}\n${p.invoices.map((i) => i.number).join(", ")}`,
  ]);
  if (send.length) rows.push(["Total", `${plural(send.length, "invoice")}, ${m(sendTotal)}`]);
  for (const r of voided) rows.push([`${r.number} voided`, r.reason || "Voided since it was sent"]);

  const slug = `w-c-${weekStart}`;
  const attachments = send.length
    ? [
        {
          filename: `act-invoices-${slug}${changes ? "-changes" : ""}.csv`,
          content: "﻿" + toCsv(RECORDS_HEADER, recordsRows(send, tz)),
          contentType: "text/csv",
        },
        {
          filename: `act-invoices-${slug}${changes ? "-changes" : ""}.pdf`,
          content: Buffer.from(await invoicesPdf(send, { agencyName: business, agencyAddress: settings.agencyAddress, defaultTimezone: tz })),
          contentType: "application/pdf",
        },
      ]
    : [];
  const title = changes ? `Changes to the act invoices for ${weekShort(weekStart)}` : `Act invoices for ${weekShort(weekStart)}`;
  const intro = changes
    ? `Changes to the self-billing invoices for the gigs from ${week}, since they were sent for your records: ${[
        send.length ? `${plural(send.length, "new or reissued invoice")} (${m(sendTotal)}), attached` : "",
        voided.length ? `${plural(voided.length, "invoice")} voided` : "",
      ]
        .filter(Boolean)
        .join(", and ")}.`
    : `Here are the ${plural(send.length, "self-billing invoice")} for the gigs from ${week}, for your records: ${m(sendTotal)} to ${plural(payees.length, "payee")}. Every invoice is attached in one PDF, with a spreadsheet (CSV) of them.`;
  const status = await sendEmail({
    kind: "PAY_RUN",
    agencyId,
    to,
    replyTo: settings.agencyEmail,
    subject: title,
    email: {
      brand: business,
      preheader: `${plural(send.length, "invoice")}, ${m(sendTotal)}`,
      title,
      intro,
      rowsTitle: changes ? "What's changed" : "Who's paid",
      rows,
      cta: { label: "Open the pay run", url: `${appUrl()}/payments/run?week=${weekStart}` },
      outro: "For your records only: nobody has been paid by this email. Mark each payee paid in Gigsaw once the bank transfer has gone.",
    },
    attachments,
  });
  if (status === "SKIPPED") throw new PayRunError(`${to} isn't an email address. Set the accounts email in Settings, General.`);
  if (status === "FAILED") throw new PayRunError("The email couldn't be sent. Try again in a minute.");

  const record: SendRecord = {
    at: now.toISOString(),
    byName: by.name,
    to,
    kind: changes ? "CHANGES" : "ALL",
    numbers: send.map((i) => i.number),
    voided: voided.map((r) => r.number),
    totalMinor: sendTotal,
  };
  const state = {
    sentInvoiceIds: v.invoices.map((i) => i.id),
    sentNumbers: v.invoices.map((i) => i.number),
    sentTotalMinor: v.progress.totalMinor,
  };
  // One row per week: the first send makes it, the next ones add to it.
  const existing = await prisma.payRun.findUnique({ where: { agencyId_weekStart: { agencyId, weekStart } } });
  if (!existing) {
    await prisma.payRun
      .create({ data: { agencyId, weekStart, sentAt: now, sentById: by.id, sentByName: by.name, ...state, sends: [record] } })
      .catch(async () => {
        // Sent from two places at once: the other one made the row, so add to it.
        await addSend(agencyId, weekStart, state, record);
      });
  } else await addSend(agencyId, weekStart, state, record, existing.sentAt ? undefined : { sentAt: now, sentById: by.id, sentByName: by.name });
  return { status, to, count: send.length, voided: voided.length };
}

async function addSend(
  agencyId: string,
  weekStart: string,
  state: { sentInvoiceIds: string[]; sentNumbers: string[]; sentTotalMinor: number },
  record: SendRecord,
  first?: { sentAt: Date; sentById: string; sentByName: string },
) {
  await prisma.$transaction(async (tx) => {
    const row = await tx.payRun.findUniqueOrThrow({ where: { agencyId_weekStart: { agencyId, weekStart } } });
    await tx.payRun.update({ where: { id: row.id }, data: { ...state, ...(first ?? {}), sends: [...readSends(row.sends), record] } });
  });
}

/** A refusal to show on the page, e.g. nothing to send. */
export class PayRunError extends Error {}

// ---------------------------------------------------------------------------------------------------------
// Monday morning: last week's pay run is ready to check
// ---------------------------------------------------------------------------------------------------------

export const READY_KIND = "PAY_RUN_READY";
const recipientOf = (agencyId: string) => `agency:${agencyId}`;

/** The accounts email, or each admin's when there isn't one. */
async function readyEmails(agencyId: string, accountsEmail: string) {
  if (accountsEmail.trim()) return [accountsEmail.trim()];
  const admins = await prisma.user.findMany({ where: { agencyId, role: "ADMIN", demo: false }, select: { email: true } });
  return admins.map((a) => a.email);
}

/** Due on a weekday (Monday, or the first weekday after if Monday was missed), 9am to 5pm, the business's time. */
export function readyEmailDue(local: { weekday: number; time: string }) {
  return local.weekday >= 1 && local.weekday <= 5 && local.time >= "09:00" && local.time < "17:00";
}

/**
 * The scheduler's job: once a week for each business with act invoices last week, "Last week's pay run is ready
 * to check: 98 invoices, £12,800", with a link, to the accounts email or each admin. Claimed once per business and
 * week in the Reminder table. Nothing is sent for the records by itself: someone checks and presses Send.
 */
export async function runPayRunReminders(now = new Date()) {
  const agencies = await prisma.agency.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      settings: { select: { defaultTimezone: true, agencyName: true, accountsEmail: true, defaultCurrency: true, messageTemplates: true } },
    },
  });
  const due: { agencyId: string; name: string; week: string; s: NonNullable<(typeof agencies)[number]["settings"]> }[] = [];
  for (const a of agencies) {
    if (!a.settings) continue;
    const tz = a.settings.defaultTimezone;
    const weekday = ((new Date(`${localDateKey(now, tz)}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    if (!readyEmailDue({ weekday, time: localTime(now, tz) })) continue;
    due.push({ agencyId: a.id, name: a.name, week: lastWeekStart(now, tz), s: a.settings });
  }
  if (!due.length) return { sent: 0 };
  // Runs every minute: skip the ones already sent without looking at their invoices again.
  const claimed = await claimedReminders(
    [READY_KIND],
    due.map((d) => recipientOf(d.agencyId)),
    due.map((d) => d.week),
  );
  let sent = 0;
  for (const d of due) {
    if (claimed.has(`${READY_KIND}|${recipientOf(d.agencyId)}|${d.week}`)) continue;
    try {
      const range = weekWindow(d.week, d.s.defaultTimezone);
      const agg = await prisma.actInvoice.aggregate({
        where: { agencyId: d.agencyId, status: { in: ["ISSUED", "PAID"] }, gigDate: range },
        _count: true,
        _sum: { totalMinor: true },
      });
      // Nothing last week (yet): looked at again next minute, so a late invoice still gets its email this week.
      if (!agg._count) continue;
      if (!(await claimReminder(READY_KIND, recipientOf(d.agencyId), d.week))) continue;
      const t = messageFor(d.s.messageTemplates, READY_KIND, {
        week: weekLabel(d.week),
        count: String(agg._count),
        total: formatMoney(agg._sum.totalMinor ?? 0, d.s.defaultCurrency),
        business: d.s.agencyName || d.name,
      });
      if (!t.on) continue;
      const total = formatMoney(agg._sum.totalMinor ?? 0, d.s.defaultCurrency);
      const subject = t.subject ?? `Last week's pay run is ready to check: ${plural(agg._count, "invoice")}, ${total}`;
      for (const to of await readyEmails(d.agencyId, d.s.accountsEmail)) {
        await sendEmail({
          kind: "PAY_RUN",
          agencyId: d.agencyId,
          to,
          subject,
          email: {
            brand: d.s.agencyName || d.name,
            preheader: subject,
            title: subject,
            intro:
              t.intro ??
              `The act invoices for the gigs from ${weekLabel(d.week)} are ready. Check them (in case anyone swapped or changed over the weekend), send them for your records, then pay everyone and mark them paid.`,
            cta: { label: "Open the pay run", url: `${appUrl()}/payments/run?week=${d.week}` },
          },
        });
      }
      sent++;
    } catch (e) {
      log.error("Pay run reminder failed", { job: "pay-run", agencyId: d.agencyId, err: e });
    }
  }
  return { sent };
}
