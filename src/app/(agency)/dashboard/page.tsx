import type { Metadata } from "next";
import Link from "next/link";
import { arrivalDetail } from "@/components/arrival-panel";
import { ArrivalBadge, ArtistDot, Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { arrivalFor, bookingListInclude } from "@/lib/bookings";
import { LIVE_STATUSES } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { unresolvedPastWhere } from "@/lib/billing";
import { dealBreakdown, formatMoney, paymentTotals } from "@/lib/money";
import { formatDate, formatDateTime, localTime } from "@/lib/time";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireStaff();
  const settings = await getSettings(user.agencyId);
  const now = new Date();
  const DAY = 86_400_000;
  const cur = settings.defaultCurrency;

  const [upcoming, today, holds, money, activity, unresolved] = await Promise.all([
    prisma.booking.findMany({
      where: { agencyId: user.agencyId, status: { in: LIVE_STATUSES }, setStart: { gte: now, lte: new Date(now.getTime() + 30 * DAY) } },
      include: bookingListInclude,
      orderBy: { setStart: "asc" },
      take: 10,
    }),
    prisma.booking.findMany({
      where: { agencyId: user.agencyId, status: { in: LIVE_STATUSES }, arriveBy: { gte: new Date(now.getTime() - 12 * 3_600_000), lte: new Date(now.getTime() + 24 * 3_600_000) } },
      include: bookingListInclude,
      orderBy: { arriveBy: "asc" },
    }),
    prisma.booking.count({ where: { agencyId: user.agencyId, status: "HOLD", setStart: { gte: now } } }),
    // Bookings that still involve money moving: confirmed or settled, in the agency's main currency.
    prisma.booking.findMany({
      where: { agencyId: user.agencyId, status: { in: ["CONFIRMED", "SETTLED", "PENDING"] }, currency: cur },
      include: { payments: true, artist: { select: { name: true } }, promoter: { select: { name: true } } },
    }),
    prisma.activity.findMany({ where: { agencyId: user.agencyId }, orderBy: { createdAt: "desc" }, take: 8, include: { user: { select: { name: true } } } }),
    prisma.booking.count({ where: { agencyId: user.agencyId, ...unresolvedPastWhere(now) } }),
  ]);

  let owedByPromoters = 0;
  let owedToArtists = 0;
  let commissionThisYear = 0;
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const overdueDeposits: typeof money = [];
  for (const b of money) {
    const d = dealBreakdown(b);
    const t = paymentTotals(b.payments);
    if (b.status !== "PENDING") {
      owedByPromoters += Math.max(0, d.totalDueMinor - t.receivedMinor);
      owedToArtists += Math.max(0, d.artistMinor - t.paidOutMinor);
      if (b.setStart >= yearStart) commissionThisYear += d.agencyMinor;
    }
    if (b.depositMinor > 0 && b.depositDueDate && b.depositDueDate < now && t.depositReceivedMinor < b.depositMinor) {
      overdueDeposits.push(b);
    }
  }

  const todayRows = today.map((b) => ({ b, a: arrivalFor(b, settings, now) }));
  const overdue = todayRows.filter((r) => r.a.state === "OVERDUE").length;

  return (
    <div>
      <PageHeader
        eyebrow={formatDate(now, settings.defaultTimezone)}
        title={`Hello, ${user.name.split(" ")[0]}`}
        subtitle={
          overdue > 0
            ? `${overdue} artist${overdue === 1 ? " is" : "s are"} late right now.`
            : todayRows.length
              ? `${todayRows.length} call time${todayRows.length === 1 ? "" : "s"} in the next 24 hours.`
              : "No call times in the next 24 hours."
        }
        actions={
          <Link href="/bookings/new" className="btn btn-primary">
            New booking
          </Link>
        }
      />

      {unresolved > 0 && (
        <Link
          href="/bookings?status=UNRESOLVED&when=all"
          className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:border-amber-300"
        >
          <span className="badge bg-amber-400 text-ink-950">{unresolved}</span>
          past gig{unresolved === 1 ? " is" : "s are"} still on enquiry, hold or pending. Confirm or cancel them so your records and bill are right.
          <span className="ml-auto font-medium">Tidy up →</span>
        </Link>
      )}

      <div className="mb-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          tone={overdue > 0 ? "alert" : "dark"}
          label="Arrivals today"
          value={todayRows.filter((r) => r.a.state === "ARRIVED_ON_TIME" || r.a.state === "ARRIVED_LATE").length + ` / ${todayRows.length}`}
          hint={overdue > 0 ? `${overdue} overdue` : "checked in"}
          href="/arrivals"
        />
        <Stat label="Shows in next 30 days" value={upcoming.length >= 10 ? "10+" : upcoming.length} hint={`${holds} open hold${holds === 1 ? "" : "s"}`} href="/calendar" />
        <Stat label="Owed by promoters" value={formatMoney(owedByPromoters, cur)} hint={`${cur} bookings`} href="/reports" />
        <Stat label={`Commission ${now.getUTCFullYear()}`} value={formatMoney(commissionThisYear, cur)} hint={`Owed to artists ${formatMoney(owedToArtists, cur)}`} href="/reports" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Next 24 hours</h2>
            <Link href="/arrivals" className="link text-sm">
              Open live board
            </Link>
          </div>
          {todayRows.length === 0 ? (
            <Empty>No call times in the next 24 hours.</Empty>
          ) : (
            <ul className="card divide-y divide-slate-100">
              {todayRows.map(({ b, a }) => (
                <li key={b.id}>
                  <Link href={`/bookings/${b.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        <ArtistDot colour={b.artist.colour} />
                        {b.artist.name}
                        <span className="truncate font-normal text-slate-500">· {b.venue?.name ?? "No venue"}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        Call {localTime(b.arriveBy, b.timezone)} · {arrivalDetail(a, b.timezone) || "Not checked in yet"}
                      </div>
                    </div>
                    <ArrivalBadge state={a.state} />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <h2 className="section-title mt-8 mb-3">Coming up</h2>
          {upcoming.length === 0 ? (
            <Empty>No shows in the next 30 days.</Empty>
          ) : (
            <ul className="card divide-y divide-slate-100">
              {upcoming.map((b) => (
                <li key={b.id}>
                  <Link href={`/bookings/${b.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        <ArtistDot colour={b.artist.colour} />
                        {b.artist.name}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {formatDate(b.arriveBy, b.timezone)} · {b.venue ? `${b.venue.name}${b.venue.city ? `, ${b.venue.city}` : ""}` : "No venue"}
                      </div>
                    </div>
                    <StatusBadge status={b.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          <section>
            <h2 className="section-title mb-3">Overdue deposits</h2>
            {overdueDeposits.length === 0 ? (
              <Empty>All deposits are in.</Empty>
            ) : (
              <ul className="card divide-y divide-slate-100 text-sm">
                {overdueDeposits.map((b) => (
                  <li key={b.id}>
                    <Link href={`/bookings/${b.id}`} className="block px-4 py-3 hover:bg-slate-50">
                      <strong>{b.reference}</strong> · {b.artist.name}
                      <div className="text-xs text-slate-500">
                        {formatMoney(b.depositMinor, b.currency)} from {b.promoter?.name ?? "promoter"}, due {formatDate(b.depositDueDate!, b.timezone)}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="section-title mb-3">Recent activity</h2>
            {activity.length === 0 ? (
              <Empty>Nothing yet.</Empty>
            ) : (
              <ul className="card divide-y divide-slate-100 text-sm">
                {activity.map((a) => (
                  <li key={a.id} className="px-4 py-2.5">
                    <span className="font-medium">{a.user?.name ?? "Someone"}</span> {a.action}
                    {a.detail && <span className="text-slate-500"> · {a.detail}</span>}
                    {a.entity === "BOOKING" && a.action !== "deleted" && (
                      <Link href={`/bookings/${a.entityId}`} className="link ml-1 text-xs">
                        view
                      </Link>
                    )}
                    <div className="text-xs text-slate-400">{formatDateTime(a.createdAt, settings.defaultTimezone)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
