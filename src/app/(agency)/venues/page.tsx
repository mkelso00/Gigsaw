import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { venueColour } from "@/lib/rota";

export const metadata: Metadata = { title: "Venues" };

export default async function VenuesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireStaff();
  const { q } = await searchParams;
  const venues = await prisma.venue.findMany({
    where: {
      agencyId: user.agencyId,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { city: { contains: q, mode: "insensitive" } },
              { country: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    include: { _count: { select: { bookings: true } } },
  });
  return (
    <div>
      <PageHeader
        title="Venues"
        subtitle="Add a map pin to each venue so arrivals can be verified."
        actions={
          <Link href="/venues/new" className="btn btn-primary">
            Add venue
          </Link>
        }
      />
      <form className="card mb-4 flex gap-3 p-3">
        <input name="q" defaultValue={q} placeholder="Search by name, city or country" className="input" />
        <button className="btn">Search</button>
      </form>
      {venues.length === 0 ? (
        <Empty>No venues found.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Venue</th>
                <th>Location</th>
                <th className="text-right">Capacity</th>
                <th>Map pin</th>
                <th className="text-right">Bookings</th>
              </tr>
            </thead>
            <tbody>
              {venues.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td>
                    <span className="flex items-center gap-2.5">
                      <span
                        className="inline-block h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/10"
                        style={{ background: venueColour(v) }}
                        aria-hidden
                      />
                      <Link href={`/venues/${v.id}`} className="link">
                        {v.name}
                      </Link>
                    </span>
                  </td>
                  <td>{[v.city, v.country].filter(Boolean).join(", ")}</td>
                  <td className="text-right">{v.capacity?.toLocaleString("en-GB") ?? "–"}</td>
                  <td>
                    {v.latitude !== null ? (
                      <span className="badge bg-emerald-100 text-emerald-800">Set</span>
                    ) : (
                      <span className="badge bg-amber-100 text-amber-800">Missing</span>
                    )}
                  </td>
                  <td className="text-right">{v._count.bookings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
