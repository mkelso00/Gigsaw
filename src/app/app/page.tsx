import Link from "next/link";
import { arrivalDetail } from "@/components/arrival-panel";
import { CheckInPanel } from "@/components/check-in-panel";
import { ArrivalBadge, StatusBadge } from "@/components/ui";
import { checkInWindow, punctuality } from "@/lib/arrival";
import { requireUser } from "@/lib/auth";
import { arrivalFor } from "@/lib/bookings";
import { getSettings, prisma } from "@/lib/db";
import { formatDate, localTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ArtistHome() {
  const user = await requireUser(["ARTIST"]);
  if (!user.artistId) return <p className="text-sm text-slate-600">Your login isn&apos;t linked to an artist. Ask your agent to check it.</p>;
  const settings = await getSettings(user.agencyId);
  const now = new Date();

  const bookings = await prisma.booking.findMany({
    // Artists don't see early-stage enquiries.
    where: { agencyId: user.agencyId, artistId: user.artistId, status: { notIn: ["ENQUIRY"] } },
    include: { venue: true, checkIns: true },
    orderBy: { arriveBy: "asc" },
  });
  const rows = bookings.map((b) => ({ b, a: arrivalFor(b, settings, now), w: checkInWindow(b.arriveBy, b.setStart, b.setEnd) }));
  // "Current" gigs: not cancelled and check-in hasn't closed.
  const current = rows.filter((r) => r.b.status !== "CANCELLED" && r.w.closesAt > now);
  const past = rows.filter((r) => r.w.closesAt <= now || r.b.status === "CANCELLED").reverse();
  const next = current[0];
  const stats = punctuality(past.map((r) => r.a));

  return (
    <div className="space-y-6">
      {next ? (
        <section className="card overflow-hidden">
          <div className="bg-gradient-to-br from-brand-600 to-indigo-500 p-5 text-white">
            <div className="text-xs font-semibold tracking-wide text-white/80 uppercase">Next gig</div>
            <div className="mt-1 text-2xl font-bold">{next.b.venue?.name ?? "Venue to be confirmed"}</div>
            <div className="text-white/90">
              {formatDate(next.b.arriveBy, next.b.timezone)}
              {next.b.venue?.city ? ` · ${next.b.venue.city}` : ""}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                ["Arrive by", localTime(next.b.arriveBy, next.b.timezone)],
                ["Soundcheck", next.b.soundcheckAt ? localTime(next.b.soundcheckAt, next.b.timezone) : "–"],
                ["On stage", localTime(next.b.setStart, next.b.timezone)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-white/15 py-2">
                  <div className="text-[11px] text-white/80 uppercase">{k}</div>
                  <div className="text-lg font-bold">{v}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <ArrivalBadge state={next.a.state} />
              <Link href={`/app/gigs/${next.b.id}`} className="link text-sm">
                Full details
              </Link>
            </div>
            {arrivalDetail(next.a, next.b.timezone) && <p className="text-sm">{arrivalDetail(next.a, next.b.timezone)}</p>}
            <CheckInPanel
              bookingId={next.b.id}
              hasArrived={next.b.checkIns.some((c) => c.kind === "ARRIVED")}
              hasDeparted={next.b.checkIns.some((c) => c.kind === "DEPARTED")}
              windowOpen={now >= next.w.opensAt}
              windowMessage={`Check-in opens ${formatDate(next.w.opensAt, next.b.timezone)} at ${localTime(next.w.opensAt, next.b.timezone)}, 12 hours before your call time.`}
            />
          </div>
        </section>
      ) : (
        <div className="card card-pad text-center text-slate-500">No upcoming gigs. Enjoy the time off!</div>
      )}

      {current.length > 1 && (
        <section>
          <h2 className="section-title mb-2">Coming up</h2>
          <ul className="card divide-y divide-slate-100">
            {current.slice(1).map(({ b }) => (
              <li key={b.id}>
                <Link href={`/app/gigs/${b.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{b.venue?.name ?? "Venue to be confirmed"}</div>
                    <div className="text-xs text-slate-500">
                      {formatDate(b.arriveBy, b.timezone)} · arrive by {localTime(b.arriveBy, b.timezone)}
                    </div>
                  </div>
                  <StatusBadge status={b.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats.tracked > 0 && (
        <section className="card card-pad">
          <h2 className="section-title">Your timekeeping</h2>
          <p className="mt-1 text-sm text-slate-600">
            On time for <strong>{stats.onTime}</strong> of your last <strong>{stats.tracked}</strong> gigs
            {stats.onTimeRate != null ? ` (${Math.round(stats.onTimeRate * 100)}%)` : ""}.
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((stats.onTimeRate ?? 0) * 100)}%` }} />
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="section-title mb-2">Past gigs</h2>
          <ul className="card divide-y divide-slate-100">
            {past.slice(0, 20).map(({ b, a }) => (
              <li key={b.id}>
                <Link href={`/app/gigs/${b.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{b.venue?.name ?? "No venue"}</div>
                    <div className="text-xs text-slate-500">{formatDate(b.arriveBy, b.timezone)}</div>
                  </div>
                  <ArrivalBadge state={a.state} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
