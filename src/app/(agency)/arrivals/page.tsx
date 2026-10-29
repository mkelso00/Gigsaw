import type { Metadata } from "next";
import Link from "next/link";
import { arrivalDetail } from "@/components/arrival-panel";
import { AutoRefresh } from "@/components/client-bits";
import { ArrivalBadge, ArtistDot, Empty, PageHeader, Stat } from "@/components/ui";
import { LOCATION_LABELS, formatDistance, type ArrivalState } from "@/lib/arrival";
import { requireStaff } from "@/lib/auth";
import { arrivalFor, bookingListInclude, punctualityByArtist } from "@/lib/bookings";
import { CHECK_IN_KIND_LABELS, LIVE_STATUSES, actName } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { formatDate, formatDateTime, formatMinutes, localTime, zoneLabel } from "@/lib/time";

export const metadata: Metadata = { title: "Arrivals" };
export const dynamic = "force-dynamic";

// Most urgent first on the live board.
const ORDER: Record<ArrivalState, number> = {
  OVERDUE: 0,
  ON_THE_WAY: 1,
  AWAITING: 2,
  NOT_DUE: 3,
  ARRIVED_LATE: 4,
  ARRIVED_ON_TIME: 5,
  NO_CHECK_IN: 6,
  CANCELLED: 7,
};

