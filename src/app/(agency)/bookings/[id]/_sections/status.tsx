import Link from "next/link";
import { resendOffer, setBookingStatus } from "@/actions/bookings";
import { CopyField } from "@/components/client-bits";
import { ActionForm, SubmitButton } from "@/components/forms";
import { appUrl } from "@/lib/messaging";
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/time";
import type { BookingPageData, BookingView } from "../_data";

/** The status picker, plus asking acts if they're free (no act yet) or the offer to the act. */
export function StatusSection({
  booking,
  asked,
  askedCounts,
}: {
  booking: BookingView;
  asked: BookingPageData["asked"];
  askedCounts: BookingPageData["askedCounts"];
}) {
  const tz = booking.timezone;
  return (
    <section className="card card-pad">
      <h2 className="section-title mb-3">Status</h2>
      <ActionForm action={setBookingStatus.bind(null, booking.id)} className="flex flex-wrap gap-2">
        <select name="status" defaultValue={booking.status} className="input min-w-0 flex-1">
          {BOOKING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {BOOKING_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <SubmitButton className="btn">Update</SubmitButton>
      </ActionForm>
      <p className="hint">Pending → Awaiting confirmation (the act is offered the booking) → Confirmed when they accept.</p>
      {!booking.artistId && booking.status !== "CANCELLED" && (
        <div className="mt-4 space-y-2 border-t border-ink-100 pt-4 text-sm">
          {asked && askedCounts ? (
            <>
              <p className="text-ink-600">
                Asked {asked.replies.length} act{asked.replies.length === 1 ? "" : "s"} if they&apos;re free: {askedCounts.yes} free, {askedCounts.waiting}{" "}
                waiting.
              </p>
              <Link href={`/availability/${asked.id}`} className="btn w-full">
                See answers or ask more
              </Link>
            </>
          ) : (
            <Link href={`/availability/new?bookingId=${booking.id}`} className="btn w-full">
              Ask acts if they&apos;re free
            </Link>
          )}
        </div>
      )}
      {booking.customerToldAt && (
        <p className="mt-2 text-xs font-medium text-emerald-700">Customer told it&apos;s confirmed, {formatDateTime(booking.customerToldAt, tz)}</p>
      )}
      {booking.artistId && (booking.status === "AWAITING" || booking.offerResponse) && (
        <div className="mt-4 border-t border-ink-100 pt-4 text-sm">
          <div className="font-medium">
            {booking.offerResponse === "ACCEPTED"
              ? "Accepted by the act"
              : booking.offerResponse === "DECLINED"
                ? "Declined by the act"
                : booking.offeredAt
                  ? "Waiting for the act to answer"
                  : "Offer not sent yet"}
          </div>
          <div className={`text-xs ${booking.offerResponse === "DECLINED" ? "font-medium text-rose-700" : "text-ink-500"}`}>
            {booking.respondedAt ? formatDateTime(booking.respondedAt, tz) : booking.offeredAt ? `Offered ${formatDateTime(booking.offeredAt, tz)}` : ""}
          </div>
          {booking.offerToken && booking.status === "AWAITING" && (
            <div className="mt-3">
              <CopyField value={`${appUrl()}/o/${booking.offerToken}`} />
            </div>
          )}
          {booking.status === "AWAITING" && (
            <ActionForm action={resendOffer.bind(null, booking.id)} className="mt-2">
              <SubmitButton className="btn w-full" pendingText="Sending…">
                {booking.offeredAt ? "Send the offer again" : "Send the offer"}
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      )}
    </section>
  );
}
