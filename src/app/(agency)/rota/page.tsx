import type { Metadata } from "next";
import Link from "next/link";
import { assignSlot, bookRegulars } from "@/actions/slots";
import { ActionForm, SubmitButton } from "@/components/forms";
import { RotaQuickAdd } from "@/components/rota-quick-add";
import { ArrivalBadge, ArtistDot, Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { arrivalFor } from "@/lib/bookings";
import { eventTypeLabel, actName } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { WEEKDAYS, dateInWeek, isDateKey, venueColour, weekStartOf } from "@/lib/rota";
import { addDaysToKey, localDateKey, localTime, zonedToUtc } from "@/lib/time";
import { unfilledSlots } from "@/lib/unfilled";
import { WeekJump } from "@/components/week-jump";

export const metadata: Metadata = { title: "Rota" };
export const dynamic = "force-dynamic";

const dayLabel = (key: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${key}T12:00:00Z`));

export default async function RotaPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await requireStaff();
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const sp = await searchParams;
  const today = localDateKey(new Date(), tz);
  const weekStart = weekStartOf(isDateKey(sp.week) ? sp.week : today);
  const weekEnd = addDaysToKey(weekStart, 7);

  const weekFrom = zonedToUtc(addDaysToKey(weekStart, -1), "00:00", tz);
  const weekTo = zonedToUtc(addDaysToKey(weekEnd, 1), "00:00", tz);
  const bookingInclude = {
    artist: { select: { name: true, colour: true } },
    venue: { select: { latitude: true, longitude: true } },
    checkIns: {
      select: {
        kind: true,
        at: true,
        source: true,
        distanceM: true,
        etaMinutes: true,
      },
    },
  } as const;
  const [slots, artists, needs, allVenues, oneOffs, bookings] = await Promise.all([
    prisma.venueSlot.findMany({
      where: { agencyId: user.agencyId, active: true },
      include: {
        venue: true,
        artist: { select: { id: true, name: true, colour: true } },
      },
      orderBy: [{ startTime: "asc" }],
    }),
    prisma.artist.findMany({
      where: { agencyId: user.agencyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    unfilledSlots(user.agencyId, tz, 28),
    prisma.venue.findMany({
      where: { agencyId: user.agencyId },
      orderBy: { name: "asc" },
    }),
    // Gigs at a venue that aren't from its weekly schedule.
    prisma.booking.findMany({
      where: {
        agencyId: user.agencyId,
        slotId: null,
        venueId: { not: null },
        status: { not: "CANCELLED" },
        arriveBy: { gte: weekFrom, lt: weekTo },
      },
      include: bookingInclude,
      orderBy: { setStart: "asc" },
    }),
    // Gigs from the weekly slots, fetched alongside the slots (only active slots' are looked up).
    prisma.booking.findMany({
      where: {
        agencyId: user.agencyId,
        slotId: { not: null },
        status: { not: "CANCELLED" },
        arriveBy: { gte: weekFrom, lt: weekTo },
      },
      include: bookingInclude,
    }),
  ]);
  // A slot is filled on a date if a booking made from it falls on that date in the venue's time zone.
  const filled = new Map(bookings.map((b) => [`${b.slotId}|${localDateKey(b.arriveBy, b.timezone)}`, b]));

  const oneOffsByCell = new Map<string, typeof oneOffs>();
  for (const b of oneOffs) {
    const k = `${b.venueId}|${localDateKey(b.arriveBy, b.timezone)}`;
    oneOffsByCell.set(k, [...(oneOffsByCell.get(k) ?? []), b]);
  }
  const rowIds = new Set([...slots.map((s) => s.venueId), ...oneOffs.map((b) => b.venueId!)]);
  const venues = allVenues.filter((v) => rowIds.has(v.id));
  const total = slots.length;
  const filledCount = slots.filter((s) => filled.get(`${s.id}|${dateInWeek(weekStart, s.weekday)}`)?.artistId).length;
  const now = new Date();

  return (
    <div>
      <PageHeader
        title="Rota"
        subtitle="Every venue's weekly music slots, and who's playing them."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <WeekJump value={isDateKey(sp.week) ? sp.week : weekStart} />
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

      {allVenues.length > 0 && (
        <details className="card mb-6 [&[open]>summary]:border-b [&[open]>summary]:border-ink-100" id="add-gig">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
            <span>
              <span className="section-title">Add a booking</span>
              <span className="ml-2 text-sm text-ink-500">Any date, any venue. One-off, or every week.</span>
            </span>
            <span className="btn btn-sm">+ Add</span>
          </summary>
          <div className="p-5">
            <RotaQuickAdd
              artists={artists}
              venues={allVenues}
              minDate={today}
              date={weekStart > today ? weekStart : today}
              currency={settings.defaultCurrency}
            />
          </div>
        </details>
      )}

      {venues.length === 0 ? (
        <Empty>
          No weekly slots yet. Open a{" "}
          <Link href="/venues" className="link">
            venue
          </Link>{" "}
          and add its music schedule, for example Mon to Thu 19:00–21:00 solo, or use Add a booking above.
        </Empty>
      ) : (
        <>
          {total > 0 && (
            <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-[1fr_1fr_2fr]">
              <Stat tone={filledCount === total ? "dark" : "default"} label="Slots with an act this week" value={`${filledCount} / ${total}`} />
              <Stat label="Still to fill" value={total - filledCount} hint={total - filledCount ? "Shown in amber below" : "All done"} />
              <ActionForm action={bookRegulars} className="card col-span-2 flex flex-col justify-between gap-3 p-5 lg:col-span-1">
                <input type="hidden" name="weekStart" value={weekStart} />
                <div className="text-[13px] text-ink-500">Fill the calendar from the weekly slots</div>
                <select name="mode" defaultValue="pending" className="input">
                  <option value="pending">Put every slot in the calendar (Pending, no act yet)</option>
                  <option value="offer">Offer each slot to its regular act</option>
                  <option value="confirm">Book each regular act in as confirmed</option>
                </select>
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
                    Tell acts (confirmed only)
                  </label>
                  <SubmitButton pendingText="Working…">Go</SubmitButton>
                </div>
              </ActionForm>
            </div>
          )}

          {needs.length > 0 && (
            <section id="needs-artist" className="mb-6 scroll-mt-6 overflow-hidden rounded-[var(--radius-card)] border-2 border-amber-300 bg-white">
              <div className="flex flex-wrap items-baseline justify-between gap-2 bg-amber-50 px-5 py-3">
                <h2 className="section-title">
                  Needs an act <span className="font-normal text-ink-500">· {needs.length} in the next 4 weeks</span>
                </h2>
                <span className="text-xs text-ink-500">Soonest first. Offer sends the act the booking to accept; Confirm books them straight in.</span>
              </div>
              <ul className="divide-y divide-ink-100">
                {needs.slice(0, 40).map(({ date, slot }) => (
                  <li key={`${slot.id}-${date}`} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 text-sm">
                    <div className={`w-32 shrink-0 font-medium ${date <= addDaysToKey(today, 2) ? "text-rose-700" : ""}`}>
                      {date === today ? "Today" : date === addDaysToKey(today, 1) ? "Tomorrow" : dayLabel(date)}
                    </div>
                    <div className="w-28 shrink-0 tabular-nums">
                      {slot.startTime}–{slot.endTime}
                    </div>
                    <div className="flex min-w-48 flex-1 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: venueColour(slot.venue) }} />
                      <span className="font-medium">{slot.venue.name}</span>
                      <span className="text-ink-500">
                        {slot.venue.city ? `${slot.venue.city} · ` : ""}
                        {slot.label || "Live music"}
                      </span>
                    </div>
                    <ActionForm action={assignSlot.bind(null, slot.id, date)} className="flex flex-wrap items-start gap-2">
                      <input type="hidden" name="notify" value="on" />
                      <select name="artistId" defaultValue={slot.artistId ?? ""} className="input w-52">
                        <option value="">Choose act…</option>
                        {artists.map((ar) => (
                          <option key={ar.id} value={ar.id}>
                            {ar.name}
                          </option>
                        ))}
                      </select>
                      <SubmitButton className="btn btn-primary" pendingText="…" name="mode" value="offer">
                        Offer
                      </SubmitButton>
                      <SubmitButton className="btn" pendingText="…" name="mode" value="confirm">
                        Confirm
                      </SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
              {needs.length > 40 && <p className="border-t border-ink-100 px-5 py-3 text-xs text-ink-500">And {needs.length - 40} more further ahead.</p>}
            </section>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[1100px] table-fixed border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-44 border-b border-ink-200 px-4 py-3 text-left text-xs font-medium text-ink-500">Venue</th>
                  {WEEKDAYS.map(([d]) => {
                    const key = dateInWeek(weekStart, d);
                    return (
                      <th
                        key={d}
                        className={`border-b border-l border-ink-200 px-3 py-3 text-left text-xs font-medium ${key === today ? "bg-volt-100 text-ink-950" : "text-ink-500"}`}
                      >
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
                              if (b && b.artistId) {
                                const a = arrivalFor(b, settings, now);
                                return (
                                  <Link
                                    key={s.id}
                                    href={`/bookings/${b.id}`}
                                    className="block rounded-lg border border-ink-200 bg-white p-2 hover:border-ink-400"
                                  >
                                    <div className="text-xs font-semibold tabular-nums">{time}</div>
                                    <div className="mt-1 flex items-center gap-1.5 truncate font-medium">
                                      <ArtistDot colour={b.artist?.colour ?? "#a2a199"} />
                                      <span className="truncate">{actName(b)}</span>
                                    </div>
                                    <div className="mt-1.5">{a.state !== "NOT_DUE" ? <ArrivalBadge state={a.state} /> : <StatusBadge status={b.status} />}</div>
                                  </Link>
                                );
                              }
                              return (
                                <div
                                  key={s.id}
                                  className={`rounded-lg border border-dashed p-2 ${past ? "border-ink-200 text-ink-400" : "border-amber-300 bg-amber-50/60"}`}
                                >
                                  <div className="flex items-center justify-between text-xs font-semibold tabular-nums">
                                    {time}
                                    {b && (
                                      <Link href={`/bookings/${b.id}`} className="font-normal text-ink-500 underline" title="In the calendar, Pending">
                                        Pending
                                      </Link>
                                    )}
                                  </div>
                                  <div className="text-xs text-ink-500">{s.label || eventTypeLabel(s.eventType)}</div>
                                  {past ? (
                                    <div className="mt-1 text-xs">No act</div>
                                  ) : (
                                    <ActionForm action={assignSlot.bind(null, s.id, date)} className="mt-1.5 space-y-1.5">
                                      <input type="hidden" name="notify" value="on" />
                                      <select name="artistId" defaultValue={s.artistId ?? ""} className="input-sm">
                                        <option value="">Act…</option>
                                        {artists.map((ar) => (
                                          <option key={ar.id} value={ar.id}>
                                            {ar.name}
                                          </option>
                                        ))}
                                      </select>
                                      <div className="grid grid-cols-2 gap-1">
                                        <SubmitButton className="btn btn-sm btn-primary w-full px-1" pendingText="…" name="mode" value="offer">
                                          Offer
                                        </SubmitButton>
                                        <SubmitButton className="btn btn-sm w-full px-1" pendingText="…" name="mode" value="confirm">
                                          Confirm
                                        </SubmitButton>
                                      </div>
                                    </ActionForm>
                                  )}
                                </div>
                              );
                            })}
                            {(oneOffsByCell.get(`${v.id}|${date}`) ?? []).map((b) => {
                              const a = arrivalFor(b, settings, now);
                              return (
                                <Link
                                  key={b.id}
                                  href={`/bookings/${b.id}`}
                                  className="block rounded-lg border border-ink-200 bg-white p-2 hover:border-ink-400"
                                >
                                  <div className="text-xs font-semibold tabular-nums">
                                    {localTime(b.setStart, b.timezone)}
                                    {b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}
                                  </div>
                                  <div className="text-[11px] text-ink-500">One-off{b.eventName ? ` · ${b.eventName}` : ""}</div>
                                  <div className="mt-1 flex items-center gap-1.5 truncate font-medium">
                                    <ArtistDot colour={b.artist?.colour ?? "#a2a199"} />
                                    <span className="truncate">{actName(b)}</span>
                                  </div>
                                  <div className="mt-1.5">{a.state !== "NOT_DUE" ? <ArrivalBadge state={a.state} /> : <StatusBadge status={b.status} />}</div>
                                </Link>
                              );
                            })}
                            {!past && (
                              <RotaQuickAdd
                                artists={artists}
                                venueId={v.id}
                                date={date}
                                minDate={today}
                                currency={settings.defaultCurrency}
                                weekdayName={WEEKDAYS[d - 1][2]}
                              />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-500">
            Booking a slot or adding a booking tells the artist by email and text. Tick &ldquo;Every …&rdquo; when adding to make it a weekly slot. Change a
            slot&apos;s times or fee on the venue&apos;s page.
          </p>
        </>
      )}
    </div>
  );
}
