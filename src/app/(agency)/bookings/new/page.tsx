import type { Metadata } from "next";
import Link from "next/link";
import { createBooking } from "@/actions/bookings";
import { BookingForm } from "@/components/booking-form";
import { Empty, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { bookingFormOptions } from "@/lib/options";

export const metadata: Metadata = { title: "New booking" };

export default async function NewBookingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const [settings, options] = await Promise.all([getSettings(user.agencyId), bookingFormOptions(user.agencyId)]);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="New booking" subtitle="Start with a hold and move it forward as the deal firms up." />
      {options.artists.length === 0 ? (
        <Empty>
          Add an artist first. <Link href="/artists/new" className="link">Add artist</Link>
        </Empty>
      ) : (
        <BookingForm
          action={createBooking}
          settings={settings}
          {...options}
          defaults={{ artistId: sp.artistId, venueId: sp.venueId, promoterId: sp.promoterId, date: sp.date }}
        />
      )}
    </div>
  );
}
