import Link from "next/link";
import { DropMenu } from "@/components/header-actions";
import { setBookingArchived } from "@/actions/bookings";
import { CopyBooking } from "@/components/copy-booking";
import { ServerForm } from "@/components/forms";
import { ArtistDot, PageHeader, StatusBadge } from "@/components/ui";
import { eventTypeLabel, actName } from "@/lib/constants";
import { formatDate, localDateKey, localTime, formatMinutes } from "@/lib/time";
import type { BookingPageData, BookingView } from "../_data";

export function BookingHeader({ booking }: { booking: BookingView }) {
  const tz = booking.timezone;
  return (
    <PageHeader
      title={
        <span className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2">
            <ArtistDot colour={booking.artist?.colour ?? "#a2a199"} />
            {actName(booking)}
          </span>
          <StatusBadge status={booking.status} />
        </span>
      }
      subtitle={
        <>
          {booking.reference} · {eventTypeLabel(booking.eventType)} · {formatDate(booking.arriveBy, tz)}
          {booking.venue ? ` · ${booking.venue.name}${booking.venue.city ? `, ${booking.venue.city}` : ""}` : ""}
          {booking.event ? (
            <>
              {" · "}
              <Link href={`/events/${booking.event.id}`} className="link">
                Part of {booking.event.name}
              </Link>
            </>
          ) : booking.eventName ? (
            ` · ${booking.eventName}`
          ) : (
            ""
          )}
        </>
      }
      actions={
        <>
          <Link href={`/bookings/${booking.id}/edit`} className="btn">
            Edit
          </Link>
          <CopyBooking
            bookingId={booking.id}
            startDate={localDateKey(booking.arriveBy, tz)}
            today={localDateKey(new Date(), tz)}
            hasAct={!!booking.artistId}
            actName={actName(booking)}
          />
          {/* The printable documents sit in one menu, so the top of the page stays quiet. Archive is at the foot of the page. */}
          <DropMenu label="Print">
            <a href={`/print/bookings/${booking.id}/contract`} target="_blank">
              Contract
            </a>
            <a href={`/print/bookings/${booking.id}/invoice`} target="_blank">
              Invoice
            </a>
            <a href={`/print/bookings/${booking.id}/itinerary`} target="_blank">
              Itinerary for the act
            </a>
          </DropMenu>
          {booking.archivedAt && (
            <ServerForm action={setBookingArchived.bind(null, booking.id, false)}>
              <button className="btn">Restore</button>
            </ServerForm>
          )}
        </>
      }
    />
  );
}

/** The banners above the page: archived, or the act is late for the call time. */
export function BookingBanners({ booking, arrival }: { booking: BookingView; arrival: BookingPageData["arrival"] }) {
  const tz = booking.timezone;
  return (
    <>
      {booking.archivedAt && (
        <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <strong>Archived</strong> on {formatDate(booking.archivedAt, tz)}. It isn&apos;t in your lists, calendar or reports, and the act doesn&apos;t see it.
          Press Restore to bring it back.
        </div>
      )}
      {arrival.state === "OVERDUE" && !booking.archivedAt && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl bg-rose-600 px-6 py-5 text-white shadow-lg shadow-rose-900/20"
        >
          <span className="relative flex h-4 w-4 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#fff] opacity-60" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-[#fff]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-2xl font-bold tracking-tight">Overdue{arrival.minutesOverdue ? `: ${formatMinutes(arrival.minutesOverdue)} late` : ""}</div>
            <div className="mt-0.5 text-[15px] text-white/90">
              {actName(booking)} hasn&apos;t checked in. Call time was {localTime(booking.arriveBy, tz)}
              {arrival.expectedAt ? `; they said they'd arrive at ${localTime(arrival.expectedAt, tz)}` : ""}.
            </div>
          </div>
          {booking.artist?.phone && (
            <a
              href={`tel:${booking.artist.phone.replace(/\s/g, "")}`}
              className="btn h-12 border-[#fff] bg-[#fff] px-6 text-base font-semibold text-[#be123c] hover:bg-[#fff1f2]"
            >
              Call {booking.artist.phone}
            </a>
          )}
        </div>
      )}
    </>
  );
}
