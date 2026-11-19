import type { Metadata } from "next";
import Link from "next/link";
import {
  askForPo,
  checkXeroNow,
  markInvoiced,
  markNothingToBill,
  markPaid,
  saveBillNote,
  savePo,
  sendBillToXero,
  undoBillStep,
} from "@/actions/monthly-billing";
import { xeroConnectionFor } from "@/lib/xero";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Empty, PageHeader, Segmented, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { monthLabel, shiftMonth } from "@/lib/billing";
import { actName } from "@/lib/constants";
import { getSettings } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { BILL_STEP_LABELS, BILL_STEPS, readMonth, summarise, summaryLine, type BillStep } from "@/lib/monthly-billing";
import { monthlyBills, poRecipient, type BillView } from "@/lib/monthly-billing-server";
import { formatDate, localDateKey } from "@/lib/time";
import { OpenFromHash } from "./_open-from-hash";

export const metadata: Metadata = { title: "Monthly billing" };

// Each month's bills to venues and the companies that run them: ask for a PO, put the PO in, raise the invoice
// (e.g. in Xero) and mark it invoiced and paid, so nothing is forgotten. Which gigs make up each bill, and the
// rules, are in src/lib/monthly-billing.ts. Staff can look; admins can change things.

const STEP_STYLES: Record<BillStep, string> = {
  ASK_PO: "bg-amber-50 text-amber-900 [--dot:var(--color-amber-500)]",
  WAITING_PO: "bg-sky-50 text-sky-800 [--dot:var(--color-sky-500)]",
  TO_INVOICE: "bg-violet-50 text-violet-800 [--dot:var(--color-violet-500)]",
  INVOICED: "bg-ink-100 text-ink-800 [--dot:var(--color-sky-500)]",
  PAID: "bg-emerald-50 text-emerald-800 [--dot:var(--color-emerald-500)]",
  NOTHING: "bg-ink-100 text-ink-500 [--dot:var(--color-ink-300)]",
};

function StepBadge({ step }: { step: BillStep }) {
  return (
    <span className={`badge ${STEP_STYLES[step]}`} data-testid="bill-step">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--dot)]" />
      {BILL_STEP_LABELS[step]}
    </span>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The warnings on a bill, in words. Shown on the row, so they're seen without opening it. */
function warningsOf(v: BillView, m: (x: number) => string) {
  const w = v.warnings;
  const out: { text: string; tone: "amber" | "rose" }[] = [];
  if (w.totalChanged) out.push({ text: `Changed since invoiced: invoiced ${m(w.totalChanged.invoiced)}, now ${m(w.totalChanged.now)}`, tone: "rose" });
  else if (w.changedGigs.length) out.push({ text: `${plural(w.changedGigs.length, "gig")} edited since invoiced (same total)`, tone: "amber" });
  if (w.cancelledSince.length) out.push({ text: `${plural(w.cancelledSince.length, "gig")} cancelled since invoiced`, tone: "rose" });
  if (w.unconfirmed && v.step !== "PAID") out.push({ text: `${plural(w.unconfirmed, "gig")} not confirmed yet`, tone: "amber" });
  if (w.noGigs) out.push({ text: "No gigs on this bill now. If that's right, mark it Nothing to bill.", tone: "rose" });
  if (w.gigsAfterNothing) out.push({ text: `Marked nothing to bill, but it has ${plural(v.group?.totals.gigs ?? 0, "gig")} now`, tone: "rose" });
  return out;
}

