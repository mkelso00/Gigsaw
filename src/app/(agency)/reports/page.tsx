import type { Metadata } from "next";
import Link from "next/link";
import { ArtistDot, Empty, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { dealBreakdown, formatMoney, paymentTotals } from "@/lib/money";
import { localDateKey, zonedToUtc } from "@/lib/time";
import { actName } from "@/lib/constants";

export const metadata: Metadata = { title: "Reports" };

type Totals = { gigs: number; gross: number; agency: number; artist: number; received: number; owed: number; owedArtist: number };
const empty = (): Totals => ({ gigs: 0, gross: 0, agency: 0, artist: 0, received: 0, owed: 0, owedArtist: 0 });

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireStaff();
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const sp = await searchParams;
  const today = localDateKey(new Date(), tz);
  const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const from = valid(sp.from) ?? `${today.slice(0, 4)}-01-01`;
  const to = valid(sp.to) ?? `${today.slice(0, 4)}-12-31`;

  const bookings = await prisma.booking.findMany({
    where: {
      agencyId: user.agencyId,
      status: { in: ["CONFIRMED", "SETTLED"] },
      arriveBy: { gte: zonedToUtc(from, "00:00", tz), lte: zonedToUtc(to, "23:59", tz) },
    },
    include: { payments: true, artist: { select: { id: true, name: true, colour: true } }, agent: { select: { id: true, name: true } } },
  });

  // Totals are kept per currency so different currencies are never added together.
  const byCurrency = new Map<string, Totals>();
  const byArtist = new Map<string, { name: string; colour: string; t: Map<string, Totals> }>();
  const byAgent = new Map<string, { name: string; t: Map<string, Totals> }>();
  const add = (map: Map<string, Totals>, cur: string, d: ReturnType<typeof dealBreakdown>, p: ReturnType<typeof paymentTotals>) => {
    const t = map.get(cur) ?? empty();
    t.gigs++;
    t.gross += d.grossMinor;
    t.agency += d.agencyMinor;
    t.artist += d.artistMinor;
    t.received += p.receivedMinor;
    t.owed += Math.max(0, d.totalDueMinor - p.receivedMinor);
    t.owedArtist += Math.max(0, d.artistMinor - p.paidOutMinor);
    map.set(cur, t);
  };
  for (const b of bookings) {
    const d = dealBreakdown(b);
    const p = paymentTotals(b.payments);
    add(byCurrency, b.currency, d, p);
    const actKey = b.artist?.id ?? "none";
    const ar = byArtist.get(actKey) ?? { name: actName(b), colour: b.artist?.colour ?? "#a2a199", t: new Map() };
    add(ar.t, b.currency, d, p);
    byArtist.set(actKey, ar);
    const agKey = b.agent?.id ?? "none";
    const ag = byAgent.get(agKey) ?? { name: b.agent?.name ?? "Unassigned", t: new Map() };
    add(ag.t, b.currency, d, p);
    byAgent.set(agKey, ag);
  }

  const rowsFor = (label: React.ReactNode, key: string, t: Map<string, Totals>) =>
    [...t].map(([cur, x], i) => (
      <tr key={`${key}-${cur}`}>
        <td>{i === 0 ? label : ""}</td>
        <td className="text-right">{x.gigs}</td>
        <td className="text-right">{formatMoney(x.gross, cur)}</td>
        <td className="text-right">{formatMoney(x.agency, cur)}</td>
        <td className="text-right">{formatMoney(x.artist, cur)}</td>
        <td className="text-right">{formatMoney(x.received, cur)}</td>
        <td className="text-right">{formatMoney(x.owed, cur)}</td>
        <td className="text-right">{formatMoney(x.owedArtist, cur)}</td>
      </tr>
    ));

  const head = (
    <thead>
      <tr>
        <th />
        <th className="text-right">Shows</th>
        <th className="text-right">Gross</th>
        <th className="text-right">Commission</th>
        <th className="text-right">Artist earnings</th>
        <th className="text-right">Received</th>
        <th className="text-right">Owed by promoters</th>
        <th className="text-right">Owed to artists</th>
      </tr>
    </thead>
  );

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Confirmed and settled shows, by date of the gig."
        actions={
          <>
            <a href={`/api/export/bookings?from=${from}&to=${to}`} className="btn">
              Export bookings CSV
            </a>
            <a href="/api/export/arrivals" className="btn">
              Export arrivals CSV
            </a>
          </>
        }
      />
      <form className="card mb-6 flex flex-wrap items-end gap-3 p-3">
        <label>
          <span className="label">From</span>
          <input type="date" name="from" defaultValue={from} className="input" />
        </label>
        <label>
          <span className="label">To</span>
          <input type="date" name="to" defaultValue={to} className="input" />
        </label>
        <button className="btn">Update</button>
      </form>

      {bookings.length === 0 ? (
        <Empty>No confirmed or settled shows in this period.</Empty>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="section-title mb-3">Totals</h2>
            <div className="card overflow-x-auto">
              <table className="table">
                {head}
                <tbody>{rowsFor("All shows", "all", byCurrency)}</tbody>
              </table>
            </div>
          </section>
          <section>
            <h2 className="section-title mb-3">By artist</h2>
            <div className="card overflow-x-auto">
              <table className="table">
                {head}
                <tbody>
                  {[...byArtist]
                    .sort((a, b) => a[1].name.localeCompare(b[1].name))
                    .flatMap(([id, a]) =>
                      rowsFor(
                        <Link href={`/artists/${id}`} className="flex items-center gap-2 hover:underline">
                          <ArtistDot colour={a.colour} />
                          {a.name}
                        </Link>,
                        id,
                        a.t,
                      ),
                    )}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h2 className="section-title mb-3">By agent</h2>
            <div className="card overflow-x-auto">
              <table className="table">
                {head}
                <tbody>{[...byAgent].flatMap(([id, a]) => rowsFor(a.name, id, a.t))}</tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
