import type { Metadata } from "next";
import Link from "next/link";
import { ArtistDot, Empty, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { punctualityByArtist } from "@/lib/bookings";
import { getSettings, prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Artists" };

export default async function ArtistsPage() {
  const user = await requireStaff();
  const settings = await getSettings(user.agencyId);
  const now = new Date();
  const [artists, stats] = await Promise.all([
    prisma.artist.findMany({
      where: { agencyId: user.agencyId },
      orderBy: { name: "asc" },
      include: {
        agent: { select: { name: true } },
        login: { select: { id: true } },
        _count: { select: { bookings: { where: { setStart: { gte: now }, status: { not: "CANCELLED" } } } } },
      },
    }),
    punctualityByArtist(settings, new Date(now.getTime() - 365 * 86_400_000)),
  ]);

  return (
    <div>
      <PageHeader
        title="Artists"
        subtitle="Your roster."
        actions={
          <Link href="/artists/new" className="btn btn-primary">
            Add artist
          </Link>
        }
      />
      {artists.length === 0 ? (
        <Empty>No artists yet.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {artists.map((a) => {
            const s = stats.get(a.id);
            return (
              <Link key={a.id} href={`/artists/${a.id}`} className="card card-pad block transition hover:shadow-md">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: a.colour }}>
                    {a.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{a.name}</div>
                    <div className="truncate text-sm text-slate-500">{[a.genre, a.agent?.name].filter(Boolean).join(" · ") || "No details yet"}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className="badge bg-slate-100 text-slate-700">{a._count.bookings} upcoming</span>
                  {s?.onTimeRate != null && (
                    <span className={`badge ${s.onTimeRate >= 0.9 ? "bg-emerald-100 text-emerald-800" : s.onTimeRate >= 0.7 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"}`}>
                      {Math.round(s.onTimeRate * 100)}% on time
                    </span>
                  )}
                  <span className={`badge ${a.login ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
                    <ArtistDot colour={a.login ? "#6d28d9" : "#94a3b8"} />
                    <span className="ml-1">{a.login ? "Has app login" : "No app login"}</span>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
