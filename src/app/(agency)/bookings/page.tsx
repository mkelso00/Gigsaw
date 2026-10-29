import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { archiveBookings, deleteBookings, restoreBookings } from "@/actions/bookings";
import { SelectAll, SelectedAction } from "@/components/client-bits";
import { ArrivalBadge, ArtistDot, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { arrivalFor, bookingListInclude } from "@/lib/bookings";
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, EVENT_TYPES, EVENT_TYPE_LABELS, eventTypeLabel, actName } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { unresolvedPastWhere } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
import { formatDate, localTime } from "@/lib/time";

export const metadata: Metadata = { title: "Bookings" };

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const archived = sp.view === "archived";
  const when = archived ? "all" : sp.when === "past" ? "past" : sp.when === "all" ? "all" : "upcoming";
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const where: Prisma.BookingWhereInput = { agencyId: user.agencyId, ...(archived ? { archivedAt: { not: null } } : {}) };
  if (sp.status && (BOOKING_STATUSES as readonly string[]).includes(sp.status)) where.status = sp.status;
  const unresolved = sp.status === "UNRESOLVED";
  if (unresolved) Object.assign(where, unresolvedPastWhere());
  if (sp.artist === "none" || sp.act === "none") where.artistId = null;
  else if (sp.artist) where.artistId = sp.artist;
  if (sp.type && (EVENT_TYPES as readonly string[]).includes(sp.type)) where.eventType = sp.type;
  if (when === "upcoming" && !unresolved) where.setStart = { gte: dayAgo };
  if (when === "past") where.setStart = { lt: now };
  if (sp.q) {
    where.OR = [
      { reference: { contains: sp.q, mode: "insensitive" } },
      { eventName: { contains: sp.q, mode: "insensitive" } },
      { tags: { contains: sp.q, mode: "insensitive" } },
      { venue: { name: { contains: sp.q, mode: "insensitive" } } },
      { venue: { city: { contains: sp.q, mode: "insensitive" } } },
      { promoter: { name: { contains: sp.q, mode: "insensitive" } } },
      { artist: { name: { contains: sp.q, mode: "insensitive" } } },
    ];
  }

  const [bookings, artists, settings, archivedCount] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: bookingListInclude,
      orderBy: { setStart: when === "past" ? "desc" : "asc" },
      take: 300,
    }),
    prisma.artist.findMany({ where: { agencyId: user.agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSettings(user.agencyId),
    prisma.booking.count({ where: { agencyId: user.agencyId, archivedAt: { not: null } } }),
  ]);
  const isAdmin = user.role === "ADMIN";

  return (
    <div>
      <PageHeader
        title={archived ? "Archived bookings" : "Bookings"}
        subtitle={
          archived
            ? "Tidied away: not in any list, calendar or report. Restore them, or delete them for good."
            : "Every show from first hold to final settlement."
        }
        actions={
          <>
            {archived ? (
              <Link href="/bookings" className="btn">
                Back to bookings
              </Link>
            ) : (
              archivedCount > 0 && (
                <Link href="/bookings?view=archived" className="btn">
                  Archived ({archivedCount})
                </Link>
              )
            )}
            <a href={`/api/export/bookings${sp.artist ? `?artist=${sp.artist}` : ""}`} className="btn">
              Export CSV
            </a>
            <Link href="/bookings/new" className="btn btn-primary">
              New booking
            </Link>
          </>
        }
      />

      <form className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        {archived && <input type="hidden" name="view" value="archived" />}
        <label className="min-w-48 flex-1">
          <span className="label">Search</span>
          <input name="q" defaultValue={sp.q} placeholder="Reference, venue, city, promoter, tag" className="input" />
        </label>
        <label>
          <span className="label">Artist</span>
          <select name="artist" defaultValue={sp.artist ?? ""} className="input">
            <option value="">All acts</option>
            <option value="none">No act yet</option>
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
            <option value="">Any status</option>
            <option value="UNRESOLVED">Past, never confirmed</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {BOOKING_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Type</span>
          <select name="type" defaultValue={sp.type ?? ""} className="input">
            <option value="">Any type</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">When</span>
          <select name="when" defaultValue={when} className="input">
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
            <option value="all">All dates</option>
          </select>
        </label>
        <button className="btn">Filter</button>
      </form>

      {bookings.length === 0 ? (
        <Empty>
          No bookings match.{" "}
          <Link href="/bookings/new" className="link">
            Create one
          </Link>
        </Empty>
      ) : (
        <form action="/bookings/bulk" method="get" className="card overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
            <span className="text-sm text-ink-500">
              {archived
                ? "Tick bookings to restore them or delete them for good."
                : "Tick gigs to change their times or fee together and tell the acts, or to archive them."}
            </span>
            <span className="flex flex-wrap gap-2">
              {archived ? (
                <>
                  <SelectedAction
                    name="ids"
                    action={restoreBookings}
                    label="Restore selected"
                    confirm="Restore {n} booking{s}? They go back into your lists and calendar."
                  />
                  {isAdmin && (
                    <SelectedAction
                      name="ids"
                      action={deleteBookings}
                      label="Delete for good"
                      confirm="Delete {n} booking{s} for good? Their payments and check-ins go too. This can't be undone."
                      danger
                    />
                  )}
                </>
              ) : (
                <>
                  <button className="btn btn-sm">Change selected gigs</button>
                  <SelectedAction
                    name="ids"
                    action={archiveBookings}
                    label="Archive selected"
                    confirm="Archive {n} booking{s}? They leave your lists and calendar, and acts aren't told. You can restore them from Archived."
                  />
                </>
              )}
            </span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th className="w-10">
                  <SelectAll name="ids" />
                </th>
                <th>Date</th>
                <th>Artist</th>
                <th>Venue</th>
                <th>Status</th>
                <th className="text-right">Fee</th>
                <th>Arrival</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => {
                const arrival = arrivalFor(b, settings, now);
                return (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td>
                      <input type="checkbox" name="ids" value={b.id} aria-label={`Select ${b.reference}`} className="h-4 w-4 accent-ink-950" />
                    </td>
                    <td className="whitespace-nowrap">
                      <Link href={`/bookings/${b.id}`} className="link">
                        {formatDate(b.arriveBy, b.timezone)}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {b.reference} · on stage {localTime(b.setStart, b.timezone)}
                      </div>
                    </td>
                    <td>
                      <span className="flex items-center gap-2">
                        <ArtistDot colour={b.artist?.colour ?? "#a2a199"} />
                        {actName(b)}
                      </span>
                      <div className="text-xs text-slate-500">
                        {eventTypeLabel(b.eventType)}
                        {b.eventName ? ` · ${b.eventName}` : ""}
                      </div>
                    </td>
                    <td>
                      {b.venue ? b.venue.name : <span className="text-slate-400">No venue</span>}
                      {b.venue?.city && <div className="text-xs text-slate-500">{b.venue.city}</div>}
                    </td>
                    <td>
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="text-right whitespace-nowrap">{formatMoney(b.feeMinor, b.currency)}</td>
                    <td>{arrival.state !== "NOT_DUE" && <ArrivalBadge state={arrival.state} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </form>
      )}
    </div>
  );
}
