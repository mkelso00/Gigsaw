import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { updateBooking } from "@/actions/bookings";
import { BookingForm } from "@/components/booking-form";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { bookingFormOptions } from "@/lib/options";
import { venueScopeCounts } from "@/lib/venue-change";

export const metadata: Metadata = { title: "Edit booking" };

export default async function EditBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [booking, settings, options] = await Promise.all([
    prisma.booking.findFirst({ where: { id, agencyId: user.agencyId }, include: { venue: { select: { id: true, name: true } } } }),
    getSettings(user.agencyId),
    bookingFormOptions(user.agencyId),
  ]);
  if (!booking) notFound();
  // "Who pays" lists companies and customers; a booking paid by someone else (e.g. a venue manager) keeps them.
  const payer =
    booking.promoterId && !options.promoters.some((p) => p.id === booking.promoterId)
      ? await prisma.contact.findFirst({
          where: { id: booking.promoterId, agencyId: user.agencyId },
          select: { id: true, name: true, company: true, type: true, email: true, phone: true, notifyOwner: true, leadContactId: true },
        })
      : null;
  if (payer) options.promoters.push(payer);
  // The client's lead contact stays listed even if they're no longer at a venue or company.
  const lead =
    booking.clientContactId && !options.people.some((p) => p.id === booking.clientContactId)
      ? await prisma.person.findFirst({
          where: { id: booking.clientContactId, agencyId: user.agencyId },
          select: { id: true, firstName: true, surname: true, alias: true, email: true, phone: true, venueId: true, companyId: true, jobTitle: true },
        })
      : null;
  if (lead) options.people.push(lead);
  // How many of the venue's other bookings "Also change other bookings" would reach.
  const alsoChange = booking.venue ? { venueId: booking.venue.id, venueName: booking.venue.name, ...(await venueScopeCounts(booking)) } : undefined;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`Edit ${booking.reference}`} />
      <BookingForm action={updateBooking.bind(null, booking.id)} booking={booking} settings={settings} alsoChange={alsoChange} {...options} />
    </div>
  );
}
