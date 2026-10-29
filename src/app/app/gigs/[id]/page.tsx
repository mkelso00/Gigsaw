import Link from "next/link";
import { notFound } from "next/navigation";
import { arrivalDetail } from "@/components/arrival-panel";
import { CheckInPanel } from "@/components/check-in-panel";
import { ArrivalBadge, StatusBadge } from "@/components/ui";
import { checkInWindow } from "@/lib/arrival";
import { requireUser } from "@/lib/auth";
import { arrivalFor } from "@/lib/bookings";
import { CHECK_IN_KIND_LABELS, eventTypeLabel, type CheckInKind } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { PLAN_FIELDS } from "@/lib/event-plan";
import { actIdsFor } from "@/lib/people";
import { dealBreakdown, formatMoney } from "@/lib/money";
import { formatDate, localTime, zoneLabel } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ArtistGigPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["ARTIST"]);
  const { id } = await params;
  const [b, settings] = await Promise.all([
    prisma.booking.findFirst({
      where: { id, agencyId: user.agencyId },
      include: { venue: true, promoter: true, agent: true, artist: { select: { name: true } }, checkIns: { orderBy: { at: "asc" } } },
    }),
    getSettings(user.agencyId),
  ]);
  // Only gigs for the act(s) this login belongs to; never enquiries.
  const actIds = await actIdsFor(user);
  if (!b || !actIds.includes(b.artistId) || b.status === "ENQUIRY") notFound();

  const now = new Date();
  const tz = b.timezone;
  const a = arrivalFor(b, settings, now);
  const w = checkInWindow(b.arriveBy, b.setStart, b.setEnd);
  const v = b.venue;
  const address = v ? [v.name, v.address, v.city, v.country].filter(Boolean).join(", ") : "";
  const mapsUrl = v
    ? v.latitude != null && v.longitude != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${v.latitude},${v.longitude}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
    : null;
  // Acts only ever see their own pay (after commission), never what the venue or customer is charged.
  const yourFee = dealBreakdown(b).artistMinor;
  // Part of a wedding or event: show the plan and who else is on. Never any money.
  const event = b.eventId
    ? await prisma.event.findFirst({
        where: { id: b.eventId, agencyId: user.agencyId },
        include: {
          bookings: {
            where: { id: { not: b.id }, status: { notIn: ["CANCELLED", "ENQUIRY"] } },
            select: { setStart: true, setEnd: true, timezone: true, artist: { select: { name: true } } },
            orderBy: { setStart: "asc" },
          },
        },
      })
    : null;

  const panel = "rounded-2xl border border-white/[0.06] bg-ink-900 p-5";
  return (
    <div className="space-y-5">
      <Link href="/app" className="text-sm text-ink-400 hover:text-white">
        ← All gigs
      </Link>
      <div>
        <div className="flex items-center gap-2">
          <StatusBadge status={b.status} />
          <ArrivalBadge state={a.state} />
        </div>
        <h1 className="mt-3 text-[28px] leading-tight font-semibold tracking-tight">{v?.name ?? "Venue to be confirmed"}</h1>
        <p className="mt-1 text-ink-400">
          {formatDate(b.arriveBy, tz)} · {eventTypeLabel(b.eventType)}
          {b.eventName ? ` · ${b.eventName}` : ""}
        </p>
      </div>

      {b.status !== "CANCELLED" && (
        <section className={`${panel} space-y-3`}>
          <h2 className="text-sm font-medium text-ink-400">Check in</h2>
          {arrivalDetail(a, tz) && <p className="text-sm">{arrivalDetail(a, tz)}</p>}
          <CheckInPanel
            bookingId={b.id}
            hasArrived={b.checkIns.some((c) => c.kind === "ARRIVED")}
            hasDeparted={b.checkIns.some((c) => c.kind === "DEPARTED")}
            windowOpen={now >= w.opensAt && now <= w.closesAt}
            windowMessage={
              now < w.opensAt ? `Check-in opens ${formatDate(w.opensAt, tz)} at ${localTime(w.opensAt, tz)}.` : "Check-in for this gig has closed."
            }
          />
          {b.checkIns.length > 0 && (
            <ul className="space-y-1 border-t border-white/[0.06] pt-3 text-sm text-ink-400">
              {b.checkIns.map((c) => (
                <li key={c.id}>
                  {CHECK_IN_KIND_LABELS[c.kind as CheckInKind] ?? c.kind} at {localTime(c.at, tz)}
                  {c.source === "AGENT" ? " (logged by your agent)" : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className={panel}>
        <h2 className="mb-3 text-sm font-medium text-ink-400">Schedule ({zoneLabel(b.arriveBy, tz)})</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {[
            ["Arrive by", localTime(b.arriveBy, tz)],
            ["Soundcheck", b.soundcheckAt ? localTime(b.soundcheckAt, tz) : "–"],
            ["On stage", localTime(b.setStart, tz)],
            ["Off stage", b.setEnd ? localTime(b.setEnd, tz) : "–"],
          ].map(([k, val], i) => (
            <div key={k} className="rounded-xl bg-white/[0.04] p-3">
              <dt className="text-xs text-ink-400">{k}</dt>
              <dd className={`mt-1 text-xl font-semibold tabular-nums ${i === 0 ? "text-volt-400" : ""}`}>{val}</dd>
            </div>
          ))}
        </dl>
      </section>

      {v && (
        <section className={`${panel} space-y-3 text-sm`}>
          <h2 className="text-sm font-medium text-ink-400">Venue</h2>
          <p>{address}</p>
          {v.notes && <p className="whitespace-pre-line text-ink-400">{v.notes}</p>}
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-11 w-full items-center justify-center rounded-xl bg-white text-sm font-medium text-ink-950 hover:bg-ink-100"
            >
              Get directions
            </a>
          )}
        </section>
      )}

      {event && (
        <section className={`${panel} space-y-4 text-sm`}>
          <div>
            <h2 className="text-sm font-medium text-ink-400">{event.type === "WEDDING" ? "The wedding" : "The event"}</h2>
            <div className="mt-1 text-base font-medium">{event.name}</div>
            {!v && event.venueText && <div className="text-ink-300">{event.venueText}</div>}
          </div>
          {[
            ["Guests", event.guestCount ? String(event.guestCount) : ""],
            ...PLAN_FIELDS.map(([k, label]) => [label, event[k]]),
            [
              "Also performing",
              event.bookings
                .map((o) => `${o.artist.name} ${localTime(o.setStart, o.timezone)}${o.setEnd ? `–${localTime(o.setEnd, o.timezone)}` : ""}`)
                .join("\n"),
            ],
          ]
            .filter(([, val]) => val)
            .map(([k, val]) => (
              <div key={k}>
                <div className="text-xs text-ink-500">{k}</div>
                <div className="mt-0.5 whitespace-pre-line">{val}</div>
              </div>
            ))}
        </section>
      )}

      <section className={`${panel} space-y-4 text-sm`}>
        <h2 className="text-sm font-medium text-ink-400">Itinerary</h2>
        {[
          ["Travel", b.travel],
          ["Accommodation", b.accommodation],
          ["Day of show contact", b.dayContact],
          ["Hospitality", b.hospitality],
          ["Promoter", b.promoter ? `${b.promoter.name}${b.promoter.phone ? ` · ${b.promoter.phone}` : ""}` : ""],
          ["Your agent", b.agent ? `${b.agent.name} · ${b.agent.email}` : ""],
          [user.personId ? `${b.artist.name} fee` : "Your fee", yourFee > 0 ? formatMoney(yourFee, b.currency) : ""],
        ]
          .filter(([, val]) => val)
          .map(([k, val]) => (
            <div key={k}>
              <div className="text-xs text-ink-500">{k}</div>
              <div className="mt-0.5 whitespace-pre-line">{val}</div>
            </div>
          ))}
        <a href={`/print/bookings/${b.id}/itinerary`} target="_blank" className="block pt-1 text-volt-400 underline underline-offset-4">
          Open printable day sheet
        </a>
      </section>
    </div>
  );
}