export default async function MonthlyBillingPage({ searchParams }: { searchParams: Promise<{ month?: string; show?: string }> }) {
  const user = await requireStaff();
  const isAdmin = user.role === "ADMIN";
  const sp = await searchParams;
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const thisMonth = localDateKey(new Date(), tz).slice(0, 7);
  const month = readMonth(sp.month) ?? shiftMonth(thisMonth, -1);
  const show = (BILL_STEPS as readonly string[]).includes(sp.show ?? "") ? (sp.show as BillStep) : null;
  const [bills, xero] = await Promise.all([monthlyBills(user.agencyId, month, settings.defaultCurrency), xeroConnectionFor(user.agencyId)]);
  const xeroOn = !!xero && !xero.needsReconnect;
  const summary = summarise(bills.map((b) => b.step));
  const listed = show ? bills.filter((b) => b.step === show) : bills;
  // Who an "Ask for PO" email would go to, for the bills still waiting on one.
  const recipients = new Map(
    isAdmin
      ? await Promise.all(
          listed.filter((b) => b.step === "ASK_PO" || b.step === "WAITING_PO").map(async (b) => [b.id, await poRecipient(user.agencyId, b)] as const),
        )
      : [],
  );
  const href = (extra: { month?: string; show?: string | null }) => {
    const step = extra.show === undefined ? show : extra.show;
    return `/billing?${new URLSearchParams({ month: extra.month ?? month, ...(step ? { show: step } : {}) })}`;
  };
  const count = (s: BillStep) => bills.filter((b) => b.step === s).length;

  return (
    <div>
      <OpenFromHash />
      <PageHeader
        title="Monthly billing"
        subtitle="Each month's bills to your venues and the companies that run them. Ask for a PO, put it in when it arrives, raise the invoice and mark it paid, so nothing gets forgotten."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href={href({ month: shiftMonth(month, -1) })} className="btn btn-sm" aria-label="Month before">
          ‹
        </Link>
        <h2 className="min-w-36 text-center text-lg font-semibold tracking-tight" data-testid="billing-month">
          {monthLabel(month)}
        </h2>
        <Link href={href({ month: shiftMonth(month, 1) })} className="btn btn-sm" aria-label="Month after">
          ›
        </Link>
        <form action="/billing" className="flex items-center gap-2">
          <input type="month" name="month" defaultValue={month} aria-label="Month" className="input h-9 w-auto py-1" />
          <button className="btn btn-sm">Show</button>
        </form>
        {month !== shiftMonth(thisMonth, -1) && (
          <Link href={href({ month: shiftMonth(thisMonth, -1), show: null })} className="link text-sm">
            Last month
          </Link>
        )}
      </div>

      {isAdmin && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-600">
          {xeroOn ? (
            <>
              <span>Xero is connected: send each bill there as a draft invoice. Payments are checked every morning.</span>
              <ActionForm action={checkXeroNow.bind(null, month)}>
                <SubmitButton className="btn btn-sm" pendingText="Checking…">
                  Check Xero for payments now
                </SubmitButton>
              </ActionForm>
            </>
          ) : xero?.needsReconnect ? (
            <span>
              Xero needs connecting again.{" "}
              <Link href="/settings/xero" className="link">
                Settings, Xero
              </Link>
            </span>
          ) : (
            <span>
              Raise invoices in Xero from here:{" "}
              <Link href="/settings/xero" className="link">
                connect Xero
              </Link>
              .
            </span>
          )}
        </div>
      )}

      <p className="mb-4 rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm font-medium text-ink-800" data-testid="billing-summary">
        {summaryLine(summary)}
        {summary.paid ? <span className="font-normal text-ink-500"> · {summary.paid} paid</span> : null}
      </p>

      {bills.length > 0 && (
        <div className="mb-5">
          <Segmented
            label="Which bills"
            items={[
              { href: href({ show: null }), label: `All (${bills.length})`, on: !show },
              ...BILL_STEPS.filter((s) => count(s)).map((s) => ({ href: href({ show: s }), label: `${BILL_STEP_LABELS[s]} (${count(s)})`, on: show === s })),
            ]}
          />
        </div>
      )}

      {listed.length === 0 ? (
        <Empty>{bills.length ? "No bills at this step." : `No gigs to bill at venues in ${monthLabel(month)}.`}</Empty>
      ) : (
        <ul className="space-y-3">
          {listed.map((v) => (
            <li key={v.id}>
              <BillCard v={v} isAdmin={isAdmin} tz={tz} recipient={recipients.get(v.id)?.email ?? ""} xeroOn={xeroOn} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BillCard({ v, isAdmin, tz, recipient, xeroOn }: { v: BillView; isAdmin: boolean; tz: string; recipient: string; xeroOn: boolean }) {
  const m = (x: number) => formatMoney(x, v.currency);
  const g = v.group;
  const b = v.bill;
  const warnings = warningsOf(v, m);
  const changed = new Set(v.warnings.changedGigs.map((x) => x.id));
  const day = (d: Date) => formatDate(d, tz);
  return (
    <details id={`bill-${v.id}`} data-bill={v.id} className="card group overflow-hidden" aria-label={v.name}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 p-4 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex items-center gap-2 font-semibold text-ink-950">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0 text-ink-400 transition group-open:rotate-90"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="truncate" data-testid="bill-name">
              {v.name}
            </span>
          </div>
          <div className="mt-0.5 pl-6 text-sm text-ink-500">
            {g ? plural(g.totals.gigs, "gig") : "No gigs"}
            {b.poNumber && <> · PO {b.poNumber}</>}
            {b.invoiceNumber && <> · Invoice {b.invoiceNumber}</>}
          </div>
        </div>
        <div className="text-right text-lg font-semibold tabular-nums">{m(g?.totals.total ?? 0)}</div>
        <StepBadge step={v.step} />
        {warnings.length > 0 && (
          <ul className="w-full space-y-1 pl-6">
            {warnings.map((w) => (
              <li
                key={w.text}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${w.tone === "rose" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-900"}`}
                data-testid="bill-warning"
              >
                {w.text}
              </li>
            ))}
          </ul>
        )}
      </summary>

      <div className="space-y-5 border-t border-ink-100 p-4">
        {/* The gigs on the bill. A list on a phone, a table on a computer. */}
        {g && g.lines.length > 0 && (
          <ul className="divide-y divide-ink-100 text-sm sm:hidden">
            {g.lines.map((l) => (
              <li key={l.gig.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <Link href={`/bookings/${l.gig.id}`} className="link">
                    {formatDate(l.gig.arriveBy, l.gig.timezone)}
                  </Link>
                  <div className="text-ink-600">
                    {l.gig.venue.name}: {actName(l.gig)}
                  </div>
                  {changed.has(l.gig.id) && <div className="text-xs font-medium text-amber-700">Changed since invoiced</div>}
                </div>
                <div className="shrink-0 text-right">
                  <div className="tabular-nums">{m(l.total)}</div>
                  <StatusBadge status={l.gig.status} />
                </div>
              </li>
            ))}
            {v.warnings.cancelledSince.map((gig) => (
              <li key={gig.id} className="py-2 text-ink-500">
                <Link href={`/bookings/${gig.id}`} className="link">
                  {formatDate(gig.arriveBy, gig.timezone)}
                </Link>{" "}
                {gig.venue.name}: {actName(gig)}, cancelled since invoiced
              </li>
            ))}
            <li className="flex justify-between py-2 font-semibold">
              <span>Total{g.totals.vat > 0 && <span className="ml-1 text-xs font-normal text-ink-500">incl. VAT {m(g.totals.vat)}</span>}</span>
              <span className="tabular-nums">{m(g.totals.total)}</span>
            </li>
          </ul>
        )}
        {g && g.lines.length > 0 && (
          <div className="hidden overflow-x-auto sm:block">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Venue</th>
                  <th>Act</th>
                  <th>Status</th>
                  <th className="text-right">Ex VAT</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l) => (
                  <tr key={l.gig.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/bookings/${l.gig.id}`} className="link">
                        {formatDate(l.gig.arriveBy, l.gig.timezone)}
                      </Link>
                      <div className="text-xs text-ink-500">{l.gig.reference}</div>
                    </td>
                    <td>{l.gig.venue.name}</td>
                    <td>
                      {actName(l.gig)}
                      {changed.has(l.gig.id) && <div className="text-xs font-medium text-amber-700">Changed since invoiced</div>}
                    </td>
                    <td>
                      <StatusBadge status={l.gig.status} />
                    </td>
                    <td className="text-right tabular-nums">{m(l.exVat)}</td>
                    <td className="text-right tabular-nums">{m(l.total)}</td>
                  </tr>
                ))}
                {v.warnings.cancelledSince.map((gig) => (
                  <tr key={gig.id} className="text-ink-500">
                    <td className="whitespace-nowrap">
                      <Link href={`/bookings/${gig.id}`} className="link">
                        {formatDate(gig.arriveBy, gig.timezone)}
                      </Link>
                    </td>
                    <td>{gig.venue.name}</td>
                    <td>{actName(gig)}</td>
                    <td>
                      <StatusBadge status={gig.status} />
                    </td>
                    <td colSpan={2} className="text-right text-xs">
                      Cancelled since invoiced
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td colSpan={4}>
                    Total
                    {g.totals.vat > 0 && <span className="ml-2 text-xs font-normal text-ink-500">incl. VAT {m(g.totals.vat)}</span>}
                  </td>
                  <td className="text-right tabular-nums">{m(g.totals.exVat)}</td>
                  <td className="text-right tabular-nums">{m(g.totals.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {g?.payer && (
            <Link href={`/contacts/${g.payer.id}`} className="link">
              {g.payer.company || g.payer.name}
            </Link>
          )}
          {g?.venues.map((x) => (
            <Link key={x.id} href={`/venues/${x.id}`} className="link">
              {x.name}
            </Link>
          ))}
          <a href={`/print/bills/${v.id}`} target="_blank" className="btn btn-sm ml-auto">
            Print statement
          </a>
        </div>

        {isAdmin ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* PO */}
            <section className="rounded-xl border border-ink-200 p-4" aria-label="Purchase order">
              <h3 className="mb-2 text-sm font-semibold">Purchase order</h3>
              {b.poNumber ? (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span>
                    PO <strong data-testid="bill-po">{b.poNumber}</strong>
                    {b.poReceivedAt && <span className="text-ink-500">, received {day(b.poReceivedAt)}</span>}
                  </span>
                  <ActionForm action={undoBillStep.bind(null, v.id, "PO")}>
                    <SubmitButton className="btn btn-sm" pendingText="Undoing…">
                      Undo PO
                    </SubmitButton>
                  </ActionForm>
                </div>
              ) : (
                <div className="space-y-3">
                  {b.poRequestedAt ? (
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="text-ink-600">Asked for on {day(b.poRequestedAt)}.</span>
                      <ActionForm action={undoBillStep.bind(null, v.id, "PO_REQUEST")}>
                        <SubmitButton className="btn btn-sm" pendingText="Undoing…">
                          Undo
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  ) : null}
                  {g && g.lines.length > 0 && (
                    <ActionForm action={askForPo.bind(null, v.id)} className="space-y-2">
                      <label className="block">
                        <span className="label">{b.poRequestedAt ? "Ask again: email to" : "Email to"}</span>
                        <input
                          name="to"
                          type="email"
                          defaultValue={recipient}
                          placeholder="accounts@company.co.uk"
                          className="input"
                          aria-label="Email the PO request to"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <SubmitButton name="mode" value="send" className="btn btn-sm btn-primary" pendingText="Sending…">
                          {b.poRequestedAt ? "Ask again" : "Ask for PO"}
                        </SubmitButton>
                        {!b.poRequestedAt && (
                          <SubmitButton name="mode" value="mark" className="btn btn-sm" pendingText="Saving…">
                            Mark as asked
                          </SubmitButton>
                        )}
                      </div>
                    </ActionForm>
                  )}
                  <ActionForm action={savePo.bind(null, v.id)}>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="min-w-0 flex-1 basis-40">
                        <span className="label">PO number</span>
                        <input name="poNumber" required className="input" aria-label="PO number" />
                      </label>
                      <SubmitButton className="btn" pendingText="Saving…">
                        Save PO
                      </SubmitButton>
                    </div>
                  </ActionForm>
                </div>
              )}
            </section>

            {/* Invoice and payment */}
            <section className="rounded-xl border border-ink-200 p-4" aria-label="Invoice">
              <h3 className="mb-2 text-sm font-semibold">Invoice</h3>
              {b.invoicedAt ? (
                <div className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>
                      Invoice <strong data-testid="bill-invoice">{b.invoiceNumber}</strong>
                      <span className="text-ink-500">
                        , {day(b.invoicedAt)}
                        {b.invoicedTotalMinor !== null ? `, ${m(b.invoicedTotalMinor)}` : ""}
                      </span>
                    </span>
                    {b.xeroUrl && (
                      <a href={b.xeroUrl} target="_blank" rel="noreferrer" className="btn btn-sm">
                        Open in Xero
                      </a>
                    )}
                    <ActionForm action={undoBillStep.bind(null, v.id, "INVOICED")}>
                      <SubmitButton className="btn btn-sm" pendingText="Undoing…">
                        Undo invoice
                      </SubmitButton>
                    </ActionForm>
                  </div>
                  {b.xeroStatus && !b.paidAt && (
                    <p className={`text-xs ${b.xeroStatus === "VOIDED" || b.xeroStatus === "DELETED" ? "font-medium text-rose-700" : "text-ink-500"}`}>
                      In Xero:{" "}
                      {b.xeroStatus === "DRAFT"
                        ? "a draft, waiting for you to approve it there"
                        : b.xeroStatus === "SUBMITTED"
                          ? "awaiting approval"
                          : b.xeroStatus === "AUTHORISED"
                            ? "approved, awaiting payment"
                            : b.xeroStatus === "VOIDED" || b.xeroStatus === "DELETED"
                              ? `${b.xeroStatus.toLowerCase()}. Undo the invoice here and send it again if it still needs billing.`
                              : b.xeroStatus.toLowerCase()}
                    </p>
                  )}
                  {v.warnings.totalChanged && g && g.lines.length > 0 && xeroOn && (
                    <ActionForm action={sendBillToXero.bind(null, v.id)}>
                      <p className="mb-2 text-xs text-ink-500">
                        Send the bill as it is now: Xero gets a new draft, and the old invoice stays there for you to void or credit.
                      </p>
                      <SubmitButton className="btn btn-sm" pendingText="Sending…">
                        Send the new total to Xero
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {v.warnings.totalChanged && g && g.lines.length > 0 && (
                    <ActionForm action={markInvoiced.bind(null, v.id)}>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="min-w-0 flex-1 basis-40">
                          <span className="label">Raised a new invoice? Its number</span>
                          <input name="invoiceNumber" required defaultValue={b.invoiceNumber} className="input" />
                        </label>
                        <SubmitButton className="btn" pendingText="Saving…">
                          Save new invoice
                        </SubmitButton>
                      </div>
                    </ActionForm>
                  )}
                  {b.paidAt ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-medium text-emerald-700">Paid {day(b.paidAt)}</span>
                      <ActionForm action={undoBillStep.bind(null, v.id, "PAID")}>
                        <SubmitButton className="btn btn-sm" pendingText="Undoing…">
                          Undo paid
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  ) : (
                    <ActionForm action={markPaid.bind(null, v.id)}>
                      <SubmitButton className="btn btn-sm btn-primary" pendingText="Saving…">
                        Mark paid
                      </SubmitButton>
                    </ActionForm>
                  )}
                </div>
              ) : g && g.lines.length > 0 ? (
                <div className="space-y-3">
                  {xeroOn && (
                    <ActionForm action={sendBillToXero.bind(null, v.id)} className="space-y-2">
                      <p className="text-sm text-ink-500">
                        Makes a draft invoice in Xero for {m(g.totals.total)}, one line per gig{b.poNumber ? `, with PO ${b.poNumber} as the reference` : ""}.
                      </p>
                      <SubmitButton className={`btn ${v.step === "TO_INVOICE" ? "btn-primary" : ""}`} pendingText="Sending to Xero…">
                        Send to Xero
                      </SubmitButton>
                    </ActionForm>
                  )}
                  <ActionForm action={markInvoiced.bind(null, v.id)} className="space-y-2">
                    <p className="text-sm text-ink-500">
                      {xeroOn
                        ? "Or raise it yourself and put its number here."
                        : `Raise the invoice for ${m(g.totals.total)}${b.poNumber ? ` with PO ${b.poNumber}` : ""}, then put its number here.`}
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="min-w-0 flex-1 basis-40">
                        <span className="label">Invoice number</span>
                        <input name="invoiceNumber" required className="input" aria-label="Invoice number" />
                      </label>
                      <SubmitButton className={`btn ${v.step === "TO_INVOICE" && !xeroOn ? "btn-primary" : ""}`} pendingText="Saving…">
                        Mark invoiced
                      </SubmitButton>
                    </div>
                  </ActionForm>
                </div>
              ) : (
                <p className="text-sm text-ink-500">Nothing to invoice.</p>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-ink-200 p-4 lg:col-span-2" aria-label="Note">
              <ActionForm action={saveBillNote.bind(null, v.id)} className="space-y-2">
                <label className="block">
                  <span className="label">Note</span>
                  <textarea name="note" rows={2} defaultValue={b.note} className="input" placeholder="e.g. PO promised by Friday, invoice to accounts@" />
                </label>
                <SubmitButton className="btn btn-sm" pendingText="Saving…">
                  Save note
                </SubmitButton>
              </ActionForm>
              <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-3 text-sm">
                {b.nothingToBill ? (
                  <ActionForm action={undoBillStep.bind(null, v.id, "NOTHING")}>
                    <SubmitButton className="btn btn-sm" pendingText="Undoing…">
                      Undo nothing to bill
                    </SubmitButton>
                  </ActionForm>
                ) : (
                  !b.invoicedAt && (
                    <ActionForm action={markNothingToBill.bind(null, v.id)}>
                      <SubmitButton className="btn btn-sm" pendingText="Saving…">
                        Nothing to bill
                      </SubmitButton>
                    </ActionForm>
                  )
                )}
                <span className="text-ink-500">
                  {b.nothingToBill
                    ? "Marked nothing to bill for this month."
                    : "Nothing to bill this month after all? Mark it, and it's left out of the counts."}
                </span>
              </div>
            </section>
          </div>
        ) : (
          <div className="space-y-1 text-sm text-ink-600">
            {b.poRequestedAt && <p>PO asked for on {day(b.poRequestedAt)}.</p>}
            {b.poNumber && <p>PO {b.poNumber}.</p>}
            {b.invoicedAt && (
              <p>
                Invoiced {day(b.invoicedAt)}: {b.invoiceNumber}.
              </p>
            )}
            {b.paidAt && <p>Paid {day(b.paidAt)}.</p>}
            {b.note && <p className="whitespace-pre-line">{b.note}</p>}
            <p className="text-ink-500">Only admins can change bills.</p>
          </div>
        )}
      </div>
    </details>
  );
}
