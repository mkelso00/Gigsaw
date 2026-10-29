import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ArtistDot, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { gigDateKey } from "@/lib/bookings";
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, eventTypeLabel } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { addDaysToKey, localDateKey, localTime, zonedToUtc } from "@/lib/time";

export const metadata: Metadata = { title: "Calendar" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const todayKey = localDateKey(new Date(), tz);

  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : todayKey.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const firstKey = `${month}-01`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Monday-first grid.
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const gridStart = addDaysToKey(firstKey, -firstWeekday);
  const cells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const gridEnd = addDaysToKey(gridStart, cells);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);

  const where: Prisma.BookingWhereInput = {
    agencyId: user.agencyId,
    // Pad by a day either side so gigs in other time zones near the edges are included.
    arriveBy: { gte: zonedToUtc(addDaysToKey(gridStart, -1), "00:00", tz), lt: zonedToUtc(addDaysToKey(gridEnd, 1), "00:00", tz) },
  };
  if (sp.artist) where.artistId = sp.artist;
  if (sp.status && (BOOKING_STATUSES as readonly string[]).includes(sp.status)) where.status = sp.status;
  else where.status = { not: "CANCELLED" };

  const [bookings, artists] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: { artist: { select: { name: true, colour: true } }, venue: { select: { name: true, city: true } } },
      orderBy: { arriveBy: "asc" },
    }),
    prisma.artist.findMany({ where: { agencyId: user.agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true, calendarToken: true } }),
  ]);

  const byDay = new Map<string, typeof bookings>();
  for (const b of bookings) {
    const key = gigDateKey(b);
    byDay.set(key, [...(byDay.get(key) ?? []), b]);
  }

  const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  const qs = (extra: Record<string, string>) =>
    "?" + new URLSearchParams({ ...(sp.artist ? { artist: sp.artist } : {}), ...(sp.status ? { status: sp.status } : {}), ...extra }).toString();

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Shows by the date of their call time. Holds are dashed."
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/calendar${qs({ month: prev })}`} className="btn" aria-label="Previous month">
              ←
            </Link>
            <span className="min-w-40 text-center font-semibold">{monthName}</span>
            <Link href={`/calendar${qs({ month: next })}`} className="btn" aria-label="Next month">
              →
            </Link>
            <Link href={`/calendar${qs({ month: todayKey.slice(0, 7) })}`} className="btn">
              Today
            </Link>
          </div>
        }
      />

      <form className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <input type="hidden" name="month" value={month} />
        <label>
          <span className="label">Artist</span>
          <select name="artist" defaultValue={sp.artist ?? ""} className="input">
            <option value="">All artists</option>
            {artists.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Status</span>
          <select name="status" defaultValue={sp.status ?? ""} className="input">
            <option value="">All except cancelled</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {BOOKING_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn">Filter</button>
        <span className="ml-auto text-xs text-slate-500">Each artist has a private calendar feed on their profile page for phone calendars.</span>
      </form>

      <div className="card overflow-x-auto">
        <div className="grid min-w-[720px] grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid min-w-[720px] grid-cols-7">
          {Array.from({ length: cells }, (_, i) => {
            const key = addDaysToKey(gridStart, i);
            const inMonth = key.startsWith(month);
            const items = byDay.get(key) ?? [];
            return (
              <div key={key} className={`min-h-28 border-r border-b border-slate-100 p-1.5 ${inMonth ? "" : "bg-slate-50/70"}`}>
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      key === todayKey ? "bg-brand-600 font-bold text-white" : inMonth ? "text-slate-700" : "text-slate-400"
                    }`}
                  >
                    {Number(key.slice(8))}
                  </span>
                  <Link href={`/bookings/new?date=${key}${sp.artist ? `&artistId=${sp.artist}` : ""}`} className="text-xs text-slate-300 hover:text-brand-600" aria-label={`New booking on ${key}`}>
                    +
                  </Link>
                </div>
                <div className="space-y-1">
                  {items.map((b) => (
                    <Link
                      key={b.id}
                      href={`/bookings/${b.id}`}
                      title={`${b.artist.name} · ${eventTypeLabel(b.eventType)} · ${b.venue?.name ?? "No venue"} · ${BOOKING_STATUS_LABELS[b.status as keyof typeof BOOKING_STATUS_LABELS]}`}
                      className={`block truncate rounded px-1.5 py-1 text-xs leading-tight hover:brightness-95 ${b.status === "HOLD" || b.status === "ENQUIRY" ? "border border-dashed" : ""} ${b.status === "CANCELLED" ? "line-through opacity-60" : ""}`}
                      style={{ backgroundColor: `${b.artist.colour}1f`, borderColor: b.artist.colour }}
                    >
                      <span className="flex items-center gap-1">
                        <ArtistDot colour={b.artist.colour} />
                        <span className="truncate font-medium">{b.artist.name}</span>
                      </span>
                      <span className="block truncate text-slate-600">
                        {localTime(b.setStart, b.timezone)} {b.venue?.city || b.venue?.name || ""}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
