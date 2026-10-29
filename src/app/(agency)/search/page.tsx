import type { Metadata } from "next";
import Link from "next/link";
import { ArrivalBadge, ArtistDot, Empty, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { arrivalFor } from "@/lib/bookings";
import { getSettings, prisma } from "@/lib/db";
import { venueColour } from "@/lib/rota";
import { addDaysToKey, formatDate, localDateKey, localTime } from "@/lib/time";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

const HOUR = 3_600_000;

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireStaff();
  const { q: raw } = await searchParams;
  const q = (raw ?? "").trim().slice(0, 100);
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const now = new Date();
  if (!q) return <Empty>Type a town, venue or artist in the search bar above.</Empty>;

  const contains = { contains: q, mode: "insensitive" as const };
  const [bookings, artists, venues, contacts] = await Promise.all([
    prisma.booking.findMany({
      where: {
        agencyId: user.agencyId,
        status: { not: "CANCELLED" },
        arriveBy: { gte: new Date(now.getTime() - 14 * 24 * HOUR), lte: new Date(now.getTime() + 90 * 24 * HOUR) },
        OR: [
          { venue: { name: contains } },
          { venue: { city: contains } },
          { venue: { address: contains } },
          { artist: { name: contains } },
          { promoter: { name: contains } },
          { promoter: { company: contains } },
          { eventName: contains },
          { reference: contains },
        ],
      },
      include: {
        artist: { select: { id: true, name: true, colour: true, phone: true } },
        venue: { select: { id: true, name: true, city: true, colour: true, latitude: true, longitude: true } },
        checkIns: { select: { kind: true, at: true, source: true, distanceM: true, etaMinutes: true } },
      },
      orderBy: { setStart: "asc" },
      take: 300,
    }),
    prisma.artist.findMany({ where: { agencyId: user.agencyId, name: contains }, take: 8, select: { id: true, name: true, colour: true, phone: true } }),
    prisma.venue.findMany({ where: { agencyId: user.agencyId, OR: [{ name: contains }, { city: contains }] }, take: 8, select: { id: true, name: true, city: true, colour: true } }),
    prisma.contact.findMany({ where: { agencyId: user.agencyId, OR: [{ name: contains }, { company: contains }] }, take: 8, select: { id: true, name: true, company: true, phone: true } }),
  ]);

  const todayKey = localDateKey(now, tz);
  const groups: [string, typeof bookings][] = [
    ["Today", []],
    ["Tomorrow", []],
    ["Next 7 days", []],
    ["Later", []],
    ["Last two weeks", []],
  ];
  for (const b of bookings) {
    const key = localDateKey(b.arriveBy, b.timezone);
    const ended = (b.setEnd ?? new Date(b.setStart.getTime() + 3 * HOUR)) < now;
    const g = key === todayKey && !ended ? 0 : key === addDaysToKey(todayKey, 1) ? 1 : key > todayKey && key <= addDaysToKey(todayKey, 7) ? 2 : key > todayKey ? 3 : 4;
    groups[g][1].push(b);
  }
  groups[4][1].reverse();

  return (
    <div>
      <h1 className="mb-1 text-[28px] font-semibold tracking-[-0.02em]">
        &ldquo;{q}&rdquo;
      </h1>
      <p className="mb-8 text-[15px] text-ink-500">
        {bookings.length} gig{bookings.length === 1 ? "" : "s"} from two weeks ago to three months ahead.
      </p>

      {(artists.length > 0 || venues.length > 0 || contacts.length > 0) && (
        <div className="mb-8 flex flex-wrap gap-2 text-sm">
          {artists.map((a) => (
            <Link key={a.id} href={`/artists/${a.id}`} className="flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 hover:border-ink-400">
              <ArtistDot colour={a.colour} />
              {a.name}
              <span className="text-xs text-ink-400">artist</span>
            </Link>
          ))}
          {venues.map((v) => (
            <Link key={v.id} href={`/venues/${v.id}`} className="flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 hover:border-ink-400">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: venueColour(v) }} />
              {v.name}
              {v.city && <span className="text-xs text-ink-400">{v.city}</span>}
            </Link>
          ))}
          {contacts.map((c) => (
            <Link key={c.id} href={`/contacts/${c.id}`} className="flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 hover:border-ink-400">
              {c.name}
              <span className="text-xs text-ink-400">{c.company || "contact"}</span>
            </Link>
          ))}
        </div>
      )}

      {bookings.length === 0 ? (
        <Empty>No gigs match &ldquo;{q}&rdquo;. Try a town, venue, artist or promoter name.</Empty>
      ) : (
        <div className="space-y-8">
          {groups
            .filter(([, list]) => list.length)
            .map(([label, list]) => (
              <section key={label}>
                <h2 className="section-title mb-3">
                  {label} <span className="font-normal text-ink-400">· {list.length}</span>
                </h2>
                <ul className="card divide-y divide-ink-100">
                  {list.map((b) => {
                    const a = arrivalFor(b, settings, now);
                    return (
                      <li key={b.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
                        <div className="w-28 shrink-0">
                          <div className="font-semibold tabular-nums">
                            {localTime(b.setStart, b.timezone)}
                            {b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}
                          </div>
                          {label !== "Today" && <div className="text-xs text-ink-500">{formatDate(b.arriveBy, b.timezone)}</div>}
                        </div>
                        <Link href={`/bookings/${b.id}`} className="min-w-48 flex-1">
                          <div className="flex items-center gap-2 font-medium hover:underline">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.venue ? venueColour(b.venue) : "#a2a199" }} />
                            {b.venue?.name ?? "No venue"}
                            {b.venue?.city && <span className="font-normal text-ink-500">· {b.venue.city}</span>}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 pl-[18px] text-sm text-ink-700">
                            <ArtistDot colour={b.artist.colour} />
                            {b.artist.name}
                          </div>
                        </Link>
                        {b.artist.phone ? (
                          <a href={`tel:${b.artist.phone.replace(/\s/g, "")}`} className="btn btn-sm" title={`Call ${b.artist.name}`}>
                            Call {b.artist.phone}
                          </a>
                        ) : (
                          <span className="text-xs text-ink-400">No phone on file</span>
                        )}
                        <div className="w-36 text-right">{a.state !== "NOT_DUE" && label !== "Last two weeks" ? <ArrivalBadge state={a.state} /> : <StatusBadge status={b.status} />}</div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
