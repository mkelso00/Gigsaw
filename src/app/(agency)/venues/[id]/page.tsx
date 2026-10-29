import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteVenue, updateVenue } from "@/actions/crm";
import { VenueForm } from "@/components/crm-forms";
import { ConfirmButton } from "@/components/forms";
import { ScheduleEditor } from "@/components/schedule-editor";
import { VenueShareCard } from "@/components/venue-share-card";
import { personName } from "@/lib/person-name";
import { appUrl } from "@/lib/messaging";
import { PageHeader, StatusBadge } from "@/components/ui";
import { venueColour } from "@/lib/rota";
import { requireStaff } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { formatDate } from "@/lib/time";
import { actName } from "@/lib/constants";

export const metadata: Metadata = { title: "Venue" };

export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [venue, settings, artists, contacts, slots] = await Promise.all([
    prisma.venue.findFirst({
      where: { id, agencyId: user.agencyId },
      include: {
        people: { orderBy: { firstName: "asc" } },
        bookings: {
          orderBy: { setStart: "desc" },
          take: 50,
          include: { artist: { select: { name: true } } },
        },
      },
    }),
    getSettings(user.agencyId),
    prisma.artist.findMany({
      where: { agencyId: user.agencyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.contact.findMany({
      where: { agencyId: user.agencyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.venueSlot.findMany({
      where: { agencyId: user.agencyId, venueId: id },
      include: { artist: { select: { id: true, name: true } } },
    }),
  ]);
  if (!venue) notFound();
  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="inline-block h-5 w-5 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: venueColour(venue) }} aria-hidden />
            {venue.name}
          </span>
        }
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
        <div className="space-y-6">
          <section className="card card-pad" id="people">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="section-title">People</h2>
              <Link href={`/people/new?venueId=${venue.id}`} className="btn btn-sm">
                + Add person
              </Link>
            </div>
            {venue.people.length ? (
              <ul className="mt-3 divide-y divide-ink-100 text-sm">
                {venue.people.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/people/${p.id}`} className="link">
                        {personName(p)}
                      </Link>
                      {p.jobTitle && <span className="text-ink-500"> · {p.jobTitle}</span>}
                      {p.email && <div className="truncate text-xs text-ink-500">{p.email}</div>}
                    </div>
                    {p.phone && (
                      <a href={`tel:${p.phone.replace(/\s/g, "")}`} className="btn btn-sm shrink-0">
                        Call
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-ink-500">The manager and anyone else you deal with here. Add them so their number is one tap away.</p>
            )}
          </section>
          <VenueShareCard venueId={venue.id} url={venue.shareToken ? `${appUrl()}/v/${venue.shareToken}` : null} />
          <section>
            <h2 className="section-title mb-3">Shows here</h2>
            <ul className="card divide-y divide-slate-100 text-sm">
              {venue.bookings.length === 0 && <li className="px-4 py-3 text-slate-500">None yet.</li>}
              {venue.bookings.map((b) => (
                <li key={b.id}>
                  <Link href={`/bookings/${b.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50">
                    <span>
                      {actName(b)}
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
    </div>
  );
}
