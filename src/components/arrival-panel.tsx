import type { CheckIn, Settings, Venue } from "@prisma/client";
import { ArrivalBadge } from "@/components/ui";
import { LOCATION_LABELS, formatDistance, type ArrivalSummary } from "@/lib/arrival";
import { formatDateTime, formatMinutes, localTime, zoneLabel } from "@/lib/time";

/** Plain-English summary of an arrival, e.g. "12 min late" or "5 min early". */
export function arrivalDetail(a: ArrivalSummary, timezone: string): string {
  switch (a.state) {
    case "ARRIVED_ON_TIME":
    case "ARRIVED_LATE": {
      const m = a.minutesLate ?? 0;
      const when = `at ${localTime(a.arrivedAt!, timezone)}`;
      if (m === 0) return `Arrived ${when}, bang on time`;
      return `Arrived ${when}, ${formatMinutes(m)} ${m < 0 ? "early" : "late"}`;
    }
    case "OVERDUE":
      return `${formatMinutes(a.minutesOverdue ?? 0)} past call time${a.expectedAt ? `, said they'd arrive ${localTime(a.expectedAt, timezone)}` : ""}`;
    case "ON_THE_WAY":
      return a.expectedAt ? `Expected at ${localTime(a.expectedAt, timezone)}` : "Travelling now";
    case "NO_CHECK_IN":
      return "The gig has finished and no arrival was recorded";
    default:
      return "";
  }
}

export function ArrivalPanel({
  booking,
  arrival,
  settings,
}: {
  booking: { arriveBy: Date; timezone: string; venue: Venue | null; checkIns: CheckIn[] };
  arrival: ArrivalSummary;
  settings: Settings;
}) {
  const tz = booking.timezone;
  const arrivedCheckIn = booking.checkIns.find((c) => c.kind === "ARRIVED");
  const highlight =
    arrival.state === "OVERDUE"
      ? "border-rose-300 ring-2 ring-rose-100"
      : arrival.state === "ARRIVED_ON_TIME"
        ? "border-emerald-200"
        : "";

  return (
    <section className={`card card-pad ${highlight}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">Arrival</h2>
          <p className="text-sm text-slate-500">
            Call time {formatDateTime(booking.arriveBy, tz)} {zoneLabel(booking.arriveBy, tz)} · late after {settings.lateGraceMinutes} min
          </p>
        </div>
        <ArrivalBadge state={arrival.state} />
      </div>
      {arrivalDetail(arrival, tz) && <p className="mt-3 text-lg font-medium">{arrivalDetail(arrival, tz)}</p>}

      {arrival.location && (
        <p className="mt-2 text-sm text-slate-600">
          <span
            className={`badge mr-2 ${
              arrival.location === "ON_SITE"
                ? "bg-emerald-100 text-emerald-800"
                : arrival.location === "OFF_SITE"
                  ? "bg-rose-100 text-rose-800"
                  : "bg-slate-100 text-slate-600"
            }`}
          >
            {LOCATION_LABELS[arrival.location]}
          </span>
          {arrival.distanceM !== null && `${formatDistance(arrival.distanceM)} from the venue when they checked in. `}
          {arrivedCheckIn?.latitude != null && arrivedCheckIn.longitude != null && (
            <a
              className="link"
              target="_blank"
              rel="noreferrer"
              href={`https://www.google.com/maps/search/?api=1&query=${arrivedCheckIn.latitude},${arrivedCheckIn.longitude}`}
            >
              See on map
            </a>
          )}
        </p>
      )}
      {arrival.departedAt && <p className="mt-2 text-sm text-slate-600">Left the venue at {localTime(arrival.departedAt, tz)}.</p>}
    </section>
  );
}
