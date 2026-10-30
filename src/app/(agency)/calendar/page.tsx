import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { FilterPanel } from "@/components/header-actions";
import { ArrivalBadge, ArtistDot, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { coversDate } from "@/lib/availability";
import { awayBetween, type AwayEntry } from "@/lib/away";
import { arrivalFor, gigDateKey } from "@/lib/bookings";
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, eventTypeLabel, actName } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { isDateKey, venueColour, weekStartOf } from "@/lib/rota";
import { addDaysToKey, localDateKey, localTime, zonedToUtc } from "@/lib/time";
import { GigHover, type GigCard } from "@/components/gig-hover";
import { dealBreakdown, formatMoney, paymentTotals } from "@/lib/money";
import { personName } from "@/lib/person-name";

export const metadata: Metadata = { title: "Calendar" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayLabel = (key: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const todayKey = localDateKey(new Date(), tz);
  // Week view is the default: with dozens of gigs a week, a month grid gets too crowded.
  const view = sp.view === "month" ? "month" : sp.view === "day" ? "day" : "week";
  const anchor = isDateKey(sp.date) ? sp.date : todayKey;

  let gridStart: string;
  let cells: number;
  let title: string;
  let prev: string;
  let next: string;
  if (view === "day") {
    gridStart = anchor;
    cells = 1;
    title = dayLabel(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    prev = addDaysToKey(anchor, -1);
    next = addDaysToKey(anchor, 1);
  } else if (view === "week") {
    gridStart = weekStartOf(anchor);
    cells = 7;
    title = `${dayLabel(gridStart, { day: "numeric", month: "short" })} – ${dayLabel(addDaysToKey(gridStart, 6), { day: "numeric", month: "short", year: "numeric" })}`;
    prev = addDaysToKey(gridStart, -7);
    next = addDaysToKey(gridStart, 7);
  } else {
    const [y, m] = anchor.split("-").map(Number);
    const first = `${anchor.slice(0, 7)}-01`;
    gridStart = weekStartOf(first);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    cells = Math.ceil((lead + daysInMonth) / 7) * 7;
    title = dayLabel(first, { month: "long", year: "numeric" });
    prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }
  const gridEnd = addDaysToKey(gridStart, cells);
  const month = anchor.slice(0, 7);

  const where: Prisma.BookingWhereInput = {
    agencyId: user.agencyId,
    // Pad by a day either side so gigs in other time zones near the edges are included.
    arriveBy: { gte: zonedToUtc(addDaysToKey(gridStart, -1), "00:00", tz), lt: zonedToUtc(addDaysToKey(gridEnd, 1), "00:00", tz) },
  };
  if (sp.artist) where.artistId = sp.artist;
  if (sp.town) where.venue = { city: { equals: sp.town, mode: "insensitive" } };
  if (sp.status && (BOOKING_STATUSES as readonly string[]).includes(sp.status)) where.status = sp.status;
  else where.status = { not: "CANCELLED" };

  const [bookings, artists, towns, awayAll] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: {
        artist: {
          select: {
            name: true,
            colour: true,
            phone: true,
            members: { take: 1, include: { person: { select: { firstName: true, surname: true, alias: true, phone: true } } } },
          },
        },
        venue: { select: { id: true, name: true, city: true, colour: true, latitude: true, longitude: true } },
        promoter: { select: { name: true, company: true, type: true } },
        event: { select: { name: true } },
        payments: { select: { direction: true, kind: true, amountMinor: true } },
        checkIns: { select: { kind: true, at: true, source: true, distanceM: true, etaMinutes: true } },
      },
      orderBy: { setStart: "asc" },
    }),
    prisma.artist.findMany({ where: { agencyId: user.agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.venue.findMany({ where: { agencyId: user.agencyId, city: { not: "" } }, distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } }),
    awayBetween(user.agencyId, gridStart, addDaysToKey(gridEnd, -1)),
  ]);
  // Days acts have blocked out. For one act, its own and those of acts inside it (a band is away
  // while one of its acts is); for everyone, each block once, on the act that added it.
  const away = sp.artist ? awayAll.filter((e) => e.artistId === sp.artist) : awayAll.filter((e) => e.own);
  const awayOn = (key: string) => away.filter((e) => coversDate(e, key));

  const byArtist = sp.colour === "artist";
  const colourOf = (b: (typeof bookings)[number]) => (byArtist ? (b.artist?.colour ?? "#a2a199") : b.venue ? venueColour(b.venue) : "#a2a199");
  const legend = [
    ...new Map(
      bookings.map((b) => (byArtist ? [actName(b), b.artist?.colour ?? "#a2a199"] : [b.venue?.name ?? "No venue", b.venue ? venueColour(b.venue) : "#a2a199"])),
    ),
  ].sort((a, b) => a[0].localeCompare(b[0]));

  const byDay = new Map<string, typeof bookings>();
  for (const b of bookings) {
    const key = gigDateKey(b);
    byDay.set(key, [...(byDay.get(key) ?? []), b]);
  }

  const keep = { artist: sp.artist, status: sp.status, colour: sp.colour, town: sp.town, view };
  const qs = (extra: Record<string, string>) =>
    "?" + new URLSearchParams(Object.entries({ ...keep, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
  // Not yet confirmed (pending, awaiting the act, on hold, enquiry): dashed outline.
  const dashed = (s: string) => (s === "CONFIRMED" || s === "SETTLED" ? "border-solid" : "border-dashed");
  type Gig = (typeof bookings)[number];
  // A gig that finishes after midnight stays on the day it starts, with a moon to show it runs late.
  const overnight = (b: Gig) =>
    b.setEnd && localDateKey(b.setEnd, b.timezone) !== gigDateKey(b) ? `Finishes after midnight, at ${localTime(b.setEnd, b.timezone)}` : null;
  const Moon = ({ b }: { b: Gig }) =>
    overnight(b) ? (
      <span className="shrink-0 text-ink-500" title={overnight(b)!} aria-label="Finishes after midnight">
        ☾
      </span>
    ) : null;
  const card = (b: Gig): GigCard => {
    const d = dealBreakdown(b);
    const received = paymentTotals(b.payments).receivedMinor;
    const m = (x: number) => formatMoney(x, b.currency);
    const contact = b.artist?.members[0]?.person;
    return {
      when: `${dayLabel(gigDateKey(b), { weekday: "short", day: "numeric", month: "short" })} · ${localTime(b.setStart, b.timezone)}${b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}`,
      overnight: overnight(b),
      status: BOOKING_STATUS_LABELS[b.status as keyof typeof BOOKING_STATUS_LABELS] ?? b.status,
      money: d.grossMinor
        ? [
            ["Total fee", `${m(d.grossMinor)}${d.vatMinor ? ` + VAT ${m(d.vatMinor)}` : ""}`],
            ...(d.bookingFeeMinor ? [["Booking fee", m(d.bookingFeeMinor)] as [string, string]] : []),
            ["Received", m(received)],
            ["Outstanding", m(Math.max(0, d.totalDueMinor - received))],
            ["Act's pay", m(d.artistMinor)],
          ]
        : [],
      people: [
        ["Act", actName(b)],
        ["Venue", b.venue ? `${b.venue.name}${b.venue.city ? `, ${b.venue.city}` : ""}` : "Not set"],
        ...(b.promoter
          ? ([
              [
                b.promoter.type === "CLIENT" ? "Customer" : "Booked by",
                b.promoter.company && b.promoter.company !== "Private client" ? `${b.promoter.name}, ${b.promoter.company}` : b.promoter.name,
              ],
            ] as [string, string][])
          : []),
        ...(contact || b.artist?.phone
          ? ([["Act contact", contact ? `${personName(contact)}${contact.phone ? ` · ${contact.phone}` : ""}` : b.artist?.phone]] as [string, string][])
          : []),
        ["Type", eventTypeLabel(b.eventType)],
        ...(b.event ? ([["Part of", b.event.name]] as [string, string][]) : []),
      ],
    };
  };

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle={`${bookings.length} booking${bookings.length === 1 ? "" : "s"}${sp.town ? ` in ${sp.town}` : ""} · colour by ${byArtist ? "act" : "venue"} · not yet confirmed is dashed${away.length ? " · amber is an act away" : ""}`}
        actions={
          <Link href={`/availability/new?date=${anchor >= todayKey ? anchor : todayKey}${sp.artist ? `&artistId=${sp.artist}` : ""}`} className="btn">
            Ask who&apos;s free
          </Link>
        }
      />

      {/* Getting around: view, then back, the dates shown, forward and today. Compact so it fits a phone. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-ink-200 bg-white p-0.5 text-sm">
          {(["day", "week", "month"] as const).map((v) => (
            <Link
              key={v}
              href={`/calendar${qs({ view: v, date: anchor })}`}
              className={`rounded-md px-3 py-1.5 ${view === v ? "bg-ink-950 text-white" : "text-ink-600 hover:text-ink-950"}`}
            >
              {v === "day" ? "Day" : v === "week" ? "Week" : "Month"}
            </Link>
          ))}
        </div>
        <span className="flex items-center gap-1 sm:ml-auto">
          <Link href={`/calendar${qs({ date: prev })}`} className="btn btn-sm" aria-label="Previous">
            ←
          </Link>
          <span className="min-w-32 px-1 text-center text-sm font-medium">{title}</span>
          <Link href={`/calendar${qs({ date: next })}`} className="btn btn-sm" aria-label="Next">
            →
          </Link>
          <Link href={`/calendar${qs({ date: todayKey })}`} className="btn btn-sm">
            Today
          </Link>
        </span>
      </div>

      <FilterPanel always active={[sp.town, sp.artist, sp.status, byArtist ? "1" : ""].filter(Boolean).length}>
        <form className="card mb-4 flex flex-wrap items-end gap-3 p-3">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="date" value={anchor} />
          <label>
            <span className="label">Town</span>
            <select name="town" defaultValue={sp.town ?? ""} className="input">
              <option value="">Everywhere</option>
              {towns.map((t) => (
                <option key={t.city} value={t.city}>
                  {t.city}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Act</span>
            <select name="artist" defaultValue={sp.artist ?? ""} className="input">
              <option value="">All acts</option>
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
          <label>
            <span className="label">Colour by</span>
            <select name="colour" defaultValue={byArtist ? "artist" : "venue"} className="input">
              <option value="venue">Venue</option>
              <option value="artist">Act</option>
            </select>
          </label>
          <button className="btn">Filter</button>
        </form>
      </FilterPanel>

      {legend.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-600">
          {legend.map(([name, colour]) => (
            <span key={name} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour }} />
              {name}
            </span>
          ))}
        </div>
      )}

      {view === "day" && awayOn(anchor).length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span className="font-medium">Away this day:</span> {awayOn(anchor).map(awayText).join("; ")}
        </div>
      )}
      {view === "day" ? (
        <DayList
          items={(byDay.get(anchor) ?? []).map((b) => ({ b, a: arrivalFor(b, settings, new Date()), colour: colourOf(b) }))}
          addHref={`/bookings/new?date=${anchor}`}
        />
      ) : view === "week" ? (
        <div className="card overflow-x-auto">
          <div className="grid min-w-[1100px] grid-cols-7">
            {Array.from({ length: 7 }, (_, i) => {
              const key = addDaysToKey(gridStart, i);
              const items = byDay.get(key) ?? [];
              return (
                <div
                  key={key}
                  className={`min-h-[480px] border-r border-ink-100 last:border-r-0 ${key === todayKey ? "bg-volt-100/30" : ""}`}
                  style={sp.artist && awayOn(key).length ? AWAY_TINT : undefined}
                >
                  <div
                    className={`sticky top-0 flex items-baseline justify-between border-b border-ink-200 px-3 py-3 ${key === todayKey ? "bg-volt-100" : "bg-white"}`}
                  >
                    <Link href={`/calendar${qs({ view: "day", date: key })}`} className="hover:underline">
                      <span className="text-xs text-ink-500">{dayLabel(key, { weekday: "short" })}</span>{" "}
                      <span className="text-lg font-semibold tabular-nums">{dayLabel(key, { day: "numeric" })}</span>
                    </Link>
                    <span className="text-xs text-ink-400">{items.length || ""}</span>
                  </div>
                  <div className="space-y-1.5 p-2">
                    <AwayChips entries={awayOn(key)} max={3} />
                    {items.map((b) => (
                      <GigHover key={b.id} card={card(b)}>
                        <Link
                          href={`/bookings/${b.id}`}
                          className={`block rounded-lg border bg-white px-2.5 py-2 text-xs hover:shadow-sm ${dashed(b.status)}`}
                          style={{ borderColor: `${colourOf(b)}66`, borderLeft: `4px solid ${colourOf(b)}` }}
                        >
                          <div className="flex items-center justify-between gap-1 font-semibold tabular-nums">
                            <span>
                              {localTime(b.setStart, b.timezone)}
                              {b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}
                            </span>
                            <Moon b={b} />
                          </div>
                          <div className="mt-0.5 truncate font-medium">{byArtist ? actName(b) : (b.venue?.name ?? "No venue")}</div>
                          <div className="truncate text-ink-500">
                            {byArtist ? (b.venue?.name ?? "No venue") : actName(b)}
                            {b.venue?.city && !byArtist ? ` · ${b.venue.city}` : ""}
                          </div>
                        </Link>
                      </GigHover>
                    ))}
                    <Link
                      href={`/bookings/new?date=${key}${sp.artist ? `&artistId=${sp.artist}` : ""}`}
                      className="block rounded-lg py-1.5 text-center text-xs text-ink-300 hover:bg-ink-50 hover:text-ink-700"
                    >
                      + Add
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <div className="grid min-w-[900px] grid-cols-7 border-b border-ink-200 text-xs font-medium text-ink-500">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid min-w-[900px] grid-cols-7">
            {Array.from({ length: cells }, (_, i) => {
              const key = addDaysToKey(gridStart, i);
              const inMonth = key.startsWith(month);
              const items = byDay.get(key) ?? [];
              return (
                <div
                  key={key}
                  className={`min-h-28 border-r border-b border-ink-100 p-1.5 ${inMonth ? "" : "bg-ink-50/70"}`}
                  style={sp.artist && awayOn(key).length ? AWAY_TINT : undefined}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <Link
                      href={`/calendar${qs({ view: "week", date: key })}`}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        key === todayKey ? "bg-ink-950 font-bold text-volt-400" : inMonth ? "text-ink-700 hover:bg-ink-100" : "text-ink-400"
                      }`}
                    >
                      {Number(key.slice(8))}
                    </Link>
                    {items.length > 4 && <span className="text-[10px] text-ink-400">{items.length} bookings</span>}
                  </div>
                  <div className="space-y-1">
                    <AwayChips entries={awayOn(key)} max={2} small />
                    {items.slice(0, 4).map((b) => (
                      <GigHover key={b.id} card={card(b)}>
                        <Link
                          href={`/bookings/${b.id}`}
                          className={`flex items-center gap-1 truncate rounded px-1.5 py-1 text-[11px] leading-tight hover:brightness-95 ${dashed(b.status)} border`}
                          style={{ backgroundColor: `${colourOf(b)}1a`, borderColor: `${colourOf(b)}55` }}
                        >
                          <ArtistDot colour={colourOf(b)} />
                          <span className="tabular-nums">{localTime(b.setStart, b.timezone)}</span>
                          <span className="truncate font-medium">{byArtist ? actName(b) : (b.venue?.name ?? "No venue")}</span>
                          <Moon b={b} />
                        </Link>
                      </GigHover>
                    ))}
                    {items.length > 4 && (
                      <Link href={`/calendar${qs({ view: "week", date: key })}`} className="block px-1.5 text-[11px] font-medium text-ink-600 hover:underline">
                        + {items.length - 4} more
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Days an act is away: soft amber stripes behind the day when one act is filtered.
const AWAY_TINT = { backgroundImage: "repeating-linear-gradient(135deg, rgb(251 191 36 / 0.12) 0 8px, transparent 8px 16px)" };

const awayText = (e: AwayEntry) => `${e.own ? e.actName : `${e.actName} (in the band)`}${e.note ? `, ${e.note}` : ""}`;

/** Who's away on a calendar day, e.g. "Away: Ellie Rose". Shown in amber above the gigs, without hiding them. */
function AwayChips({ entries, max, small = false }: { entries: AwayEntry[]; max: number; small?: boolean }) {
  if (!entries.length) return null;
  const shown = entries.slice(0, max);
  return (
    <>
      {shown.map((e) => (
        <Link
          key={`${e.id}-${e.artistId}`}
          href={`/artists/${e.artistId}#away`}
          title={`Away: ${awayText(e)}`}
          className={`block truncate rounded-md border border-dashed border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 ${
            small ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]"
          }`}
        >
          Away: {awayText(e)}
        </Link>
      ))}
      {entries.length > max && (
        <div className={`px-1 text-amber-800 ${small ? "text-[10px]" : "text-[11px]"}`} title={entries.slice(max).map(awayText).join("; ")}>
          + {entries.length - max} more away
        </div>
      )}
    </>
  );
}

type DayItem = {
  b: {
    id: string;
    status: string;
    timezone: string;
    setStart: Date;
    setEnd: Date | null;
    arriveBy: Date;
    artist: { name: string; colour: string; phone: string } | null;
    venue: { id: string; name: string; city: string; colour: string } | null;
  };
  a: ReturnType<typeof arrivalFor>;
  colour: string;
};

/** One day's gigs grouped by town, with the artist's number to hand. */
function DayList({ items, addHref }: { items: DayItem[]; addHref: string }) {
  if (!items.length) {
    return (
      <Empty>
        No bookings this day.{" "}
        <Link href={addHref} className="link">
          Add one
        </Link>
      </Empty>
    );
  }
  const towns = new Map<string, DayItem[]>();
  for (const it of items) {
    const town = it.b.venue?.city || "No town set";
    towns.set(town, [...(towns.get(town) ?? []), it]);
  }
  return (
    <div className="space-y-6">
      {[...towns]
        .sort((x, y) => x[0].localeCompare(y[0]))
        .map(([town, list]) => (
          <section key={town}>
            <h2 className="section-title mb-3">
              {town} <span className="font-normal text-ink-400">· {list.length}</span>
            </h2>
            <ul className="card divide-y divide-ink-100">
              {list.map(({ b, a, colour }) => (
                <li key={b.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3" style={{ boxShadow: `inset 4px 0 0 ${colour}` }}>
                  <div className="w-28 shrink-0 font-semibold tabular-nums">
                    {localTime(b.setStart, b.timezone)}
                    {b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}
                    {b.setEnd && localDateKey(b.setEnd, b.timezone) !== localDateKey(b.arriveBy, b.timezone) && (
                      <span className="ml-1 font-normal text-ink-500" title="Finishes after midnight">
                        ☾
                      </span>
                    )}
                    <div className="text-xs font-normal text-ink-500">arrive {localTime(b.arriveBy, b.timezone)}</div>
                  </div>
                  <Link href={`/bookings/${b.id}`} className="min-w-48 flex-1">
                    <div className="font-medium hover:underline">{b.venue?.name ?? "No venue"}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-sm text-ink-700">
                      <ArtistDot colour={b.artist?.colour ?? "#a2a199"} />
                      {actName(b)}
                    </div>
                  </Link>
                  {b.artist?.phone ? (
                    <a href={`tel:${b.artist?.phone.replace(/\s/g, "")}`} className="btn btn-sm">
                      Call {b.artist?.phone}
                    </a>
                  ) : (
                    <span className="text-xs text-ink-400">No phone on file</span>
                  )}
                  <div className="w-36 text-right">{a.state !== "NOT_DUE" ? <ArrivalBadge state={a.state} /> : <StatusBadge status={b.status} />}</div>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