export default async function ArrivalsPage() {
  const user = await requireStaff();
  const settings = await getSettings(user.agencyId);
  const now = new Date();
  const HOUR = 3_600_000;

  // Gigs with a call time from 12 hours ago to 24 hours ahead.
  const live = await prisma.booking.findMany({
    where: {
      agencyId: user.agencyId,
      status: { in: LIVE_STATUSES },
      arriveBy: { gte: new Date(now.getTime() - 12 * HOUR), lte: new Date(now.getTime() + 24 * HOUR) },
    },
    include: bookingListInclude,
  });
  const board = live
    .map((b) => ({ b, a: arrivalFor(b, settings, now) }))
    .sort((x, y) => ORDER[x.a.state] - ORDER[y.a.state] || x.b.arriveBy.getTime() - y.b.arriveBy.getTime());

  const count = (s: ArrivalState) => board.filter((r) => r.a.state === s).length;
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000);

  const [recent, artists, stats] = await Promise.all([
    prisma.checkIn.findMany({
      where: { booking: { agencyId: user.agencyId } },
      orderBy: { at: "desc" },
      take: 20,
      include: {
        artist: { select: { name: true, colour: true } },
        booking: { select: { id: true, reference: true, timezone: true, venue: { select: { name: true } } } },
      },
    }),
    prisma.artist.findMany({ where: { agencyId: user.agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true, colour: true } }),
    punctualityByArtist(settings, yearAgo),
  ]);

  return (
    <div>
      <PageHeader
        title="Arrivals"
        subtitle={
          <>
            Who has turned up, who is on the way, and who is late. Late means more than {settings.lateGraceMinutes} min after call time.{" "}
            <AutoRefresh seconds={30} />
          </>
        }
        actions={
          <a href="/api/export/arrivals" className="btn">
            Export arrival log
          </a>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Overdue now" value={<span className={count("OVERDUE") ? "text-rose-600" : ""}>{count("OVERDUE")}</span>} />
        <Stat label="On the way" value={count("ON_THE_WAY")} />
        <Stat label="Arrived" value={count("ARRIVED_ON_TIME") + count("ARRIVED_LATE")} hint={`${count("ARRIVED_LATE")} late`} />
        <Stat label="Still to come" value={count("AWAITING") + count("NOT_DUE")} hint="next 24 hours" />
      </div>

      <section className="mb-8">
        <h2 className="section-title mb-3">Live board</h2>
        {board.length === 0 ? (
          <Empty>No gigs with a call time in the last 12 or next 24 hours.</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {board.map(({ b, a }) => (
              <Link
                key={b.id}
                href={`/bookings/${b.id}`}
                className={`card block p-4 transition hover:shadow-md ${a.state === "OVERDUE" ? "border-rose-300 bg-rose-50/50" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-semibold">
                      <ArtistDot colour={b.artist?.colour ?? "#a2a199"} />
                      <span className="truncate">{actName(b)}</span>
                    </div>
                    <div className="truncate text-sm text-slate-500">{b.venue ? `${b.venue.name}${b.venue.city ? `, ${b.venue.city}` : ""}` : "No venue"}</div>
                  </div>
                  <ArrivalBadge state={a.state} />
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span>
                    Call <strong>{localTime(b.arriveBy, b.timezone)}</strong> {zoneLabel(b.arriveBy, b.timezone)}
                  </span>
                  <span>
                    On stage <strong>{localTime(b.setStart, b.timezone)}</strong>
                  </span>
                  <span className="text-slate-500">{formatDate(b.arriveBy, b.timezone)}</span>
                </div>
                {arrivalDetail(a, b.timezone) && <div className="mt-2 text-sm font-medium">{arrivalDetail(a, b.timezone)}</div>}
                {a.location && (
                  <div className="mt-1 text-xs text-slate-500">
                    {LOCATION_LABELS[a.location]}
                    {a.distanceM !== null ? ` · ${formatDistance(a.distanceM)} from venue` : ""}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section>
          <h2 className="section-title mb-3">Punctuality, last 12 months</h2>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Artist</th>
                  <th className="text-right">On time</th>
                  <th className="text-right">Late</th>
                  <th className="text-right">No check-in</th>
                  <th className="text-right">Avg when late</th>
                </tr>
              </thead>
              <tbody>
                {artists.map((ar) => {
                  const s = stats.get(ar.id);
                  return (
                    <tr key={ar.id}>
                      <td>
                        <Link href={`/artists/${ar.id}`} className="flex items-center gap-2 hover:underline">
                          <ArtistDot colour={ar.colour} />
                          {ar.name}
                        </Link>
                      </td>
                      <td className="text-right">
                        {s?.onTimeRate != null ? (
                          <span className={s.onTimeRate >= 0.9 ? "text-emerald-700" : s.onTimeRate >= 0.7 ? "text-amber-700" : "text-rose-700"}>
                            {Math.round(s.onTimeRate * 100)}%
                          </span>
                        ) : (
                          <span className="text-slate-400">No data</span>
                        )}
                        {s && s.tracked > 0 && (
                          <span className="block text-xs text-slate-500">
                            {s.onTime} of {s.tracked}
                          </span>
                        )}
                      </td>
                      <td className="text-right">{s?.late ?? 0}</td>
                      <td className="text-right">{s?.missing ?? 0}</td>
                      <td className="text-right">{s?.averageMinutesLate != null ? formatMinutes(s.averageMinutesLate) : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="section-title mb-3">Latest check-ins</h2>
          {recent.length === 0 ? (
            <Empty>No check-ins yet. Artists check in from the Gigsaw app on their phone.</Empty>
          ) : (
            <ul className="card divide-y divide-slate-100">
              {recent.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <div className="flex items-center gap-2">
                      <ArtistDot colour={c.artist?.colour ?? "#a2a199"} />
                      <strong>{actName(c)}</strong>
                      <span>{(CHECK_IN_KIND_LABELS[c.kind as keyof typeof CHECK_IN_KIND_LABELS] ?? c.kind).toLowerCase()}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      <Link href={`/bookings/${c.booking.id}`} className="hover:underline">
                        {c.booking.reference}
                        {c.booking.venue ? ` · ${c.booking.venue.name}` : ""}
                      </Link>
                      {c.distanceM !== null && ` · ${formatDistance(c.distanceM)} from venue`}
                      {c.source === "AGENT" && " · logged by agency"}
                    </div>
                  </div>
                  <span className="text-xs whitespace-nowrap text-slate-500">{formatDateTime(c.at, c.booking.timezone)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
