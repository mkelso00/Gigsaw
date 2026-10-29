import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { updateBooking } from "@/actions/bookings";
import { BookingForm } from "@/components/booking-form";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { bookingFormOptions } from "@/lib/options";

export const metadata: Metadata = { title: "Edit booking" };

export default async function EditBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [booking, settings, options] = await Promise.all([
    prisma.booking.findFirst({ where: { id, agencyId: user.agencyId } }),
    getSettings(user.agencyId),
    bookingFormOptions(user.agencyId),
  ]);
  if (!booking) notFound();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`Edit ${booking.reference}`} />
      <BookingForm action={updateBooking.bind(null, booking.id)} booking={booking} settings={settings} {...options} />
    </div>
  );
}
