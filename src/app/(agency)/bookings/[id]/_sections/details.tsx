import Link from "next/link";
import { DefinitionList } from "@/components/ui";
import { eventTypeLabel } from "@/lib/constants";
import { formatDateTime, localTime } from "@/lib/time";
import type { BookingView } from "../_data";

export function ScheduleSection({ booking, zone }: { booking: BookingView; zone: string }) {
  const tz = booking.timezone;
  return (
    <section className="card card-pad">
      <h2 className="section-title mb-4">Schedule ({zone})</h2>
      <DefinitionList
        items={[
          ["Arrive by", formatDateTime(booking.arriveBy, tz)],
          ["Soundcheck", booking.soundcheckAt ? localTime(booking.soundcheckAt, tz) : ""],
          ["On stage", formatDateTime(booking.setStart, tz)],
          ["Off stage", booking.setEnd ? formatDateTime(booking.setEnd, tz) : ""],
        ]}
      />
    </section>
  );
}

export function DetailsSection({ booking }: { booking: BookingView }) {
  return (
    <section className="card card-pad">
      <h2 className="section-title mb-4">Details</h2>
      <DefinitionList
        items={[
          [
            "Venue",
            booking.venue ? (
              <Link href={`/venues/${booking.venue.id}`} className="link">
                {booking.venue.name}
              </Link>
            ) : (
              ""
            ),
          ],
          [
            "Who pays",
            booking.promoter ? (
              <Link href={`/contacts/${booking.promoter.id}`} className="link">
                {booking.promoter.name}
                {booking.promoter.company ? ` (${booking.promoter.company})` : ""}
              </Link>
            ) : (
              ""
            ),
          ],
          ["Booking type", eventTypeLabel(booking.eventType)],
          ["Lead agent", booking.agent?.name ?? ""],
          ["Tags", booking.tags],
          ["Travel", booking.travel],
          ["Accommodation", booking.accommodation],
          ["Day of show contact", booking.dayContact],
          ["Hospitality", booking.hospitality],
          ["Internal notes", booking.notes],
          ["Radius clause", booking.radiusKm !== null ? `${booking.radiusKm} km, ${booking.radiusDays} days either side` : ""],
        ]}
      />
    </section>
  );
}
