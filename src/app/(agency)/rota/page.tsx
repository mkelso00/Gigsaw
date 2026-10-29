import type { Metadata } from "next";
import Link from "next/link";
import { assignSlot, bookRegulars } from "@/actions/slots";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ArrivalBadge, ArtistDot, Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { arrivalFor } from "@/lib/bookings";
import { eventTypeLabel } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { WEEKDAYS, dateInWeek, isDateKey, venueColour, weekStartOf } from "@/lib/rota";
import { addDaysToKey, localDateKey, zonedToUtc } from "@/lib/time";

export const metadata: Metadata = { title: "Rota" };
export const dynamic = "force-dynamic";

const dayLabel = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

export default async function RotaPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await requireStaff();
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const sp = await searchParams;
  const today = localDateKey(new Date(), tz);
  const weekStart = weekStartOf(isDateKey(sp.week) ? sp.week : today);
  const weekEnd = addDaysToKey(weekStart, 7);

  const [slots, artists] = await Promise.all([
    prisma.venueSlot.findMany({
      where: { agencyId: user.agencyId, active: true },
      include: { venue: true, artist: { select: { id: true, name: true, colour: true } } },
      orderBy: [{ startTime: "asc" }],
    }),
    prisma.artist.findMany({ where: { agencyId: user.agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const bookings = slots.length
    ? await prisma.booking.findMany({
        where: {
          agencyId: user.agencyId,
          slotId: { in: slots.map((s) => s.id) },
          status: { not: "CANCELLED" },
          arriveBy: { gte: zonedToUtc(addDaysToKey(weekStart, -1), "00:00", tz), lt: zonedToUtc(addDaysToKey(weekEnd, 1), "00:00", tz) },
        },
        include: {
          artist: { select: { name: true, colour: true } },
          venue: { select: { latitude: true, longitude: true } },
          checkIns: { select: { kind: true, at: true, source: true, distanceM: true, etaMinutes: true } },
        },
      })
    : [];
  // A slot is filled on a date if a booking made from it falls on that date in the venue's time zone.
  const filled = new Map(bookings.map((b) => [`${b.slotId}|${localDateKey(b.arriveBy, b.timezone)}`, b]));

  const venues = [...new Map(slots.map((s) => [s.venueId, s.venue])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const total = slots.length;
  const filledCount = slots.filter((s) => filled.has(`${s.id}|${dateInWeek(weekStart, s.weekday)}`)).length;
  const now = new Date();

  return (
    <div>
      <PageHeader
        title="Rota"
        subtitle="Every venue's weekly music slots, and who's playing them."
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/rota?week=${addDaysToKey(weekStart, -7)}`} className="btn" aria-label="Previous week">
              ←
            </Link>
            <span className="min-w-44 text-center text-sm font-medium">
              {dayLabel(weekStart)} – {dayLabel(addDaysToKey(weekStart, 6))}
            </span>
            <Link href={`/rota?week=${addDaysToKey(weekStart, 7)}`} className="btn" aria-label="Next week">
              →
            </Link>
            <Link href="/rota" className="btn">
              This week
            </Link>
          </div>
        }
      />

      {total === 0 ? (
        <Empty>
          No weekly slots yet. Open a <Link href="/venues" className="link">venue</Link> and add its music schedule, for example Mon to Thu 19:00–21:00 solo.
        </Empty>
      ) : (
        <>
          <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_1fr_2fr]">
            <Stat tone={filledCount === total ? "dark" : "default"} label="Slots filled this week" value={`${filledCount} / ${total}`} />
            <Stat label="Still to fill" value={total - filledCount} hint={total - filledCount ? "Shown in amber below" : "All done"} />
            <ActionForm action={bookRegulars} className="card flex flex-col justify-between gap-3 p-5">
              <input type="hidden" name="weekStart" value={weekStart} />
              <div className="text-[13px] text-ink-500">Book the regular artists into their slots</div>
              <div className="flex flex-wrap items-center gap-2">
                <select name="weeks" defaultValue="4" className="input w-auto">
                  {[1, 2, 4, 8, 12].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? "This week" : `${n} weeks from this week`}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="notify" defaultChecked className="h-4 w-4 accent-ink-950" />
                  Tell artists
                </label>
                <SubmitButton pendingText="Booking…">Book regulars</SubmitButton>
              </div>
            </ActionForm>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[1100px] table-fixed border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-44 border-b border-ink-200 px-4 py-3 text-left text-xs font-medium text-ink-500">Venue</th>
                  {WEEKDAYS.map(([d]) => {
                    const key = dateInWeek(weekStart, d);
                    return (
                      <th key={d} className={`border-b border-l border-ink-200 px-3 py-3 text-left text-xs font-medium ${key === today ? "bg-volt-100 text-ink-950" : "text-ink-500"}`}>
                        {dayLabel(key)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {venues.map((v) => (
                  <tr key={v.id} className="align-top">
                    <td className="border-b border-ink-100 px-4 py-3">
                      <Link href={`/venues/${v.id}`} className="flex items-center gap-2 font-medium hover:underline">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: venueColour(v) }} />
                        {v.name}
                      </Link>
                      {v.city && <div className="mt-0.5 pl-[18px] text-xs text-ink-500">{v.city}</div>}
                    </td>
                    {WEEKDAYS.map(([d]) => {
                      const date = dateInWeek(weekStart, d);
                      const past = date < today;
                      const daySlots = slots.filter((s) => s.venueId === v.id && s.weekday === d);
                      return (
                        <td key={d} className={`border-b border-l border-ink-100 p-2 ${date === today ? "bg-volt-100/30" : ""}`}>
                          <div className="space-y-2">
                            {daySlots.map((s) => {
                              const b = filled.get(`${s.id}|${date}`);
                              const time = `${s.startTime}–${s.endTime}`;
                              if (b) {
                                const a = arrivalFor(b, settings, now);
                                return (
                                  <Link key={s.id} href={`/bookings/${b.id}`} className="block rounded-lg border border-ink-200 bg-white p-2 hover:border-ink-400">
                                    <div className="text-xs font-semibold tabular-nums">{time}</div>
                                    <div className="mt-1 flex items-center gap-1.5 truncate font-medium">
                                      <ArtistDot colour={b.artist.colour} />
                                      <span className="truncate">{b.artist.name}</span>
                                    </div>
                                    <div className="mt-1.5">{a.state !== "NOT_DUE" ? <ArrivalBadge state={a.state} /> : <StatusBadge status={b.status} />}</div>
                                  </Link>
                                );
                              }
                              return (
                                <div key={s.id} className={`rounded-lg border border-dashed p-2 ${past ? "border-ink-200 text-ink-400" : "border-amber-300 bg-amber-50/60"}`}>
                                  <div className="text-xs font-semibold tabular-nums">{time}</div>
                                  <div className="text-xs text-ink-500">{s.label || eventTypeLabel(s.eventType)}</div>
                                  {past ? (
                                    <div className="mt-1 text-xs">Not booked</div>
                                  ) : (
                                    <ActionForm action={assignSlot.bind(null, s.id, date)} className="mt-1.5 space-y-1.5">
                                      <input type="hidden" name="notify" value="on" />
                                      <select name="artistId" defaultValue={s.artistId ?? ""} className="h-8 w-full rounded-md border border-ink-200 bg-white px-1.5 text-xs">
                                        <option value="">Artist…</option>
                                        {artists.map((ar) => (
                                          <option key={ar.id} value={ar.id}>
                                            {ar.name}
                                          </option>
                                        ))}
                                      </select>
                                      <SubmitButton className="btn btn-sm w-full" pendingText="…">
                                        Book
                                      </SubmitButton>
                                    </ActionForm>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-500">Booking a slot tells the artist by email and text. Change a slot&apos;s times or fee on the venue&apos;s page.</p>
        </>
      )}
    </div>
  );
}
