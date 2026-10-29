import { headers } from "next/headers";
import Link from "next/link";
import { CalendarConnect } from "@/components/calendar-connect";
import { arrivalDetail } from "@/components/arrival-panel";
import { CheckInPanel } from "@/components/check-in-panel";
import { PushSetup } from "@/components/push-setup";
import { ArrivalBadge, StatusBadge } from "@/components/ui";
import { checkInWindow, punctuality } from "@/lib/arrival";
import { requireUser } from "@/lib/auth";
import { arrivalFor } from "@/lib/bookings";
import { vapidKeys } from "@/lib/push";
import { getSettings, prisma } from "@/lib/db";
import { formatDate, localTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ArtistHome() {
  const user = await requireUser(["ARTIST"]);
  if (!user.artistId) return <p className="text-sm text-ink-400">Your login isn&apos;t linked to an artist. Ask your agent to check it.</p>;
  const settings = await getSettings(user.agencyId);
  const now = new Date();
  const artist = await prisma.artist.findFirst({
    where: { id: user.artistId, agencyId: user.agencyId },
    select: { calendarToken: true, name: true },
  });
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const pushKey = (await vapidKeys()).publicKey;
  const feedUrl = artist ? `${proto}://${host}/api/calendar/${artist.calendarToken}.ics` : null;

  const bookings = await prisma.booking.findMany({
    // Artists don't see early-stage enquiries.
    where: {
      agencyId: user.agencyId,
      artistId: user.artistId,
      status: { notIn: ["ENQUIRY"] },
    },
    include: { venue: true, checkIns: true },
    orderBy: { arriveBy: "asc" },
  });
  const rows = bookings.map((b) => ({
    b,
    a: arrivalFor(b, settings, now),
    w: checkInWindow(b.arriveBy, b.setStart, b.setEnd),
  }));
  // "Current" gigs: not cancelled and check-in hasn't closed.
  const current = rows.filter((r) => r.b.status !== "CANCELLED" && r.w.closesAt > now);
  const past = rows.filter((r) => r.w.closesAt <= now || r.b.status === "CANCELLED").reverse();
  const next = current[0];
  const stats = punctuality(past.map((r) => r.a));

  const timeTile = (k: string, v: string, accent = false) => (
    <div key={k} className="rounded-xl bg-white/[0.04] px-3 py-3">
      <div className="text-[11px] text-ink-400">{k}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${accent ? "text-volt-400" : "text-white"}`}>{v}</div>
    </div>
  );

  return (
    <div className="space-y-8">
      {next ? (
        <section className="overflow-hidden rounded-3xl border border-white/[0.06] bg-ink-900">
          <div className="p-5 pb-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium tracking-wide text-volt-400 uppercase">Next gig</span>
              <ArrivalBadge state={next.a.state} />
            </div>
            <div className="mt-3 text-[28px] leading-tight font-semibold tracking-tight">{next.b.venue?.name ?? "Venue to be confirmed"}</div>
            <div className="mt-1 text-ink-400">
              {formatDate(next.b.arriveBy, next.b.timezone)}
              {next.b.venue?.city ? ` · ${next.b.venue.city}` : ""}
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {timeTile("Arrive by", localTime(next.b.arriveBy, next.b.timezone), true)}
              {timeTile("Soundcheck", next.b.soundcheckAt ? localTime(next.b.soundcheckAt, next.b.timezone) : "–")}
              {timeTile("On stage", localTime(next.b.setStart, next.b.timezone))}
            </div>
          </div>
          <div className="space-y-3 border-t border-white/[0.06] p-5">
            {arrivalDetail(next.a, next.b.timezone) && <p className="text-sm text-ink-300">{arrivalDetail(next.a, next.b.timezone)}</p>}
            <CheckInPanel
              bookingId={next.b.id}
              hasArrived={next.b.checkIns.some((c) => c.kind === "ARRIVED")}
              hasDeparted={next.b.checkIns.some((c) => c.kind === "DEPARTED")}
              windowOpen={now >= next.w.opensAt}
              windowMessage={`Check-in opens ${formatDate(next.w.opensAt, next.b.timezone)} at ${localTime(next.w.opensAt, next.b.timezone)}, 12 hours before your call time.`}
            />
            <Link href={`/app/gigs/${next.b.id}`} className="block pt-1 text-center text-sm text-ink-400 hover:text-white">
              Directions, itinerary and contacts →
            </Link>
          </div>
        </section>
      ) : (
        <div className="rounded-3xl border border-white/[0.06] bg-ink-900 p-8 text-center text-ink-400">No upcoming gigs. Enjoy the time off!</div>
      )}

      {current.length > 1 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-ink-400">Coming up</h2>
          <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.06] bg-ink-900">
            {current.slice(1).map(({ b }) => (
              <li key={b.id}>
                <Link href={`/app/gigs/${b.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-white/[0.03]">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{b.venue?.name ?? "Venue to be confirmed"}</div>
                    <div className="text-xs text-ink-400">
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

      <PushSetup publicKey={pushKey} />

      {feedUrl && <CalendarConnect feedUrl={feedUrl} name={`${artist!.name} gigs`} />}

      {stats.tracked > 0 && (
        <section className="rounded-2xl border border-white/[0.06] bg-ink-900 p-5">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-sm font-medium text-ink-400">Your timekeeping</h2>
              <p className="mt-1 text-sm">
                On time for {stats.onTime} of your last {stats.tracked} gigs
              </p>
            </div>
            <div className="text-3xl font-semibold text-volt-400 tabular-nums">{Math.round((stats.onTimeRate ?? 0) * 100)}%</div>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-volt-400" style={{ width: `${Math.round((stats.onTimeRate ?? 0) * 100)}%` }} />
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-ink-400">Past gigs</h2>
          <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.06] bg-ink-900">
            {past.slice(0, 20).map(({ b, a }) => (
              <li key={b.id}>
                <Link href={`/app/gigs/${b.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-white/[0.03]">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{b.venue?.name ?? "No venue"}</div>
                    <div className="text-xs text-ink-400">{formatDate(b.arriveBy, b.timezone)}</div>
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
