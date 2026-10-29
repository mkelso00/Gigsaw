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
import { dealBreakdown, formatMoney } from "@/lib/money";
import { formatDate, localTime, zoneLabel } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ArtistGigPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["ARTIST"]);
  const { id } = await params;
  const [b, settings] = await Promise.all([
    prisma.booking.findFirst({ where: { id, agencyId: user.agencyId }, include: { venue: true, promoter: true, agent: true, checkIns: { orderBy: { at: "asc" } } } }),
    getSettings(user.agencyId),
  ]);
  if (!b || b.artistId !== user.artistId || b.status === "ENQUIRY") notFound();

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
  const yourFee = dealBreakdown(b).artistMinor;

  return (
    <div className="space-y-5">
      <Link href="/app" className="text-sm text-slate-500">
        ← All gigs
      </Link>
      <div>
        <div className="flex items-center gap-2">
          <StatusBadge status={b.status} />
          <ArrivalBadge state={a.state} />
        </div>
        <h1 className="mt-2 text-2xl font-bold">{v?.name ?? "Venue to be confirmed"}</h1>
        <p className="text-slate-600">
          {formatDate(b.arriveBy, tz)} · {eventTypeLabel(b.eventType)}
          {b.eventName ? ` · ${b.eventName}` : ""}
        </p>
      </div>

      {b.status !== "CANCELLED" && (
        <section className="card card-pad space-y-3">
          <h2 className="section-title">Check in</h2>
          {arrivalDetail(a, tz) && <p className="text-sm">{arrivalDetail(a, tz)}</p>}
          <CheckInPanel
            bookingId={b.id}
            hasArrived={b.checkIns.some((c) => c.kind === "ARRIVED")}
            hasDeparted={b.checkIns.some((c) => c.kind === "DEPARTED")}
            windowOpen={now >= w.opensAt && now <= w.closesAt}
            windowMessage={
              now < w.opensAt
                ? `Check-in opens ${formatDate(w.opensAt, tz)} at ${localTime(w.opensAt, tz)}.`
                : "Check-in for this gig has closed."
            }
          />
          {b.checkIns.length > 0 && (
            <ul className="border-t border-slate-100 pt-3 text-sm text-slate-600">
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

      <section className="card card-pad">
        <h2 className="section-title mb-3">Schedule ({zoneLabel(b.arriveBy, tz)})</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {[
            ["Arrive by", localTime(b.arriveBy, tz)],
            ["Soundcheck", b.soundcheckAt ? localTime(b.soundcheckAt, tz) : "–"],
            ["On stage", localTime(b.setStart, tz)],
            ["Off stage", b.setEnd ? localTime(b.setEnd, tz) : "–"],
          ].map(([k, val]) => (
            <div key={k} className="rounded-lg bg-slate-50 p-3">
              <dt className="text-xs text-slate-500 uppercase">{k}</dt>
              <dd className="text-lg font-semibold">{val}</dd>
            </div>
          ))}
        </dl>
      </section>

      {v && (
        <section className="card card-pad space-y-2 text-sm">
          <h2 className="section-title">Venue</h2>
          <p>{address}</p>
          {v.notes && <p className="whitespace-pre-line text-slate-600">{v.notes}</p>}
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="btn w-full">
              Directions
            </a>
          )}
        </section>
      )}

      <section className="card card-pad space-y-3 text-sm">
        <h2 className="section-title">Itinerary</h2>
        {[
          ["Travel", b.travel],
          ["Accommodation", b.accommodation],
          ["Day of show contact", b.dayContact],
          ["Hospitality", b.hospitality],
          ["Promoter", b.promoter ? `${b.promoter.name}${b.promoter.phone ? ` · ${b.promoter.phone}` : ""}` : ""],
          ["Your agent", b.agent ? `${b.agent.name} · ${b.agent.email}` : ""],
          ["Your fee", yourFee > 0 ? formatMoney(yourFee, b.currency) : ""],
        ]
          .filter(([, val]) => val)
          .map(([k, val]) => (
            <div key={k}>
              <div className="text-xs font-medium text-slate-500 uppercase">{k}</div>
              <div className="whitespace-pre-line">{val}</div>
            </div>
          ))}
        <a href={`/print/bookings/${b.id}/itinerary`} target="_blank" className="link block pt-2">
          Open printable day sheet
        </a>
      </section>
    </div>
  );
}
