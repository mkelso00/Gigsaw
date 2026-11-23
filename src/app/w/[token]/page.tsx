import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { submitPlanner } from "@/actions/events";
import { ActionForm, SubmitButton } from "@/components/forms";
import { prisma } from "@/lib/db";
import { balanceDueDate, parseExtraFields, planFieldsFor } from "@/lib/event-plan";
import { cashAddressLine } from "@/lib/proposal-pay";
import { cardPaymentsReady } from "@/lib/card-payments";
import { eventTotals } from "@/lib/events";
import { formatMoney } from "@/lib/money";
import { directSplit, directTotals, isDirectPlan } from "@/lib/pay-plan";
import { loadPayActs, payeeFor } from "@/lib/payee-server";
import { formatDate, localTime } from "@/lib/time";
import { actName } from "@/lib/constants";

// The customer's planner: a private link (no login) where a couple tells the agency the running
// order, contacts, parking and song requests. Shows which acts are booked and when, and what the
// customer has paid and has left to pay for the whole booking. Never what any act is paid.

export const metadata: Metadata = { title: "Your details", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PlannerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) notFound();
  const e = await prisma.event.findUnique({
    where: { plannerToken: token },
    include: {
      agency: { include: { settings: true } },
      venue: { select: { name: true, city: true } },
      bookings: {
        where: { archivedAt: null, status: { notIn: ["CANCELLED", "ENQUIRY"] } },
        include: { artist: { select: { name: true } }, payments: { select: { direction: true, kind: true, amountMinor: true, note: true } } },
        orderBy: { setStart: "asc" },
      },
      payLinks: { select: { token: true, kind: true } },
    },
  });
  if (!e || e.status !== "ACTIVE" || e.agency.status !== "ACTIVE") notFound();
  const brand = e.agency.settings?.agencyName || e.agency.name;
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${e.date}T12:00:00Z`),
  );
  const wedding = e.type === "WEDDING";

  // The whole booking's money, as one: the total, what's in and what's left (never an act's own fee).
  const money = e.bookings.length ? eventTotals(e.bookings) : null;
  const m = (x: number) => formatMoney(x, money?.currency ?? "GBP");
  const depositDue = e.bookings.reduce((t, b) => t + b.depositMinor, 0);
  const depositLeft = Math.max(0, depositDue - (money?.deposits ?? 0));
  const dueDates = e.bookings.map((b) => b.depositDueDate).filter((d): d is Date => !!d);
  const depositBy = dueDates.length ? formatDate(new Date(Math.min(...dueDates.map((d) => d.getTime()))), e.timezone) : "";
  // Card payment: the deposit link while the deposit is owed, then the balance link, when they've been made and cards are on.
  const ready = await cardPaymentsReady(e.agency);
  const link = (kind: string) => e.payLinks.find((l) => l.kind === kind);
  // A balance paid in cash (BALANCE_CASH) isn't paid by card: only the deposit is.
  const cash = e.payPlan === "BALANCE_CASH";
  const payLink = !ready
    ? null
    : cash
      ? (depositLeft > 0 && link("DEPOSIT")) || null
      : (depositLeft > 0 && link("DEPOSIT")) || link("BALANCE") || link("DEPOSIT") || null;
  const cashAddress = cashAddressLine(e.agency.settings?.cashAddress);
  const balanceBy = formatDate(new Date(`${balanceDueDate(e.date)}T12:00:00Z`), "UTC");

  // Paying the acts direct (Event.payPlan): the deposit to us, each act's fee straight to them. Bank details
  // are the ones the act (or its lead) gave for their pay, shown only here and only for a bank transfer.
  const direct = isDirectPlan(e.payPlan);
  const split = direct ? directTotals(e.bookings) : null;
  const depositPayLink = ready ? link("DEPOSIT") : null;
  const banks = new Map<string, { accountName: string; sortCode: string; accountNumber: string }>();
  if (e.payPlan === "DEPOSIT_TRANSFER") {
    const ids = e.bookings.flatMap((b) => (b.artistId ? [b.artistId] : []));
    for (const [id, act] of await loadPayActs(e.agencyId, ids)) {
      const p = payeeFor(act);
      if (p?.bankSortCode && p.bankAccountNumber)
        banks.set(id, { accountName: p.bankAccountName || p.name, sortCode: p.bankSortCode, accountNumber: p.bankAccountNumber });
    }
  }

  return (
    <div className="min-h-screen bg-ink-50 px-4 py-10 text-ink-950">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <div className="text-sm font-medium text-ink-500">{brand}</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{e.name}</h1>
          <p className="mt-1 text-ink-600">
            {day}
            {e.venue ? ` · ${e.venue.name}${e.venue.city ? `, ${e.venue.city}` : ""}` : e.venueText ? ` · ${e.venueText}` : ""}
          </p>
        </div>

        {e.bookings.length > 0 && (
          <section className="card card-pad mb-6">
            <h2 className="section-title mb-3">What&apos;s booked</h2>
            <ul className="divide-y divide-ink-100 text-sm">
              {e.bookings.map((b) => (
                <li key={b.id} className="flex justify-between gap-3 py-2.5">
                  <span className="font-medium">{actName(b)}</span>
                  <span className="text-ink-600 tabular-nums">
                    {localTime(b.setStart, b.timezone)}
                    {b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {money && money.total > 0 && !direct && (
          <section className="card card-pad mb-6">
            <h2 className="section-title mb-3">Your payments</h2>
            <dl className="divide-y divide-ink-100 text-sm">
              <div className="flex justify-between gap-3 py-2.5">
                <dt className="text-ink-600">Total{money.vat ? " (including VAT)" : ""}</dt>
                <dd className="font-medium tabular-nums">{m(money.total)}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2.5">
                <dt className="text-ink-600">Paid so far</dt>
                <dd className="font-medium text-emerald-700 tabular-nums">{m(money.received)}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2.5">
                <dt className="font-semibold">Left to pay</dt>
                <dd className="text-lg font-semibold tabular-nums">{m(money.outstanding)}</dd>
              </div>
            </dl>
            {depositLeft > 0 && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Your deposit of {m(depositDue)} is due{depositBy ? ` by ${depositBy}` : " now"}
                {money.deposits > 0 ? ` (${m(depositLeft)} still to pay)` : ""}.
              </p>
            )}
            {cash && money.outstanding - depositLeft > 0 && (
              <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-800" data-testid="cash-balance">
                Your balance of {m(money.outstanding - depositLeft)} is paid to us in cash, with no VAT, by {balanceBy}.
                {cashAddress ? ` Please bring it to ${cashAddress}.` : " We'll send you the address to bring it to."}
              </p>
            )}
            {money.outstanding === 0 && <p className="mt-3 text-sm font-medium text-emerald-700">All paid. Thank you!</p>}
            {payLink && money.outstanding > 0 && (
              <a href={`/pay/${payLink.token}`} className="btn btn-primary mt-4 w-full sm:w-auto">
                {payLink.kind === "DEPOSIT" ? "Pay your deposit" : "Pay now"}
              </a>
            )}
          </section>
        )}

        {money && money.total > 0 && direct && split && (
          <section className="card card-pad mb-6">
            <h2 className="section-title mb-1">Your payments</h2>
            <p className="mb-3 text-sm text-ink-500">
              Your deposit comes to us. The rest goes straight to {e.bookings.length > 1 ? "each act" : "your act"}
              {e.payPlan === "DEPOSIT_CASH" ? ", in cash on the day." : ", by bank transfer before the day."}
            </p>
            <div className="flex items-center justify-between gap-3 border-y border-ink-100 py-3 text-sm">
              <span>
                <span className="font-medium">Deposit to {brand}</span>
                {depositBy && split.usLeft > 0 && <span className="block text-xs text-ink-500">Due by {depositBy}</span>}
              </span>
              <span className="text-right tabular-nums">
                <span className="block font-medium">{m(split.toUs)}</span>
                {split.usLeft > 0 ? (
                  <span className="text-xs text-amber-700">{m(split.usLeft)} to pay</span>
                ) : (
                  <span className="text-xs font-medium text-emerald-700">Paid ✓</span>
                )}
              </span>
            </div>
            <ul className="divide-y divide-ink-100">
              {e.bookings.map((b) => {
                const s = directSplit(b);
                const bank = b.artistId ? banks.get(b.artistId) : null;
                return (
                  <li key={b.id} className="py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">To {actName(b)}</span>
                      <span className="text-right tabular-nums">
                        <span className="block font-medium">{m(s.toAct)}</span>
                        {s.actLeft > 0 ? (
                          <span className="text-xs text-ink-500">{e.payPlan === "DEPOSIT_CASH" ? "In cash on the day" : "By bank transfer"}</span>
                        ) : (
                          <span className="text-xs font-medium text-emerald-700">Paid ✓</span>
                        )}
                      </span>
                    </div>
                    {e.payPlan === "DEPOSIT_TRANSFER" &&
                      s.actLeft > 0 &&
                      (bank ? (
                        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-ink-50 px-3 py-2.5 text-[13px]">
                          <dt className="text-ink-500">Account name</dt>
                          <dd className="font-medium">{bank.accountName}</dd>
                          <dt className="text-ink-500">Sort code</dt>
                          <dd className="font-mono font-medium">{bank.sortCode}</dd>
                          <dt className="text-ink-500">Account number</dt>
                          <dd className="font-mono font-medium">{bank.accountNumber}</dd>
                          <dt className="text-ink-500">Amount</dt>
                          <dd className="font-medium">{m(s.actLeft)}</dd>
                          <dt className="text-ink-500">Reference</dt>
                          <dd className="font-mono font-medium">{b.reference}</dd>
                        </dl>
                      ) : (
                        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                          We&apos;ll send you {actName(b)}&apos;s bank details. Just reply to any of our emails if you need them sooner.
                        </p>
                      ))}
                  </li>
                );
              })}
            </ul>
            {split.usLeft === 0 && split.actLeft === 0 && <p className="mt-3 text-sm font-medium text-emerald-700">All paid. Thank you!</p>}
            {depositPayLink && split.usLeft > 0 && (
              <a href={`/pay/${depositPayLink.token}`} className="btn btn-primary mt-4 w-full sm:w-auto">
                Pay your deposit
              </a>
            )}
          </section>
        )}

        <ActionForm action={submitPlanner.bind(null, token)} className="card card-pad space-y-5">
          <div>
            <h2 className="section-title">{wedding ? "Your wedding day" : "Your event"}</h2>
            <p className="mt-1 text-sm text-ink-500">
              Tell us as much as you can. Everyone performing gets these details before the day. You can come back to this page and change anything.
            </p>
          </div>
          <label className="block max-w-40">
            <span className="label">Number of guests</span>
            <input name="guestCount" inputMode="numeric" defaultValue={e.guestCount ?? ""} className="input" />
          </label>
          {planFieldsFor(e, parseExtraFields(e.agency.settings?.planExtraFields)).map((f) => (
            <label key={f.name} className="block">
              <span className="label">{f.label}</span>
              <textarea name={f.name} rows={f.name === "timeline" || f.name === "songRequests" ? 5 : 3} defaultValue={f.value} className="input" />
              {f.hint && <span className="hint block">{f.hint}</span>}
            </label>
          ))}
          <SubmitButton className="btn btn-primary w-full sm:w-auto" pendingText="Sending…">
            Send to {brand}
          </SubmitButton>
        </ActionForm>
        <p className="mt-6 text-center text-xs text-ink-400">This page is private to you. Please don&apos;t share the link.</p>
      </div>
    </div>
  );
}
