import type { Metadata } from "next";
import Link from "next/link";
import { ArtistDot, Empty, PageHeader, Stat } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { actName } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { dealBreakdown, formatMoney, paymentTotals } from "@/lib/money";
import { PERIODS, periodBuckets, periodRange, shiftPeriod, type Period } from "@/lib/periods";
import { venueColour } from "@/lib/rota";
import { addDaysToKey, localDateKey, zonedToUtc } from "@/lib/time";

export const metadata: Metadata = { title: "Reports" };

// What the acts earned, what venues and clients paid, and what we made, for a week, month,
// year or any dates. Only gigs that are on (confirmed or settled) count.

type Totals = { gigs: number; sale: number; fees: number; cost: number; profit: number; received: number; owed: number; paidOut: number; toPay: number };
const empty = (): Totals => ({ gigs: 0, sale: 0, fees: 0, cost: 0, profit: 0, received: 0, owed: 0, paidOut: 0, toPay: 0 });

const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
const PERIOD_LABELS: Record<Period | "custom", string> = { week: "Week", month: "Month", year: "Year", custom: "Pick dates" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string; date?: string; from?: string; to?: string }> }) {
  const user = await requireStaff();
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const cur = settings.defaultCurrency;
  const sp = await searchParams;
  const today = localDateKey(new Date(), tz);

  const period: Period | "custom" =
    sp.period === "custom" ? "custom" : (PERIODS as readonly string[]).includes(sp.period ?? "") ? (sp.period as Period) : "month";
  const date = valid(sp.date) ?? today;
  let from: string, to: string, label: string;
  if (period === "custom") {
    const [mf, mt] = [periodRange("month", today).from, periodRange("month", today).to];
    from = valid(sp.from) ?? mf;
    to = valid(sp.to) ?? mt;
    if (to < from) [from, to] = [to, from];
    label = `${new Date(`${from}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} to ${new Date(`${to}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
  } else {
    ({ from, to, label } = periodRange(period, date));
  }
  const href = (p: Period | "custom", d?: string) =>
    `/reports?${new URLSearchParams(p === "custom" ? { period: p, from, to } : { period: p, date: d ?? date })}`;

  const bookings = await prisma.booking.findMany({
    where: {
      agencyId: user.agencyId,
      status: { in: ["CONFIRMED", "SETTLED"] },
      arriveBy: { gte: zonedToUtc(from, "00:00", tz), lt: zonedToUtc(addDaysToKey(to, 1), "00:00", tz) },
    },
    include: {
      payments: true,
      artist: { select: { id: true, name: true, colour: true } },
      venue: { select: { id: true, name: true, city: true, colour: true } },
      promoter: { select: { id: true, name: true, company: true, type: true } },
      event: { select: { id: true, name: true } },
    },
    orderBy: { arriveBy: "asc" },
  });
  // Different currencies are never added together; the report is in the agency's currency.
  const inCur = bookings.filter((b) => b.currency === cur);
  const otherCurrencies = bookings.length - inCur.length;

  const total = empty();
  const acts = new Map<string, { name: string; colour: string; id: string | null; t: Totals }>();
  const venues = new Map<string, { name: string; colour: string; id: string; t: Totals }>();
  const clients = new Map<string, { name: string; href: string | null; t: Totals }>();
  const buckets = period === "custom" ? [] : periodBuckets(period, date).map((b) => ({ ...b, t: empty() }));

  const add = (t: Totals, d: ReturnType<typeof dealBreakdown>, p: ReturnType<typeof paymentTotals>) => {
    t.gigs++;
    // What the venue or client paid includes any booking fee; it all counts towards what we made.
    t.sale += d.grossMinor + d.bookingFeeMinor;
    t.fees += d.bookingFeeMinor;
    t.cost += d.artistMinor;
    t.profit += d.agencyMinor;
    t.received += p.receivedMinor;
    t.owed += Math.max(0, d.totalDueMinor - p.receivedMinor);
    t.paidOut += p.paidOutMinor;
    t.toPay += Math.max(0, d.artistMinor - p.paidOutMinor);
  };

  for (const b of inCur) {
    const d = dealBreakdown(b);
    const p = paymentTotals(b.payments);
    add(total, d, p);

    const actKey = b.artist?.id ?? "none";
    const a = acts.get(actKey) ?? { name: actName(b), colour: b.artist?.colour ?? "#a2a199", id: b.artist?.id ?? null, t: empty() };
    add(a.t, d, p);
    acts.set(actKey, a);

    // Bar gigs are paid by the venue. Weddings and private events are paid by the client, even at a venue.
    const clientPays = !!b.eventId || b.promoter?.type === "CLIENT" || !b.venue;
    if (!clientPays && b.venue) {
      const v = venues.get(b.venue.id) ?? { name: b.venue.name, colour: venueColour(b.venue), id: b.venue.id, t: empty() };
      add(v.t, d, p);
      venues.set(b.venue.id, v);
    } else {
      const key = b.event ? `e:${b.event.id}` : b.promoter ? `c:${b.promoter.id}` : `b:${b.id}`;
      const name = b.event?.name ?? b.promoter?.name ?? (b.eventName || b.reference);
      const link = b.event ? `/events/${b.event.id}` : b.promoter ? `/contacts/${b.promoter.id}` : `/bookings/${b.id}`;
      const c = clients.get(key) ?? { name, href: link, t: empty() };
      add(c.t, d, p);
      clients.set(key, c);
    }

    const day = localDateKey(b.arriveBy, tz);
    const bucket = buckets.find((x) => day >= x.from && day <= x.to);
    if (bucket) add(bucket.t, d, p);
  }

  const m = (x: number) => formatMoney(x, cur);
  const byEarned = <T extends { t: Totals }>(map: Map<string, T>) => [...map.values()].sort((a, b) => b.t.sale - a.t.sale || b.t.cost - a.t.cost);

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="What the acts earned, what venues and clients paid, and what we made. Confirmed and settled gigs only."
        actions={
          <>
            <Link href={`/reports/venues?from=${from}&to=${to}`} className="btn">
              Venue statements
            </Link>
            <a href={`/api/export/bookings?from=${from}&to=${to}`} className="btn">
              Export CSV
            </a>
          </>
        }
      />

      <div className="card mb-6 flex flex-wrap items-center gap-3 p-3">
        <div className="inline-flex gap-1 rounded-xl border border-ink-200 bg-white p-1 text-sm" role="tablist" aria-label="Period">
          {(["week", "month", "year", "custom"] as const).map((p) => (
            <Link
              key={p}
              href={href(p, p === period ? date : today)}
              className={`rounded-lg px-3.5 py-2 font-medium ${period === p ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-ink-100"}`}
            >
              {PERIOD_LABELS[p]}
            </Link>
          ))}
        </div>
        {period !== "custom" ? (
          <>
            <div className="flex items-center gap-1">
              <Link href={href(period, shiftPeriod(period, date, -1))} className="btn btn-sm" aria-label="Previous">
                ‹
              </Link>
              <span className="min-w-44 px-2 text-center font-semibold">{label}</span>
              <Link href={href(period, shiftPeriod(period, date, 1))} className="btn btn-sm" aria-label="Next">
                ›
              </Link>
            </div>
            {!(today >= from && today <= to) && (
              <Link href={href(period, today)} className="btn btn-sm">
                This {period}
              </Link>
            )}
            <form className="ml-auto flex items-center gap-2">
              <input type="hidden" name="period" value={period} />
              <label className="sr-only" htmlFor="report-date">
                Go to date
              </label>
              <input id="report-date" type="date" name="date" defaultValue={date} className="input w-auto" />
              <button className="btn btn-sm">Go</button>
            </form>
          </>
        ) : (
          <form className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="period" value="custom" />
            <label>
              <span className="label">From</span>
              <input type="date" name="from" defaultValue={from} className="input w-auto" />
            </label>
            <label>
              <span className="label">To</span>
              <input type="date" name="to" defaultValue={to} className="input w-auto" />
            </label>
            <button className="btn">Show</button>
          </form>
        )}
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Gigs" value={total.gigs} hint={label} />
        <Stat label="Venues and clients paid" value={m(total.sale)} hint={total.owed ? `${m(total.owed)} still owed` : "All paid"} />
        <Stat label="Acts earned" value={m(total.cost)} hint={total.toPay ? `${m(total.toPay)} still to pay` : "All paid"} />
        <Stat
          label="We made"
          value={m(total.profit)}
          hint={
            total.sale
              ? `${Math.round((total.profit / total.sale) * 100)}% of what was paid${total.fees ? ` · ${m(total.fees)} in booking fees` : ""}`
              : undefined
          }
          tone="dark"
        />
      </div>
      {otherCurrencies > 0 && (
        <p className="mb-6 text-sm text-ink-500">
          {otherCurrencies} gig{otherCurrencies === 1 ? "" : "s"} in other currencies {otherCurrencies === 1 ? "is" : "are"} left out of these totals.
        </p>
      )}

      {inCur.length === 0 ? (
        <Empty>No confirmed or settled gigs in {period === "custom" ? "these dates" : `this ${period}`}.</Empty>
      ) : (
        <div className="space-y-8">
          {buckets.length > 0 && (
            <section>
              <h2 className="section-title mb-3">{period === "week" ? "Day by day" : period === "month" ? "Week by week" : "Month by month"}</h2>
              <div className="card overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th />
                      <th className="text-right">Gigs</th>
                      <th className="text-right">Venues and clients paid</th>
                      <th className="text-right">Acts earned</th>
                      <th className="text-right">We made</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buckets.map((x) => (
                      <tr key={x.from} className={x.t.gigs ? "" : "text-ink-400"}>
                        <td>
                          {period === "year" ? (
                            <Link href={href("month", x.from)} className="hover:underline">
                              {x.label}
                            </Link>
                          ) : period === "month" ? (
                            <Link href={href("week", x.from)} className="hover:underline">
                              {x.label}
                            </Link>
                          ) : (
                            x.label
                          )}
                        </td>
                        <td className="text-right">{x.t.gigs}</td>
                        <td className="text-right">{m(x.t.sale)}</td>
                        <td className="text-right">{m(x.t.cost)}</td>
                        <td className="text-right font-semibold">{m(x.t.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section>
            <h2 className="section-title mb-3">What each act earned</h2>
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Act</th>
                    <th className="text-right">Gigs</th>
                    <th className="text-right">Earned</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Still to pay</th>
                    <th className="text-right">We made</th>
                  </tr>
                </thead>
                <tbody>
                  {[...acts.values()]
                    .sort((a, b) => b.t.cost - a.t.cost)
                    .map((a) => (
                      <tr key={a.id ?? "none"}>
                        <td>
                          {a.id ? (
                            <Link href={`/artists/${a.id}`} className="flex items-center gap-2 hover:underline">
                              <ArtistDot colour={a.colour} />
                              {a.name}
                            </Link>
                          ) : (
                            a.name
                          )}
                        </td>
                        <td className="text-right">{a.t.gigs}</td>
                        <td className="text-right font-semibold">{m(a.t.cost)}</td>
                        <td className="text-right">{m(a.t.paidOut)}</td>
                        <td className="text-right">{a.t.toPay ? m(a.t.toPay) : "-"}</td>
                        <td className="text-right">{m(a.t.profit)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="section-title mb-3">What each venue paid for live music</h2>
            {venues.size === 0 ? (
              <Empty>No bar gigs in these dates.</Empty>
            ) : (
              <div className="card overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Venue</th>
                      <th className="text-right">Gigs</th>
                      <th className="text-right">Paid for music</th>
                      <th className="text-right">Acts earned</th>
                      <th className="text-right">We made</th>
                      <th className="text-right">Still owes</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {byEarned(venues).map((v) => (
                      <tr key={v.id}>
                        <td>
                          <Link href={`/venues/${v.id}`} className="flex items-center gap-2 hover:underline">
                            <ArtistDot colour={v.colour} />
                            {v.name}
                          </Link>
                        </td>
                        <td className="text-right">{v.t.gigs}</td>
                        <td className="text-right font-semibold">{m(v.t.sale)}</td>
                        <td className="text-right">{m(v.t.cost)}</td>
                        <td className="text-right">{m(v.t.profit)}</td>
                        <td className="text-right">{v.t.owed ? m(v.t.owed) : "-"}</td>
                        <td className="text-right">
                          <Link href={`/reports/venues?venue=${v.id}&from=${from}&to=${to}`} className="link text-sm">
                            Statement
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {clients.size > 0 && (
            <section>
              <h2 className="section-title mb-3">Weddings and private clients</h2>
              <div className="card overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Client or event</th>
                      <th className="text-right">Gigs</th>
                      <th className="text-right">Paid for music</th>
                      <th className="text-right">Acts earned</th>
                      <th className="text-right">We made</th>
                      <th className="text-right">Still owes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byEarned(clients).map((c) => (
                      <tr key={c.href ?? c.name}>
                        <td>
                          {c.href ? (
                            <Link href={c.href} className="hover:underline">
                              {c.name}
                            </Link>
                          ) : (
                            c.name
                          )}
                        </td>
                        <td className="text-right">{c.t.gigs}</td>
                        <td className="text-right font-semibold">{m(c.t.sale)}</td>
                        <td className="text-right">{m(c.t.cost)}</td>
                        <td className="text-right">{m(c.t.profit)}</td>
                        <td className="text-right">{c.t.owed ? m(c.t.owed) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
