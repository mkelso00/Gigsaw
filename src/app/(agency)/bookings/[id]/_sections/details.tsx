import Link from "next/link";
import { DefinitionList } from "@/components/ui";
import { eventTypeLabel } from "@/lib/constants";
import { formatDateTime, localTime } from "@/lib/time";
import type { BookingPageData, BookingView } from "../_data";

/**
 * The client's lead contact: who the client's messages go to (src/lib/client-recipient.ts), with how to reach them and
 * why it's them (chosen on the booking, the venue's or the company's), or what happens when there's nobody.
 */
function ClientLead({ booking, client }: { booking: BookingView; client: BookingPageData["client"] }) {
  const r = client.dayToDay;
  const reach = [r.phone, r.email].filter(Boolean).join(" · ");
  const lead = r.source === "BOOKING" || r.source === "VENUE" || r.source === "COMPANY";
  return (
    <span data-testid="client-lead" className="block">
      {lead && r.personId ? (
        <>
          <Link href={`/people/${r.personId}`} className="link">
            {r.name}
          </Link>
          <span className="text-ink-500">
            {r.source === "BOOKING" ? "" : r.source === "VENUE" ? ` (${booking.venue?.name}'s lead contact)` : " (the company's lead contact)"}
          </span>
        </>
      ) : r.source === "CUSTOMER" ? (
        <span className="text-ink-500">None: messages go to the customer, {r.name}</span>
      ) : r.source === "PAYER" ? (
        <span className="text-ink-500">None: messages go to {r.name}, who pays</span>
      ) : (
        <span className="text-ink-500">None</span>
      )}
      {lead && reach && <span className="block text-xs text-ink-500">{reach}</span>}
      {r.hint && <span className="block text-xs text-amber-700">{r.hint}</span>}
      {!lead && client.documents.hint && <span className="block text-xs text-ink-500">{client.documents.hint}</span>}
    </span>
  );
}

export function ScheduleSection({ booking, zone }: { booking: BookingView; zone: string }) {
  const tz = booking.timezone;
  return (
    <section className="card card-pad">
      <h2 className="section-title mb-4">Schedule ({zone})</h2>
      <DefinitionList
        items={[
          ["Arrive by", formatDateTime(booking.arriveBy, tz)],
          ["Soundcheck", booking.soundcheckAt ? localTime(booking.soundcheckAt, tz) : ""],
          ["Start", formatDateTime(booking.setStart, tz)],
          ["Finish", booking.setEnd ? formatDateTime(booking.setEnd, tz) : ""],
        ]}
      />
      {/* Weekly residencies change together: point to both ways of doing that from here. */}
      {booking.venue && (
        <p className="mt-4 border-t border-ink-100 pt-3 text-sm text-ink-500">
          Changing more than this gig at {booking.venue.name}?{" "}
          <Link href={`/bookings/${booking.id}/edit`} className="link">
            Edit
          </Link>{" "}
          and choose which other bookings change too, or{" "}
          <Link href={`/bookings?venue=${booking.venue.id}`} className="link">
            change several bookings at once
          </Link>
          .
        </p>
      )}
    </section>
  );
}

export function DetailsSection({ booking, client }: { booking: BookingView; client: BookingPageData["client"] }) {
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
          ["Client's lead contact", <ClientLead key="lead" booking={booking} client={client} />],
          ["Booking type", eventTypeLabel(booking.eventType)],
          [
            "Lead agent",
            // Who looks after it, and who booked it in: the history at a glance (the activity log has the rest).
            booking.agent || booking.createdBy ? (
              <span key="agent" data-testid="lead-agent">
                {booking.agent?.name ?? <span className="text-ink-300">Not set</span>}
                {booking.createdBy && <span className="text-ink-500"> · Booked by {booking.createdBy.name}</span>}
              </span>
            ) : (
              ""
            ),
          ],
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
