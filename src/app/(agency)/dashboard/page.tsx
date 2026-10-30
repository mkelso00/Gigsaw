import type { Metadata } from "next";
import Link from "next/link";
import { arrivalDetail } from "@/components/arrival-panel";
import { Icon } from "@/components/icons";
import { ArrivalBadge, ArtistDot, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { arrivalFor, bookingListInclude } from "@/lib/bookings";
import { LIVE_STATUSES, actName } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { unresolvedPastWhere } from "@/lib/billing";
import { enquiryTypeLabel, formatDay } from "@/lib/enquiries";
import { dealBreakdown, formatMoney, paymentTotals } from "@/lib/money";
import { addDaysToKey, formatDate, formatDateTime, localDateKey, localTime, formatMinutes } from "@/lib/time";
import { oneOffsNeedingAct, unfilledSlots } from "@/lib/unfilled";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireStaff();
  const settings = await getSettings(user.agencyId);
  const now = new Date();
  const DAY = 86_400_000;
  const cur = settings.defaultCurrency;

  const [upcoming, today, holds, money, activity, unresolved, unfilled, oneOffsNoAct, offers, enquiries] = await Promise.all([
    prisma.booking.findMany({
      where: { agencyId: user.agencyId, status: { in: LIVE_STATUSES }, setStart: { gte: now, lte: new Date(now.getTime() + 30 * DAY) } },
      include: { artist: { select: { colour: true, name: true } }, venue: { select: { name: true, city: true } } },
      orderBy: { setStart: "asc" },
      take: 10,
    }),
    prisma.booking.findMany({
      where: {
        agencyId: user.agencyId,
        status: { in: LIVE_STATUSES },
        arriveBy: { gte: new Date(now.getTime() - 12 * 3_600_000), lte: new Date(now.getTime() + 24 * 3_600_000) },
      },
      include: bookingListInclude,
      orderBy: { arriveBy: "asc" },
    }),
    prisma.booking.count({ where: { agencyId: user.agencyId, status: "HOLD", setStart: { gte: now } } }),
    // Bookings that still involve money moving: confirmed or settled, in the agency's main currency.
    // Every one ever, so only the columns the sums and the overdue deposits list need.
    prisma.booking.findMany({
      where: { agencyId: user.agencyId, status: { in: ["CONFIRMED", "SETTLED", "PENDING"] }, currency: cur },
      select: {
        id: true,
        reference: true,
        status: true,
        setStart: true,
        timezone: true,
        currency: true,
        dealType: true,
        feeMinor: true,
        artistFeeMinor: true,
        commissionPct: true,
        vatPct: true,
        bookingFeeMinor: true,
        depositMinor: true,
        depositDueDate: true,
        payments: { select: { direction: true, kind: true, amountMinor: true } },
        artist: { select: { name: true } },
        promoter: { select: { name: true } },
      },
    }),
    prisma.activity.findMany({ where: { agencyId: user.agencyId }, orderBy: { createdAt: "desc" }, take: 8, include: { user: { select: { name: true } } } }),
    prisma.booking.count({ where: { agencyId: user.agencyId, ...unresolvedPastWhere(now) } }),
    unfilledSlots(user.agencyId, settings.defaultTimezone, 14),
    oneOffsNeedingAct(user.agencyId, 14),
    // Offers waiting for the act's answer, and ones they've declined, soonest gig first.
    prisma.booking.findMany({
      where: { agencyId: user.agencyId, status: "AWAITING", setStart: { gte: now } },
      include: { artist: { select: { name: true, colour: true, phone: true } }, venue: { select: { name: true, city: true } } },
      orderBy: [{ offerResponse: "asc" }, { setStart: "asc" }],
      take: 30,
    }),
    // New enquiries from the website form, newest first.
    prisma.enquiry.findMany({
      where: { agencyId: user.agencyId, status: "NEW" },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, eventType: true, date: true },
      take: 50,
    }),
  ]);

  let owedByPromoters = 0;
  let owedToArtists = 0;
  let commissionThisYear = 0;
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const overdueDeposits: typeof money = [];
  for (const b of money) {
    const d = dealBreakdown(b);
    const t = paymentTotals(b.payments);
    if (b.status !== "PENDING") {
      owedByPromoters += Math.max(0, d.totalDueMinor - t.receivedMinor);
      owedToArtists += Math.max(0, d.artistMinor - t.paidOutMinor);
      if (b.setStart >= yearStart) commissionThisYear += d.agencyMinor;
    }
    if (b.depositMinor > 0 && b.depositDueDate && b.depositDueDate < now && t.depositReceivedMinor < b.depositMinor) {
      overdueDeposits.push(b);
    }
  }

  const declined = offers.filter((o) => o.offerResponse === "DECLINED");
  const waiting = offers.filter((o) => o.offerResponse !== "DECLINED");
  const unfilledSoon = unfilled.filter((u) => u.date <= addDaysToKey(localDateKey(now, settings.defaultTimezone), 6)).length;
  const todayRows = today.map((b) => ({ b, a: arrivalFor(b, settings, now) }));
  const overdue = todayRows.filter((r) => r.a.state === "OVERDUE").length;

  // Everything that needs someone, as one calm list rather than a stack of coloured banners.
  // urgent: magenta light (this week or already wrong); soon: amber; info: teal.
  const needs: { key: string; tone: "urgent" | "soon" | "info"; count: number; text: React.ReactNode; href: string; action: string }[] = [];
  if (overdue > 0)
    needs.push({
      key: "late",
      tone: "urgent",
      count: overdue,
      text: `${overdue === 1 ? "act is" : "acts are"} late right now`,
      href: "/arrivals",
      action: "Live board",
    });
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
      href: "/rota#needs-artist",
      action: "Fill",
    });
  if (oneOffsNoAct > 0)
    needs.push({
      key: "noact",
      tone: "soon",
      count: oneOffsNoAct,
      text: `other gig${oneOffsNoAct === 1 ? "" : "s"} in the next 14 days ${oneOffsNoAct === 1 ? "has" : "have"} no act yet`,
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
          new enquir{enquiries.length === 1 ? "y" : "ies"}
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
      text: `past gig${unresolved === 1 ? " is" : "s are"} still on enquiry, hold or pending`,
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
        eyebrow={formatDate(now, settings.defaultTimezone)}
        title={`Hello, ${user.name.split(" ")[0]}`}
        subtitle={
          needs.length === 0
            ? "Nothing needs you right now."
            : `${needs.length} thing${needs.length === 1 ? "" : "s"} could use you today${todayRows.length ? `, and ${todayRows.length} call time${todayRows.length === 1 ? "" : "s"} in the next 24 hours` : ""}.`
        }
      />

      {/* What needs you */}
      <section className="mb-10">
        {needs.length === 0 ? (
          <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-ink-200 bg-white px-5 py-4 text-sm text-ink-600">
            <span className="h-2 w-2 rounded-full bg-volt-400 shadow-[0_0_8px_var(--color-volt-400)]" />
            All clear. Every slot has an act, every offer is answered and nothing is overdue.
          </div>
        ) : (
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
        )}
      </section>

      <div className="mb-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          tone={overdue > 0 ? "alert" : "dark"}
          label="Arrived today"
          value={todayRows.filter((r) => r.a.state === "ARRIVED_ON_TIME" || r.a.state === "ARRIVED_LATE").length + ` / ${todayRows.length}`}
          hint={overdue > 0 ? `${overdue} overdue` : "checked in"}
          href="/arrivals"
        />
        <Stat label="Next 30 days" value={upcoming.length >= 10 ? "10+" : upcoming.length} hint={`${holds} on hold`} href="/calendar" />
        <Stat label="Owed to you" value={formatMoney(owedByPromoters, cur)} hint="by venues and clients" href="/reports" />
        <Stat
          label={`Made in ${now.getUTCFullYear()}`}
          value={formatMoney(commissionThisYear, cur)}
          hint={`${formatMoney(owedToArtists, cur)} owed to acts`}
          href="/reports"
        />
      </div>

      <div className="grid gap-x-12 gap-y-12 xl:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <div className="space-y-12">
          {/* Today as a running order: time on the left, who and where on the right. */}
          <section>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="section-title">Next 24 hours</h2>
              <Link href="/arrivals" className="text-sm text-ink-500 hover:text-ink-950">
                Live board →
              </Link>
            </div>
            {todayRows.length === 0 ? (
              <p className="text-sm text-ink-500">No call times in the next 24 hours.</p>
            ) : (
              <ol className="relative space-y-1 before:absolute before:top-2 before:bottom-2 before:left-[69.5px] before:w-px before:bg-ink-200">
                {todayRows.map(({ b, a }) => (
                  <li key={b.id}>
                    <Link href={`/bookings/${b.id}`} className="group flex items-center gap-4 rounded-lg py-2.5 pr-2 transition-colors hover:bg-white">
                      <span className="w-12 shrink-0 text-right font-mono text-sm text-ink-500 tabular-nums">{localTime(b.arriveBy, b.timezone)}</span>
                      <span className="relative z-10 flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-ink-50 group-hover:bg-white">
                        <ArtistDot colour={b.artist?.colour ?? "#8d949c"} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {actName(b)} <span className="font-normal text-ink-500">· {b.venue?.name ?? "No venue"}</span>
                        </span>
                        <span className="block truncate text-xs text-ink-500">{arrivalDetail(a, b.timezone) || "Not checked in yet"}</span>
                      </span>
                      <ArrivalBadge state={a.state} />
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="section-title">Coming up</h2>
              <Link href="/calendar" className="text-sm text-ink-500 hover:text-ink-950">
                Calendar →
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-sm text-ink-500">No shows in the next 30 days.</p>
            ) : (
              <ul className="space-y-1">
                {upcoming.map((b, i) => {
                  // The day shows once, on its first gig, so the list reads as a running order.
                  const day = formatDate(b.arriveBy, b.timezone);
                  const firstOfDay = i === 0 || formatDate(upcoming[i - 1].arriveBy, upcoming[i - 1].timezone) !== day;
                  return (
                    <li key={b.id} className={firstOfDay && i > 0 ? "pt-3" : ""}>
                      <Link href={`/bookings/${b.id}`} className="flex items-center gap-4 rounded-lg py-2.5 pr-2 transition-colors hover:bg-white">
                        <span className="w-12 shrink-0 text-right leading-tight">
                          {firstOfDay && (
                            <>
                              <span className="block font-mono text-[10px] tracking-wider text-ink-400 uppercase">{day.split(" ")[0].replace(",", "")}</span>
                              <span className="block font-mono text-sm text-ink-700 tabular-nums">{day.split(" ")[1]}</span>
                            </>
                          )}
                        </span>
                        <ArtistDot colour={b.artist?.colour ?? "#8d949c"} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{actName(b)}</span>
                          <span className="block truncate text-xs text-ink-500">
                            {b.venue ? `${b.venue.name}${b.venue.city ? `, ${b.venue.city}` : ""}` : "No venue"}
                          </span>
                        </span>
                        <StatusBadge status={b.status} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-12">
          {waiting.length > 0 && (
            <section>
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="section-title">Waiting for an answer</h2>
                <span className="font-mono text-xs text-ink-500">{waiting.length} out</span>
              </div>
              <ul className="space-y-1">
                {waiting.slice(0, 6).map((o) => (
                  <li key={o.id} className="flex items-center gap-3 rounded-lg py-2 pr-1">
                    <Link href={`/bookings/${o.id}`} className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium hover:underline">{actName(o)}</span>
                      <span className="block truncate text-xs text-ink-500">
                        {o.venue?.name ?? "No venue"}, {formatDate(o.arriveBy, o.timezone)} ·{" "}
                        {o.offeredAt ? `offered ${formatMinutes(Math.round((now.getTime() - o.offeredAt.getTime()) / 60_000))} ago` : "not sent yet"}
                      </span>
                    </Link>
                    {o.artist?.phone && (
                      <a href={`tel:${o.artist.phone.replace(/\s/g, "")}`} className="btn btn-sm">
                        Call
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              {waiting.length > 6 && (
                <Link href="/bookings?status=AWAITING" className="mt-2 inline-block text-sm text-ink-500 hover:text-ink-950">
                  {waiting.length - 6} more →
                </Link>
              )}
            </section>
          )}

          <section>
            <h2 className="section-title mb-4">Recent activity</h2>
            {activity.length === 0 ? (
              <p className="text-sm text-ink-500">Nothing yet.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-ink-200 pl-5">
                {activity.map((a) => {
                  const href =
                    a.entity === "BOOKING" && a.action !== "deleted"
                      ? `/bookings/${a.entityId}`
                      : a.entity === "EVENT" && a.action !== "deleted"
                        ? `/events/${a.entityId}`
                        : a.entity === "ENQUIRY" && !a.action.includes("deleted")
                          ? `/enquiries?view=all#${a.entityId}`
                          : null;
                  const body = (
                    <>
                      <span className="font-medium">{a.user?.name ?? "Someone"}</span> {a.action}
                      {a.detail && <span className="text-ink-500"> · {a.detail}</span>}
                    </>
                  );
                  return (
                    <li key={a.id} className="relative text-sm">
                      <span className="absolute top-1.5 -left-[23.5px] h-2 w-2 rounded-full border-2 border-ink-50 bg-ink-300" />
                      {href ? (
                        <Link href={href} className="hover:underline">
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                      <div className="mt-0.5 font-mono text-[11px] text-ink-400">{formatDateTime(a.createdAt, settings.defaultTimezone)}</div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
