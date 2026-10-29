import type { Metadata } from "next";
import Link from "next/link";
import { markPaid } from "@/actions/payments";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ArtistDot, Empty, PageHeader, Stat } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { PAYMENT_KIND_LABELS, actName, type PaymentKind } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { outstanding } from "@/lib/payments";
import { PERIODS, periodRange, shiftPeriod, type Period } from "@/lib/periods";
import { venueColour } from "@/lib/rota";
import { addDaysToKey, formatDate, localDateKey, zonedToUtc } from "@/lib/time";

export const metadata: Metadata = { title: "Payments" };

// Money in from venues and clients, money out to acts: what's still owed each way, grouped so a
// venue's or an act's gigs can be marked paid in one go, and a log of payments for any period.

const TABS = [
  ["collect", "To collect"],
  ["pay", "To pay acts"],
  ["history", "Payments log"],
] as const;
type Tab = (typeof TABS)[number][0];

type Row = { id: string; reference: string; date: string; act: string; amount: number; days: number };
type Group = { key: string; name: string; colour?: string; href?: string; rows: Row[]; total: number };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ tab?: string; upcoming?: string; period?: string; date?: string }> }) {
  const user = await requireStaff();
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const cur = settings.defaultCurrency;
  const m = (x: number) => formatMoney(x, cur);
  const sp = await searchParams;
  const tab: Tab = TABS.some(([t]) => t === sp.tab) ? (sp.tab as Tab) : "collect";
  const today = localDateKey(new Date(), tz);
  const upcoming = sp.upcoming === "1";
  const qs = (extra: Record<string, string>) => `/payments?${new URLSearchParams({ tab, ...(upcoming ? { upcoming: "1" } : {}), ...extra })}`;

  // Owed both ways, on gigs that are on. By default only gigs that have happened: that's when money's due.
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
    const amount = tab === "collect" ? o.toCollect : o.toPay;
    if (amount <= 0) continue;
    const date = localDateKey(b.arriveBy, b.timezone);
    let g: Omit<Group, "rows" | "total">;
    if (tab === "pay") {
      g = b.artist ? { key: b.artist.id, name: b.artist.name, colour: b.artist.colour, href: `/artists/${b.artist.id}` } : { key: "none", name: "No act" };
    } else if (b.event) {
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
            booking: { agencyId: user.agencyId },
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

  return (
    <div>
      <PageHeader title="Payments" subtitle="What venues and clients still owe, what's still to pay the acts, and every payment logged." />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="inline-flex gap-1 rounded-xl border border-ink-200 bg-white p-1 text-sm" role="tablist" aria-label="Payments">
          {TABS.map(([t, label]) => (
            <Link
              key={t}
              href={`/payments?tab=${t}`}
              className={`rounded-lg px-3.5 py-2 font-medium ${tab === t ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-ink-100"}`}
            >
              {label}
            </Link>
          ))}
        </div>
        {tab !== "history" ? (
          <Link href={upcoming ? `/payments?tab=${tab}` : `/payments?tab=${tab}&upcoming=1`} className="btn btn-sm">
            {upcoming ? "Gigs that have happened only" : "Include upcoming gigs"}
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
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
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
                    <th>Gig</th>
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
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <Stat
              tone={owedTotal ? "dark" : "default"}
              label={tab === "collect" ? "Still to collect" : "Still to pay acts"}
              value={m(owedTotal)}
              hint={`${sorted.reduce((t, g) => t + g.rows.length, 0)} gigs`}
            />
            <Stat label={tab === "collect" ? "Venues and clients" : "Acts"} value={sorted.length} />
            <Stat
              label="Oldest"
              value={oldest > 0 ? `${oldest} day${oldest === 1 ? "" : "s"}` : "-"}
              hint="since the gig"
              tone={oldest > 30 ? "alert" : "default"}
            />
          </div>
          {sorted.length === 0 ? (
            <Empty>{tab === "collect" ? "Nothing to collect. Everyone has paid." : "Nothing to pay. Every act has been paid."}</Empty>
          ) : (
            <div className="space-y-4">
              {sorted.map((g) => (
                <details key={g.key} className="card group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4">
                    <span className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
                      {g.colour && <ArtistDot colour={g.colour} />}
                      {g.name}
                      <span className="text-sm font-normal text-ink-500">
                        · {g.rows.length} gig{g.rows.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="text-lg font-semibold tabular-nums">{m(g.total)}</span>
                    <span className="text-ink-500 transition group-open:rotate-90">›</span>
                  </summary>
                  <div className="border-t border-ink-100 px-4 pb-4">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Gig</th>
                          <th>{tab === "collect" ? "Act" : "Date"}</th>
                          <th className="text-right">Owed</th>
                          <th className="text-right">Since gig</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <Link href={`/bookings/${r.id}`} className="hover:underline">
                                {r.reference}
                              </Link>
                              {tab === "collect" && <div className="text-xs text-ink-500">{formatDate(zonedToUtc(r.date, "12:00", tz), tz)}</div>}
                            </td>
                            <td>{tab === "collect" ? r.act : formatDate(zonedToUtc(r.date, "12:00", tz), tz)}</td>
                            <td className="text-right tabular-nums">{m(r.amount)}</td>
                            <td className={`text-right tabular-nums ${r.days > 30 ? "font-medium text-rose-500" : ""}`}>
                              {r.days > 0 ? `${r.days} day${r.days === 1 ? "" : "s"}` : r.days === 0 ? "Today" : "Upcoming"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <ActionForm action={markPaid} className="mt-3 flex flex-wrap items-center justify-end gap-3">
                      <input type="hidden" name="direction" value={tab === "collect" ? "IN" : "OUT"} />
                      {g.rows.map((r) => (
                        <input key={r.id} type="hidden" name="id" value={r.id} />
                      ))}
                      {g.href && (
                        <Link href={g.href} className="link text-sm">
                          Open
                        </Link>
                      )}
                      <SubmitButton pendingText="Saving…">
                        {tab === "collect" ? `Mark ${m(g.total)} received` : `Mark ${m(g.total)} paid to ${g.name}`}
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
