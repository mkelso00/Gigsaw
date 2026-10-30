import { headers } from "next/headers";
import Link from "next/link";
import { CalendarConnect } from "@/components/calendar-connect";
import { arrivalDetail } from "@/components/arrival-panel";
import { AvailabilityAnswer } from "@/components/availability-answer";
import { CheckInPanel } from "@/components/check-in-panel";
import { InAppOffer } from "@/components/in-app-offer";
import { PushSetup } from "@/components/push-setup";
import { ArrivalBadge, StatusBadge } from "@/components/ui";
import { checkInWindow, punctuality } from "@/lib/arrival";
import { requireUser } from "@/lib/auth";
import { canAnswer, formatRange, requestTimes } from "@/lib/availability";
import { requestPlace } from "@/lib/availability-requests";
import { arrivalFor } from "@/lib/bookings";
import { actIdsFor } from "@/lib/people";
import { personName } from "@/lib/person-name";
import { vapidKeys } from "@/lib/push";
import { getSettings, prisma } from "@/lib/db";
import { dealBreakdown, formatMoney } from "@/lib/money";
import { addDaysToKey, formatDate, localDateKey, localTime } from "@/lib/time";
import { actName, ACT_VISIBLE } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function ArtistHome() {
  const user = await requireUser(["ARTIST"]);
  // A person's login sees every act they're in; an act's own login sees that act.
  const actIds = await actIdsFor(user);
  if (!actIds.length) return <p className="text-sm text-ink-400">Your login isn&apos;t linked to an act yet. Ask your agent to check it.</p>;
  const now = new Date();
  const settings = await getSettings(user.agencyId);
  const today = localDateKey(now, settings.defaultTimezone);
  const [feedOwner, keys, bookings, asks, awayCount] = await Promise.all([
    user.personId
      ? prisma.person.findFirst({
          where: { id: user.personId, agencyId: user.agencyId },
          select: { calendarToken: true, firstName: true, surname: true, alias: true },
        })
      : prisma.artist.findFirst({ where: { id: user.artistId!, agencyId: user.agencyId }, select: { calendarToken: true, name: true } }),
    vapidKeys(),
    prisma.booking.findMany({
      // Artists don't see early-stage enquiries.
      where: {
        agencyId: user.agencyId,
        artistId: { in: actIds },
        status: { in: ACT_VISIBLE },
      },
      include: {
        venue: { select: { name: true, city: true, latitude: true, longitude: true } },
        checkIns: { select: { kind: true, at: true, source: true, distanceM: true, etaMinutes: true } },
        artist: { select: { name: true } },
      },
      orderBy: { arriveBy: "asc" },
    }),
    // "Are you free?" questions still open. Only the date, times, place, note and the act's own fee.
    prisma.availabilityReply.findMany({
      where: { artistId: { in: actIds }, request: { agencyId: user.agencyId, closedAt: null, date: { gte: addDaysToKey(today, -1) } } },
      select: {
        id: true,
        answer: true,
        note: true,
        artist: { select: { name: true } },
        request: {
          select: {
            date: true,
            timezone: true,
            closedAt: true,
            arriveTime: true,
            startTime: true,
            endTime: true,
            place: true,
            note: true,
            costMinor: true,
            currency: true,
            venue: { select: { name: true, city: true } },
          },
        },
      },
      orderBy: { request: { date: "asc" } },
    }),
    prisma.artistUnavailability.count({ where: { agencyId: user.agencyId, artistId: { in: actIds }, endDate: { gte: today } } }),
  ]);
  const openAsks = asks.filter((a) => canAnswer(a.request, localDateKey(now, a.request.timezone)));
  const unanswered = openAsks.filter((a) => !a.answer).length;
  const feedName = feedOwner ? ("name" in feedOwner ? feedOwner.name : personName(feedOwner)) : "";
  const manyActs = actIds.length > 1 || !!user.personId;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const pushKey = keys.publicKey;
  const feedUrl = feedOwner ? `${proto}://${host}/api/calendar/${feedOwner.calendarToken}.ics` : null;

  const rows = bookings.map((b) => ({
    b,
    a: arrivalFor(b, settings, now),
    w: checkInWindow(b.arriveBy, b.setStart, b.setEnd),
  }));
  // "Current" gigs: not cancelled and check-in hasn't closed.
  // Offers still waiting for an answer sit at the top; they aren't "your gigs" until accepted.
  const offers = rows.filter((r) => r.b.status === "AWAITING" && r.b.offerResponse !== "DECLINED" && r.w.closesAt > now);
  const current = rows.filter((r) => r.b.status !== "CANCELLED" && r.b.status !== "AWAITING" && r.w.closesAt > now);
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
      {openAsks.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-volt-400">
            {unanswered ? `Are you free? · ${unanswered === 1 ? "1 question" : `${unanswered} questions`} to answer` : "Are you free? · you've answered"}
          </h2>
          <div className="space-y-3">
            {openAsks.map((a) => {
              const r = a.request;
              const where = requestPlace(r);
              const times = requestTimes(r);
              return (
                <div key={a.id} className={`rounded-2xl border bg-ink-900 p-5 ${a.answer ? "border-white/[0.06]" : "border-volt-400/40"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-lg font-semibold">{formatRange(r.date, r.date)}</div>
                      <div className="text-sm text-ink-400">
                        {[times, where, manyActs ? a.artist.name : ""].filter(Boolean).join(" · ") || "Times and place to follow"}
                      </div>
                    </div>
                    {r.costMinor ? (
                      <div className="shrink-0 text-lg font-semibold text-volt-400 tabular-nums">{formatMoney(r.costMinor, r.currency)}</div>
                    ) : null}
                  </div>
                  {r.note && <p className="mt-3 text-sm whitespace-pre-line text-ink-300">{r.note}</p>}
                  <div className="mt-4">
                    <AvailabilityAnswer replyId={a.id} answer={a.answer} note={a.note} dark />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {offers.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-volt-400">
            {offers.length === 1 ? "New gig offer" : `${offers.length} gig offers`} · please accept or decline
          </h2>
          <div className="space-y-3">
            {offers.map(({ b }) => {
              const fee = dealBreakdown(b).artistMinor;
              return (
                <div key={b.id} className="rounded-2xl border border-volt-400/40 bg-ink-900 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-semibold">{b.venue?.name ?? "Venue to be confirmed"}</div>
                      <div className="text-sm text-ink-400">
                        {formatDate(b.arriveBy, b.timezone)} · on {localTime(b.setStart, b.timezone)}
                        {b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}
                        {manyActs ? ` · ${actName(b)}` : ""}
                      </div>
                    </div>
                    {fee > 0 && <div className="shrink-0 text-lg font-semibold text-volt-400 tabular-nums">{formatMoney(fee, b.currency)}</div>}
                  </div>
                  <InAppOffer bookingId={b.id} />
                </div>
              );
            })}
          </div>
        </section>
      )}
      {next ? (
        <section className="overflow-hidden rounded-3xl border border-white/[0.06] bg-ink-900">
          <div className="p-5 pb-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium tracking-wide text-volt-400 uppercase">Next gig{manyActs ? ` · ${actName(next.b)}` : ""}</span>
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
                      {manyActs ? `${actName(b)} · ` : ""}
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

      <Link
        href="/app/availability"
        className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-ink-900 px-5 py-4 hover:bg-white/[0.03]"
      >
        <span className="min-w-0">
          <span className="block font-medium">Dates you can&apos;t play</span>
          <span className="block text-sm text-ink-400">
            {awayCount ? `${awayCount} coming up. Add or change them here.` : "Going on holiday or busy with other work? Let us know."}
          </span>
        </span>
        <span className="shrink-0 text-ink-400" aria-hidden>
          →
        </span>
      </Link>

      <PushSetup publicKey={pushKey} />

      {feedUrl && <CalendarConnect feedUrl={feedUrl} name={`${feedName} gigs`} />}

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
                    <div className="truncate font-medium">
                      {b.venue?.name ?? "No venue"}
                      {manyActs ? <span className="font-normal text-ink-400"> · {actName(b)}</span> : null}
                    </div>
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
