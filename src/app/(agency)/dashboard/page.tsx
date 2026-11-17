import type { Metadata } from "next";
import Link from "next/link";
import { NewBookingButton } from "@/components/calendar-add";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { unresolvedPastWhere } from "@/lib/billing";
import { daySummary, gigTone } from "@/lib/calendar-look";
import { eventTypeLabel } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { enquiryTypeLabel, formatDay } from "@/lib/enquiries";
import { dealBreakdown, formatMoney, paymentTotals } from "@/lib/money";
import { venueColour } from "@/lib/rota";
import { addDaysToKey, formatDate, localDateKey, zonedToUtc } from "@/lib/time";
import { oneOffsNeedingAct, unfilledSlots } from "@/lib/unfilled";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const DAYS_SHOWN = 14;
const VENUES_SHOWN = 10;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const user = await requireStaff();
  const settings = await getSettings(user.agencyId);
  const now = new Date();
  const cur = settings.defaultCurrency;
  const tz = settings.defaultTimezone;

  const todayKey = localDateKey(now, tz);
  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => addDaysToKey(todayKey, i));
  // The month the lower half of the page shows: this one, or ?month=YYYY-MM.
  const thisMonth = todayKey.slice(0, 7);
  const shownMonth = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : thisMonth;
  const monthStart = `${shownMonth}-01`;
  const [my, mm] = shownMonth.split("-").map(Number);
  const nextMonthStart = new Date(Date.UTC(my, mm, 1)).toISOString().slice(0, 10);
  const prevMonth = new Date(Date.UTC(my, mm - 2, 1)).toISOString().slice(0, 7);
  const monthLabel = new Date(Date.UTC(my, mm - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const monthHref = (m: string) => (m === thisMonth ? "/dashboard#month" : `/dashboard?month=${m}#month`);
  // A day either side, then sorted by each gig's own local date, as the calendar does.
  const windowFrom = (key: string) => new Date(zonedToUtc(key, "00:00", tz).getTime() - 86_400_000);
  const windowTo = (key: string) => new Date(zonedToUtc(key, "00:00", tz).getTime() + 86_400_000);

  const [upcoming, month, deposits, unresolved, unfilled, oneOffsNoAct, declined, enquiries, proposalsOut, events, monthLeads] = await Promise.all([
    prisma.booking.findMany({
      where: {
        agencyId: user.agencyId,
        status: { not: "CANCELLED" },
        arriveBy: {
          gte: windowFrom(todayKey),
          lt: windowTo(addDaysToKey(todayKey, DAYS_SHOWN)),
        },
      },
      select: { status: true, artistId: true, arriveBy: true, timezone: true },
    }),
    prisma.booking.findMany({
      where: {
        agencyId: user.agencyId,
        status: { not: "CANCELLED" },
        arriveBy: { gte: windowFrom(monthStart), lt: windowTo(nextMonthStart) },
      },
      select: {
        status: true,
        artistId: true,
        arriveBy: true,
        timezone: true,
        currency: true,
        dealType: true,
        feeMinor: true,
        artistFeeMinor: true,
        commissionPct: true,
        vatPct: true,
        bookingFeeMinor: true,
        venue: { select: { id: true, name: true, colour: true } },
      },
    }),
    // Deposits past their due date, to chase.
    prisma.booking.findMany({
      where: {
        agencyId: user.agencyId,
        status: { in: ["CONFIRMED", "SETTLED", "PENDING"] },
        depositMinor: { gt: 0 },
        depositDueDate: { lt: now },
      },
      select: {
        id: true,
        depositMinor: true,
        payments: {
          select: { direction: true, kind: true, amountMinor: true },
        },
      },
    }),
    prisma.booking.count({
      where: { agencyId: user.agencyId, ...unresolvedPastWhere(now) },
    }),
    unfilledSlots(user.agencyId, tz, 14),
    oneOffsNeedingAct(user.agencyId, 14),
    prisma.booking.findMany({
      where: {
        agencyId: user.agencyId,
        status: "AWAITING",
        offerResponse: "DECLINED",
        setStart: { gte: now },
      },
      select: { id: true },
      orderBy: { setStart: "asc" },
    }),
    // New enquiries from the website form, newest first.
    prisma.enquiry.findMany({
      where: { agencyId: user.agencyId, status: "NEW" },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, eventType: true, date: true },
      take: 50,
    }),
    // Proposals with the customer, still open.
    prisma.quote.count({
      where: {
        agencyId: user.agencyId,
        supersededById: null,
        status: { in: ["SENT", "VIEWED"] },
        OR: [{ validUntil: null }, { validUntil: { gte: todayKey } }],
      },
    }),
    // Weddings and other events on a day in the month shown.
    prisma.event.findMany({
      where: { agencyId: user.agencyId, status: "ACTIVE", date: { gte: monthStart, lt: nextMonthStart } },
      orderBy: { date: "asc" },
      select: {
        id: true,
        name: true,
        type: true,
        date: true,
        venueText: true,
        venue: { select: { name: true } },
        bookings: { where: { status: { not: "CANCELLED" } }, select: { status: true, artistId: true } },
      },
    }),
    // Enquiries for a date in the month shown, open ones first.
    prisma.enquiry.findMany({
      where: { agencyId: user.agencyId, date: { gte: monthStart, lt: nextMonthStart } },
      orderBy: [{ status: "desc" }, { date: "asc" }],
      select: {
        id: true,
        name: true,
        eventType: true,
        date: true,
        venue: true,
        guests: true,
        budget: true,
        status: true,
        quotes: { select: { status: true } },
      },
    }),
  ]);

  const overdueDeposits = deposits.filter((b) => paymentTotals(b.payments).depositReceivedMinor < b.depositMinor);
  const unfilledSoon = unfilled.filter((u) => u.date <= addDaysToKey(todayKey, 6)).length;

  const byDay = new Map<string, typeof upcoming>();
  for (const b of upcoming) {
    const key = localDateKey(b.arriveBy, b.timezone);
    byDay.set(key, [...(byDay.get(key) ?? []), b]);
  }

  // Venue numbers for this month. Money only counts bookings in the main currency, and only once
  // confirmed or settled, so a pencilled-in date doesn't look like money in the bank.
  const venues = new Map<string, VenueRow>();
  const totals = { gigs: 0, sale: 0, profit: 0 };
  for (const b of month) {
    const key = localDateKey(b.arriveBy, b.timezone);
    if (key < monthStart || key >= nextMonthStart) continue;
    const id = b.venue?.id ?? "none";
    const row =
      venues.get(id) ??
      (b.venue
        ? {
            id,
            name: b.venue.name,
            colour: venueColour(b.venue),
            href: `/venues/${b.venue.id}`,
            gigs: 0,
            confirmed: 0,
            open: 0,
            sale: 0,
            profit: 0,
          }
        : {
            id,
            name: "No venue",
            colour: "#a2a199",
            href: null,
            gigs: 0,
            confirmed: 0,
            open: 0,
            sale: 0,
            profit: 0,
          });
    venues.set(id, row);
    const tone = gigTone(b.status, !!b.artistId);
    row.gigs++;
    totals.gigs++;
    if (tone === "on") row.confirmed++;
    else if (tone === "pending" || tone === "awaiting") row.open++;
    if (tone === "on" && b.currency === cur) {
      const d = dealBreakdown(b);
      row.sale += d.grossMinor;
      row.profit += d.agencyMinor;
      totals.sale += d.grossMinor;
      totals.profit += d.agencyMinor;
    }
  }
  const venueRows = [...venues.values()].sort((x, y) => y.gigs - x.gigs || x.name.localeCompare(y.name));

  // Everything that needs someone, as one calm list rather than a stack of coloured banners.
  // urgent: magenta light (this week or already wrong); soon: amber; info: teal.
  const needs: {
    key: string;
    tone: "urgent" | "soon" | "info";
    count: number;
    text: React.ReactNode;
    href: string;
    action: string;
  }[] = [];
  if (declined.length > 0)
    needs.push({
      key: "declined",
      tone: "urgent",
      count: declined.length,
      text: `offer${declined.length === 1 ? " was" : "s were"} turned down: find another act`,
      href: `/bookings/${declined[0].id}`,
      action: "Re-offer",
    });
  if (unfilled.length > 0)
    needs.push({
      key: "unfilled",
      tone: unfilledSoon ? "urgent" : "soon",
      count: unfilled.length,
      text: `weekly slot${unfilled.length === 1 ? "" : "s"} in the next 14 days need${unfilled.length === 1 ? "s" : ""} an act${unfilledSoon ? `, ${unfilledSoon} this week` : ""}`,
      href: "/calendar",
      action: "Fill",
    });
  if (oneOffsNoAct > 0)
    needs.push({
      key: "noact",
      tone: "soon",
      count: oneOffsNoAct,
      text: `other booking${oneOffsNoAct === 1 ? "" : "s"} in the next 14 days ${oneOffsNoAct === 1 ? "has" : "have"} no act yet`,
      href: "/bookings?artist=none",
      action: "See",
    });
  if (enquiries.length > 0)
    needs.push({
      key: "enquiries",
      tone: "info",
      count: enquiries.length,
      text: (
        <>
          new lead{enquiries.length === 1 ? "" : "s"}
          <span className="text-ink-500">
            {" "}
            · latest{" "}
            {[enquiries[0].name, enquiryTypeLabel(enquiries[0].eventType).toLowerCase(), enquiries[0].date ? formatDay(enquiries[0].date) : ""]
              .filter(Boolean)
              .join(", ")}
          </span>
        </>
      ),
      href: "/enquiries",
      action: "Reply",
    });
  if (proposalsOut > 0)
    needs.push({
      key: "proposals-out",
      tone: "info",
      count: proposalsOut,
      text: `proposal${proposalsOut === 1 ? " is" : "s are"} waiting for the customer's answer`,
      href: "/enquiries?view=quotes",
      action: "See",
    });
  if (overdueDeposits.length > 0)
    needs.push({
      key: "deposits",
      tone: "soon",
      count: overdueDeposits.length,
      text: `deposit${overdueDeposits.length === 1 ? " is" : "s are"} overdue`,
      href: `/bookings/${overdueDeposits[0].id}`,
      action: "Chase",
    });
  if (unresolved > 0)
    needs.push({
      key: "unresolved",
      tone: "soon",
      count: unresolved,
      text: `past booking${unresolved === 1 ? " is" : "s are"} still on enquiry, hold or pending`,
      href: "/bookings?status=UNRESOLVED&when=all",
      action: "Tidy up",
    });
  const LIGHT = {
    urgent: "bg-cue-500 shadow-[0_0_8px_var(--color-cue-400)]",
    soon: "bg-amber-400",
    info: "bg-volt-400 shadow-[0_0_8px_var(--color-volt-400)]",
  };

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        eyebrow={formatDate(now, tz)}
        title={`Hello, ${user.name.split(" ")[0]}`}
        subtitle={needs.length === 0 ? "Nothing needs you right now." : `${needs.length} thing${needs.length === 1 ? "" : "s"} could use you today.`}
      />

      {/* Only shows when something needs doing, so a quiet day is a short page. */}
      {needs.length > 0 && (
        <section className="mb-10">
          <ul className="overflow-hidden rounded-[var(--radius-card)] border border-ink-200 bg-white">
            {needs.map((n, i) => (
              <li key={n.key} className={i > 0 ? "border-t border-ink-100" : ""}>
                <Link href={n.href} className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-ink-50">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${LIGHT[n.tone]}`} />
                  <span className="w-7 shrink-0 font-mono text-[15px] font-semibold tabular-nums">{n.count}</span>
                  <span className="min-w-0 flex-1 text-sm">{n.text}</span>
                  <span className="hidden shrink-0 text-sm text-ink-500 transition-colors group-hover:text-ink-950 sm:inline">{n.action} →</span>
                  <Icon name="chevron" className="h-4 w-4 shrink-0 text-ink-300 sm:hidden" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The next two weeks at a glance: how many gigs each day, and how many still need something. */}
      <section className="mb-12">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="section-title">Next two weeks</h2>
          <Link href="/calendar" className="text-sm text-ink-500 hover:text-ink-950">
            Full calendar →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
          {days.map((key) => {
            const tones = (byDay.get(key) ?? []).map((b) => gigTone(b.status, !!b.artistId));
            const [y, m, d] = key.split("-").map(Number);
            const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            });
            const isToday = key === todayKey;
            return (
              <div key={key} className={`card relative flex min-h-28 flex-col p-3 ${isToday ? "ring-2 ring-volt-400" : ""}`}>
                <Link href={`/calendar?view=day&date=${key}`} className="flex flex-1 flex-col">
                  <span className={`font-mono text-[11px] tracking-wider uppercase ${isToday ? "text-ink-950" : "text-ink-500"}`}>
                    {isToday ? "Today" : label}
                  </span>
                  <span className="mt-1 font-mono text-2xl font-semibold tabular-nums">{tones.length}</span>
                  <span className="text-xs text-ink-500">{tones.length === 1 ? "gig" : "gigs"}</span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    {tones.length > 0 && tones.every((t) => t === "on" || t === "cancelled") && (
                      <span className="text-[11px] font-medium text-emerald-700">All confirmed</span>
                    )}
                    {daySummary(tones)
                      .filter((t) => t.tone !== "on" && t.tone !== "cancelled")
                      .map((t) => (
                        <span key={t.tone} className={`gig gig-${t.tone} rounded px-1.5 py-0.5 text-[10.5px] leading-tight`}>
                          {t.label}
                        </span>
                      ))}
                  </span>
                </Link>
                <NewBookingButton
                  date={key}
                  className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full text-sm leading-none text-ink-400 hover:bg-ink-950 hover:text-white"
                >
                  <span aria-hidden>+</span>
                  <span className="sr-only">Add a booking on {label}</span>
                </NewBookingButton>
              </div>
            );
          })}
        </div>
      </section>

      {/* Everything below follows the month picked here. */}
      <div id="month" className="mb-6 flex scroll-mt-6 flex-wrap items-center gap-2 border-t border-ink-200 pt-8">
        <Link href={monthHref(prevMonth)} className="btn btn-sm" aria-label="Previous month">
          ←
        </Link>
        <h2 className="min-w-40 text-center text-lg font-semibold">{monthLabel}</h2>
        <Link href={monthHref(nextMonthStart.slice(0, 7))} className="btn btn-sm" aria-label="Next month">
          →
        </Link>
        {shownMonth !== thisMonth && (
          <Link href={monthHref(thisMonth)} className="btn btn-sm">
            This month
          </Link>
        )}
      </div>

      <div className="mb-12 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="section-title">Weddings and events</h3>
            <Link href="/events" className="text-sm text-ink-500 hover:text-ink-950">
              All →
            </Link>
          </div>
          {events.length === 0 ? (
            <p className="card px-4 py-5 text-sm text-ink-500">No weddings or events in {monthLabel}.</p>
          ) : (
            <ul className="card divide-y divide-ink-100">
              {events.map((e) => {
                const tones = e.bookings.map((b) => gigTone(b.status, !!b.artistId));
                const open = tones.filter((t) => t === "pending" || t === "awaiting").length;
                return (
                  <li key={e.id}>
                    <Link href={`/events/${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50">
                      <span className="w-14 shrink-0 font-mono text-xs text-ink-500">{formatDay(e.date).split(" ").slice(0, 2).join(" ")}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{e.name}</span>
                        <span className="block truncate text-xs text-ink-500">
                          {[e.type !== "WEDDING" ? eventTypeLabel(e.type) : "", e.venue?.name ?? e.venueText].filter(Boolean).join(" · ") || "No venue yet"}
                        </span>
                      </span>
                      <span className={`shrink-0 text-xs ${tones.length === 0 || open > 0 ? "font-medium text-amber-700" : "text-emerald-700"}`}>
                        {tones.length === 0
                          ? "No acts yet"
                          : open > 0
                            ? `${open} of ${tones.length} acts to sort`
                            : `${tones.length} act${tones.length === 1 ? "" : "s"} booked`}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="section-title">Enquiries</h3>
            <Link href="/enquiries" className="text-sm text-ink-500 hover:text-ink-950">
              All leads →
            </Link>
          </div>
          {monthLeads.length === 0 ? (
            <p className="card px-4 py-5 text-sm text-ink-500">No enquiries for a date in {monthLabel}.</p>
          ) : (
            <ul className="card divide-y divide-ink-100">
              {monthLeads.map((q) => {
                const quote = q.quotes.find((x) => x.status === "ACCEPTED") ?? q.quotes.find((x) => x.status === "SENT" || x.status === "VIEWED");
                const state =
                  q.status !== "NEW"
                    ? { text: "Dealt with", cls: "text-ink-400" }
                    : quote?.status === "ACCEPTED"
                      ? { text: "Proposal accepted", cls: "text-emerald-700" }
                      : quote
                        ? { text: "Proposal sent", cls: "text-ink-600" }
                        : { text: "Needs a reply", cls: "font-medium text-amber-700" };
                return (
                  <li key={q.id}>
                    <Link href={`/enquiries?view=all#${q.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50">
                      <span className="w-14 shrink-0 font-mono text-xs text-ink-500">{formatDay(q.date).split(" ").slice(0, 2).join(" ")}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {q.name}
                          {q.eventType && <span className="font-normal text-ink-500"> · {enquiryTypeLabel(q.eventType)}</span>}
                        </span>
                        <span className="block truncate text-xs text-ink-500">
                          {[q.venue, q.guests ? `${q.guests} guests` : "", q.budget].filter(Boolean).join(" · ") || "No details yet"}
                        </span>
                      </span>
                      <span className={`shrink-0 text-xs ${state.cls}`}>{state.text}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* The month by venue: gigs, what's still open, and the money in the main currency. */}
      <section>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="section-title">Venues</h3>
          <span className="text-sm text-ink-500">
            {totals.gigs} gig{totals.gigs === 1 ? "" : "s"} · {formatMoney(totals.sale, cur)} sale · {formatMoney(totals.profit, cur)} profit
          </span>
        </div>
        {venueRows.length === 0 ? (
          <p className="text-sm text-ink-500">No gigs booked in {monthLabel} yet.</p>
        ) : (
          <>
            <VenueTable rows={venueRows.slice(0, VENUES_SHOWN)} cur={cur} />
            {venueRows.length > VENUES_SHOWN && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-ink-500 hover:text-ink-950">Show the other {venueRows.length - VENUES_SHOWN} venues</summary>
                <div className="mt-3">
                  <VenueTable rows={venueRows.slice(VENUES_SHOWN)} cur={cur} />
                </div>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}

type VenueRow = {
  id: string;
  name: string;
  colour: string;
  href: string | null;
  gigs: number;
  confirmed: number;
  open: number;
  sale: number;
  profit: number;
};

function VenueTable({ rows, cur }: { rows: VenueRow[]; cur: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink-100 text-left font-mono text-[10.5px] tracking-[0.12em] text-ink-500 uppercase">
            <th className="px-4 py-3 font-medium">Venue</th>
            <th className="px-3 py-3 text-right font-medium">Gigs</th>
            <th className="px-3 py-3 text-right font-medium">Confirmed</th>
            <th className="px-3 py-3 text-right font-medium">To sort</th>
            <th className="px-3 py-3 text-right font-medium">Sale</th>
            <th className="px-4 py-3 text-right font-medium">Profit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className="border-b border-ink-100 last:border-0 hover:bg-ink-50">
              <td className="px-4 py-2.5">
                {v.href ? (
                  <Link href={v.href} className="flex items-center gap-2 font-medium hover:underline">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: v.colour }} />
                    <span className="truncate">{v.name}</span>
                  </Link>
                ) : (
                  <span className="flex items-center gap-2 text-ink-500">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: v.colour }} />
                    {v.name}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">{v.gigs}</td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">{v.confirmed}</td>
              <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${v.open > 0 ? "font-semibold text-amber-700" : "text-ink-400"}`}>{v.open}</td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatMoney(v.sale, cur)}</td>
              <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatMoney(v.profit, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
