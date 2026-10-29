import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteVenue, updateVenue } from "@/actions/crm";
import { VenueForm } from "@/components/crm-forms";
import { ConfirmButton } from "@/components/forms";
import { ScheduleEditor } from "@/components/schedule-editor";
import { PageHeader, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Venue" };

export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [venue, settings, artists, contacts, slots] = await Promise.all([
    prisma.venue.findFirst({
      where: { id, agencyId: user.agencyId },
      include: { bookings: { orderBy: { setStart: "desc" }, take: 50, include: { artist: { select: { name: true } } } } },
    }),
    getSettings(user.agencyId),
    prisma.artist.findMany({ where: { agencyId: user.agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.contact.findMany({ where: { agencyId: user.agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.venueSlot.findMany({ where: { agencyId: user.agencyId, venueId: id }, include: { artist: { select: { id: true, name: true } } } }),
  ]);
  if (!venue) notFound();
  return (
    <div>
      <PageHeader
        title={venue.name}
        subtitle={[venue.city, venue.country].filter(Boolean).join(", ")}
        actions={
          <Link href={`/bookings/new?venueId=${venue.id}`} className="btn btn-primary">
            New booking here
          </Link>
        }
      />
      <div className="mb-6">
        <ScheduleEditor venueId={venue.id} slots={slots} artists={artists} contacts={contacts} currency={settings.defaultCurrency} />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <VenueForm action={updateVenue.bind(null, venue.id)} venue={venue} defaultTimezone={settings.defaultTimezone} />
          <form action={deleteVenue.bind(null, venue.id)} className="mt-4">
            <ConfirmButton message={`Delete ${venue.name}? Bookings stay but lose their venue.`}>Delete venue</ConfirmButton>
          </form>
        </div>
        <section>
          <h2 className="section-title mb-3">Shows here</h2>
          <ul className="card divide-y divide-slate-100 text-sm">
            {venue.bookings.length === 0 && <li className="px-4 py-3 text-slate-500">None yet.</li>}
            {venue.bookings.map((b) => (
              <li key={b.id}>
                <Link href={`/bookings/${b.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50">
                  <span>
                    {b.artist.name}
                    <span className="block text-xs text-slate-500">{formatDate(b.arriveBy, b.timezone)}</span>
                  </span>
                  <StatusBadge status={b.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
