import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { dismissCardPayment, placeCardPayment } from "@/actions/card-payments";
import { markPaid } from "@/actions/payments";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { ArtistDot, Empty, PageHeader, Stat } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { PAYMENT_KIND_LABELS, actName, type PaymentKind } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { outstanding } from "@/lib/payments";
import { PERIODS, periodRange, shiftPeriod, type Period } from "@/lib/periods";
import { venueColour } from "@/lib/rota";
import { addDaysToKey, formatDate, localDateKey, zonedToUtc } from "@/lib/time";
import { PaymentsTabs } from "./_tabs";

export const metadata: Metadata = { title: "Payments" };

// Money in from venues and clients: what's still owed, grouped so a venue's or a client's gigs can be
// marked paid in one go, and a log of payments both ways for any period. Paying acts has its own tab,
// Pay acts (./acts), built around the invoices Gigsaw makes for them.

const TABS = ["collect", "history"] as const;
type Tab = (typeof TABS)[number];

type Row = { id: string; reference: string; date: string; act: string; amount: number; days: number };
type Group = { key: string; name: string; colour?: string; href?: string; rows: Row[]; total: number };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ tab?: string; upcoming?: string; period?: string; date?: string }> }) {
  const user = await requireStaff();
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const cur = settings.defaultCurrency;
  const m = (x: number) => formatMoney(x, cur);
  const sp = await searchParams;
  // Old links to the act tab.
  if (sp.tab === "pay") redirect("/payments/acts");
  const tab: Tab = TABS.some((t) => t === sp.tab) ? (sp.tab as Tab) : "collect";
  const today = localDateKey(new Date(), tz);
  const upcoming = sp.upcoming === "1";
  const qs = (extra: Record<string, string>) => `/payments?${new URLSearchParams({ tab, ...(upcoming ? { upcoming: "1" } : {}), ...extra })}`;

  // Still owed by venues and clients, on gigs that are on. By default only gigs that have happened: that's when money's due.
  const gigs =
    tab === "history"
      ? []
      : await prisma.booking.findMany({
          where: {
            agencyId: user.agencyId,
            status: { in: ["CONFIRMED", "SETTLED"] },
            currency: cur,
            ...(upcoming ? {} : { arriveBy: { lt: zonedToUtc(addDaysToKey(today, 1), "00:00", tz) } }),
          },
          include: {
            payments: true,
            artist: { select: { id: true, name: true, colour: true } },
            venue: { select: { id: true, name: true, colour: true } },
            promoter: { select: { id: true, name: true, type: true } },
            event: { select: { id: true, name: true } },
          },
          orderBy: { arriveBy: "asc" },
        });

  const groups = new Map<string, Group>();
  for (const b of gigs) {
    const o = outstanding(b);
    const amount = o.toCollect;
    if (amount <= 0) continue;
    const date = localDateKey(b.arriveBy, b.timezone);
    let g: Omit<Group, "rows" | "total">;
    if (b.event) {
      g = { key: `e:${b.event.id}`, name: b.event.name, href: `/events/${b.event.id}` };
    } else if (b.venue && b.promoter?.type !== "CLIENT") {
      // Bar gigs: the venue pays.
      g = { key: `v:${b.venue.id}`, name: b.venue.name, colour: venueColour(b.venue), href: `/venues/${b.venue.id}` };
    } else if (b.promoter) {
      g = { key: `c:${b.promoter.id}`, name: b.promoter.name, href: `/contacts/${b.promoter.id}` };
    } else {
      g = { key: `b:${b.id}`, name: b.eventName || b.reference, href: `/bookings/${b.id}` };
    }
    const group = groups.get(g.key) ?? { ...g, rows: [], total: 0 };
    group.rows.push({ id: b.id, reference: b.reference, date, act: actName(b), amount, days: Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000) });
    group.total += amount;
    groups.set(g.key, group);
  }
  const sorted = [...groups.values()].sort((a, b) => b.total - a.total);
  const owedTotal = sorted.reduce((t, g) => t + g.total, 0);
  const oldest = sorted.flatMap((g) => g.rows).reduce((x, r) => Math.max(x, r.days), 0);

  // The payments log, for a week, month or year.
  const period: Period = (PERIODS as readonly string[]).includes(sp.period ?? "") ? (sp.period as Period) : "month";
  const anchor = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const range = periodRange(period, anchor);
  const payments =
    tab === "history"
      ? await prisma.payment.findMany({
          where: {
            booking: { agencyId: user.agencyId, archivedAt: null },
            paidAt: { gte: zonedToUtc(range.from, "00:00", tz), lt: zonedToUtc(addDaysToKey(range.to, 1), "00:00", tz) },
          },
          include: {
            booking: {
              select: {
                id: true,
                reference: true,
                currency: true,
                timezone: true,
                artistId: true,
                artist: { select: { name: true } },
                venue: { select: { name: true } },
                promoter: { select: { name: true } },
                event: { select: { name: true } },
              },
            },
          },
          orderBy: { paidAt: "desc" },
        })
      : [];
  const inTotal = payments.filter((p) => p.direction === "IN" && p.booking.currency === cur).reduce((t, p) => t + p.amountMinor, 0);
  const outTotal = payments.filter((p) => p.direction === "OUT" && p.booking.currency === cur).reduce((t, p) => t + p.amountMinor, 0);

  // Card payments Stripe took that couldn't be put against a booking by themselves.
  const unmatched = await prisma.cardPayment.findMany({ where: { agencyId: user.agencyId, status: "UNMATCHED" }, orderBy: { paidAt: "asc" } });

  return (
    <div>
      <PageHeader title="Payments" subtitle="What venues and clients still owe, paying your acts, and every payment logged." />

      {unmatched.length > 0 && (
        <section className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900" aria-label="Card payments to sort out">
          <h2 className="font-semibold">
            {unmatched.length === 1 ? "A card payment needs" : `${unmatched.length} card payments need`} putting against a booking
          </h2>
          <p className="mt-1">The money is in your Stripe account. Enter the booking it was for and it&apos;s logged there as paid by card.</p>
          <ul className="mt-3 space-y-3">
            {unmatched.map((c) => (
              <li key={c.id} className="rounded-xl bg-white px-4 py-3 text-ink-900">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-base font-semibold tabular-nums">{formatMoney(c.amountMinor, c.currency)}</span>
                  <span className="text-ink-500">
                    {formatDate(c.paidAt, tz)}
                    {c.email && ` · ${c.email}`}
                  </span>
                </div>
                <p className="mt-1 text-ink-600">
                  {c.problem}
                  {c.refundedMinor > 0 && ` ${formatMoney(c.refundedMinor, c.currency)} has since been refunded in Stripe.`}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ActionForm action={placeCardPayment.bind(null, c.id)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <input name="reference" required placeholder="Booking reference" aria-label="Booking reference" className="input w-44" />
                      <SubmitButton className="btn btn-sm btn-primary">Put on booking</SubmitButton>
                    </div>
                  </ActionForm>
                  <ActionForm action={dismissCardPayment.bind(null, c.id)}>
                    <ConfirmButton
                      className="btn btn-sm"
                      message="Clear this payment without putting it on a booking? Only do this if it's been sorted out in Stripe."
                    >
                      Sorted in Stripe
                    </ConfirmButton>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <PaymentsTabs on={tab} />
        {tab !== "history" ? (
          <Link href={upcoming ? `/payments?tab=${tab}` : `/payments?tab=${tab}&upcoming=1`} className="btn btn-sm">
            {upcoming ? "Bookings that have happened only" : "Include upcoming bookings"}
          </Link>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex gap-1 rounded-xl border border-ink-200 bg-white p-1 text-sm">
              {PERIODS.map((p) => (
                <Link
                  key={p}
                  href={qs({ period: p, date: anchor })}
                  className={`rounded-lg px-3 py-1.5 font-medium capitalize ${period === p ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-ink-100"}`}
                >
                  {p}
                </Link>
              ))}
            </div>
            <Link href={qs({ period, date: shiftPeriod(period, anchor, -1) })} className="btn btn-sm" aria-label="Previous">
              ‹
            </Link>
            <span className="min-w-40 px-1 text-center font-semibold">{range.label}</span>
            <Link href={qs({ period, date: shiftPeriod(period, anchor, 1) })} className="btn btn-sm" aria-label="Next">
              ›
            </Link>
          </div>
        )}
      </div>

      {tab === "history" ? (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            <Stat label="Money in" value={m(inTotal)} hint="From venues and clients" />
            <Stat label="Money out" value={m(outTotal)} hint="To acts" />
            <Stat tone="dark" label="Difference" value={m(inTotal - outTotal)} hint={range.label} />
          </div>
          {payments.length === 0 ? (
            <Empty>No payments logged in this {period}.</Empty>
          ) : (
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Booking</th>
                    <th>From / to</th>
                    <th>Type</th>
                    <th className="text-right">In</th>
                    <th className="text-right">Out</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => {
                    const b = p.booking;
                    const pm = (x: number) => formatMoney(x, b.currency);
                    return (
                      <tr key={p.id}>
                        <td className="whitespace-nowrap">{formatDate(p.paidAt, b.timezone)}</td>
                        <td>
                          <Link href={`/bookings/${b.id}`} className="hover:underline">
                            {b.reference}
                          </Link>
                          <div className="text-xs text-ink-500">{actName(b)}</div>
                        </td>
                        <td>{p.direction === "IN" ? (b.event?.name ?? b.promoter?.name ?? b.venue?.name ?? "Client") : actName(b)}</td>
                        <td>
                          {PAYMENT_KIND_LABELS[p.kind as PaymentKind] ?? p.kind}
                          {p.note && <div className="text-xs text-ink-500">{p.note}</div>}
                        </td>
                        <td className="text-right tabular-nums">{p.direction === "IN" ? pm(p.amountMinor) : ""}</td>
                        <td className="text-right tabular-nums">{p.direction === "OUT" ? pm(p.amountMinor) : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            <Stat
              tone={owedTotal ? "dark" : "default"}
              label="Still to collect"
              value={m(owedTotal)}
              hint={`${sorted.reduce((t, g) => t + g.rows.length, 0)} bookings`}
            />
            <Stat label="Venues and clients" value={sorted.length} />
            <Stat
              label="Oldest"
              value={oldest > 0 ? `${oldest} day${oldest === 1 ? "" : "s"}` : "-"}
              hint="since the booking"
              tone={oldest > 30 ? "alert" : "default"}
            />
          </div>
          {sorted.length === 0 ? (
            <Empty>Nothing to collect. Everyone has paid.</Empty>
          ) : (
            <div className="space-y-4">
              {sorted.map((g) => (
                <details key={g.key} className="card group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4">
                    <span className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
                      {g.colour && <ArtistDot colour={g.colour} />}
                      {g.name}
                      <span className="text-sm font-normal text-ink-500">
                        · {g.rows.length} booking{g.rows.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="text-lg font-semibold tabular-nums">{m(g.total)}</span>
                    <span className="text-ink-500 transition group-open:rotate-90">›</span>
                  </summary>
                  <div className="border-t border-ink-100 px-4 pb-4">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Booking</th>
                          <th>Act</th>
                          <th className="text-right">Owed</th>
                          <th className="text-right">Since booking</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <Link href={`/bookings/${r.id}`} className="hover:underline">
                                {r.reference}
                              </Link>
                              <div className="text-xs text-ink-500">{formatDate(zonedToUtc(r.date, "12:00", tz), tz)}</div>
                            </td>
                            <td>{r.act}</td>
                            <td className="text-right tabular-nums">{m(r.amount)}</td>
                            <td className={`text-right tabular-nums ${r.days > 30 ? "font-medium text-rose-500" : ""}`}>
                              {r.days > 0 ? `${r.days} day${r.days === 1 ? "" : "s"}` : r.days === 0 ? "Today" : "Upcoming"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <ActionForm action={markPaid} className="mt-3 flex flex-wrap items-center justify-end gap-3">
                      <input type="hidden" name="direction" value="IN" />
                      {g.rows.map((r) => (
                        <input key={r.id} type="hidden" name="id" value={r.id} />
                      ))}
                      {g.href && (
                        <Link href={g.href} className="link text-sm">
                          Open
                        </Link>
                      )}
                      <SubmitButton pendingText="Saving…">
                        {`Mark ${m(g.total)} received`}
                      </SubmitButton>
                    </ActionForm>
                  </div>
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
