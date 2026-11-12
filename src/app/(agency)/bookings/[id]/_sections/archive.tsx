import { deleteBooking, setBookingArchived } from "@/actions/bookings";
import { ConfirmButton, ServerForm } from "@/components/forms";
import type { BookingView } from "../_data";

/** The foot of the page: archive a live booking, or (admins only) delete an archived one for good. */
export function ArchiveActions({ booking, isAdmin }: { booking: BookingView; isAdmin: boolean }) {
  return booking.archivedAt ? (
    isAdmin && (
      <ServerForm action={deleteBooking.bind(null, booking.id)}>
        <ConfirmButton message={`Delete ${booking.reference} for good? This removes its payments and check-ins too.`} className="btn btn-danger w-full">
          Delete for good
        </ConfirmButton>
      </ServerForm>
    )
  ) : (
    <ServerForm action={setBookingArchived.bind(null, booking.id, true)}>
      <ConfirmButton message={`Archive ${booking.reference}? It leaves your lists and calendar. You can restore it from Archived.`} className="btn w-full">
        Archive booking
      </ConfirmButton>
    </ServerForm>
  );
}
