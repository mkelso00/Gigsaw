import type { Metadata } from "next";
import Link from "next/link";
import { ArtistDot, Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { actName } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { isDateKey, venueColour } from "@/lib/rota";
import { formatDate, localDateKey, localTime } from "@/lib/time";
import { monthRange, venueStatement } from "@/lib/venue-statement";

export const metadata: Metadata = { title: "Venue statement" };

const valid = (s?: string) => (isDateKey(s) ? s : undefined);

/** Pick a venue and dates: the gigs played there, what the venue owes and what the acts were paid. */
export default async function VenueStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string; from?: string; to?: string; customers?: string }>;
}) {
  const user = await requireStaff();
  const sp = await searchParams;
  const settings = await getSettings(user.agencyId);
  const today = localDateKey(new Date(), settings.defaultTimezone);
  const [thisFrom, thisTo] = monthRange(today);
  const [lastFrom, lastTo] = monthRange(today, 1);
  const from = valid(sp.from) ?? lastFrom;
  const to = valid(sp.to) ?? lastTo;
  const venues = await prisma.venue.findMany({
    where: { agencyId: user.agencyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true, colour: true },
  });
  const venueId = sp.venue ?? "";
  const s = venueId ? await venueStatement(user.agencyId, venueId, from, to, sp.customers === "on") : null;
  const m = (x: number) => formatMoney(x, s?.currency ?? settings.defaultCurrency);
  const q = (extra: Record<string, string>) =>
    "?" + new URLSearchParams({ venue: venueId, from, to, ...(sp.customers ? { customers: sp.customers } : {}), ...extra }).toString();

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>
        }
        title="Venue statement"
        subtitle="Pick a venue and dates to see the gigs played there, what the venue owes you and what the acts were paid. Then print the invoice."
      />
      <form className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end">
        <label>
          <span className="label">Venue</span>
          <select name="venue" defaultValue={venueId} required className="input">
            <option value="" disabled>
              Choose a venue…
            </option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.city ? `, ${v.city}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">From</span>
          <input name="from" type="date" defaultValue={from} className="input" />
        </label>
        <label>
          <span className="label">To</span>
          <input name="to" type="date" defaultValue={to} className="input" />
        </label>
        <button className="btn btn-primary">Show</button>
        <div className="flex flex-wrap items-center gap-2 text-sm sm:col-span-2 lg:col-span-4">
          {venueId && (
            <>
              <Link href={`/reports/venues${q({ from: thisFrom, to: thisTo })}`} className="btn btn-sm">
                This month
              </Link>
              <Link href={`/reports/venues${q({ from: lastFrom, to: lastTo })}`} className="btn btn-sm">
                Last month
              </Link>
            </>
          )}
          <label className="ml-auto flex items-center gap-2 text-ink-600">
            <input type="checkbox" name="customers" defaultChecked={sp.customers === "on"} className="h-4 w-4" />
            Include gigs booked by private customers (weddings at this venue)
          </label>
        </div>
      </form>

      {!venueId ? (
        <Empty>Choose a venue above.</Empty>
      ) : !s ? (
        <Empty>Venue not found.</Empty>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: venueColour(s.venue) }} />
              {s.venue.name}
              <span className="text-base font-normal text-ink-500">
                · {formatDate(new Date(`${from}T12:00:00Z`), "UTC")} to {formatDate(new Date(`${to}T12:00:00Z`), "UTC")}
              </span>
            </h2>
            {s.rows.length > 0 && (
              <a href={`/print/venues/${s.venue.id}/statement${q({})}`} target="_blank" className="btn btn-primary">
                Printable invoice
              </a>
            )}
          </div>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Venue owes for these gigs"
              value={m(s.totals.due)}
              hint={`${s.totals.gigs} gig${s.totals.gigs === 1 ? "" : "s"}${s.totals.vat ? ` · incl. VAT ${m(s.totals.vat)}` : ""}`}
            />
            <Stat tone={s.totals.owed ? "alert" : "default"} label="Still to pay" value={m(s.totals.owed)} hint={`Received ${m(s.totals.received)}`} />
            <Stat
              label="Acts' fees"
              value={m(s.totals.cost)}
              hint={s.totals.owedToActs ? `${m(s.totals.owedToActs)} still to pay the acts` : `Paid ${m(s.totals.paidOut)}`}
            />
            <Stat tone="dark" label="Your margin" value={m(s.totals.margin)} />
          </div>
          {s.totals.unconfirmed > 0 && (
            <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {s.totals.unconfirmed} of these gig{s.totals.unconfirmed === 1 ? " isn't" : "s aren't"} confirmed yet, so {s.totals.unconfirmed === 1 ? "it isn't" : "they aren't"} on the printable invoice until confirmed.
            </p>
          )}
          {s.rows.length === 0 ? (
            <Empty>No gigs at {s.venue.name} in these dates.</Empty>
          ) : (
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Act</th>
                    <th>Status</th>
                    <th className="text-right">Venue owes</th>
                    <th className="text-right">Received</th>
                    <th className="text-right">Act&apos;s fee</th>
                    <th className="text-right">Paid to act</th>
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map(({ b, due, received, cost, paidOut }) => (
                    <tr key={b.id} className="hover:bg-ink-50">
                      <td className="whitespace-nowrap">
                        <Link href={`/bookings/${b.id}`} className="link">
                          {formatDate(b.arriveBy, b.timezone)}
                        </Link>
                        <div className="text-xs text-ink-500">
                          {localTime(b.setStart, b.timezone)}
                          {b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""} · {b.reference}
                        </div>
                      </td>
                      <td>
                        <span className="flex items-center gap-2">
                          <ArtistDot colour={b.artist?.colour ?? "#a2a199"} />
                          {actName(b)}
                        </span>
                        {b.checkIns.length > 0 && <div className="text-xs text-emerald-700">Checked in</div>}
                      </td>
                      <td>
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="text-right tabular-nums">{m(due)}</td>
                      <td className={`text-right tabular-nums ${received >= due ? "text-emerald-700" : ""}`}>{m(received)}</td>
                      <td className="text-right tabular-nums">{m(cost)}</td>
                      <td className={`text-right tabular-nums ${paidOut >= cost ? "text-emerald-700" : ""}`}>{m(paidOut)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td colSpan={3}>Total</td>
                    <td className="text-right tabular-nums">{m(s.totals.due)}</td>
                    <td className="text-right tabular-nums">{m(s.totals.received)}</td>
                    <td className="text-right tabular-nums">{m(s.totals.cost)}</td>
                    <td className="text-right tabular-nums">{m(s.totals.paidOut)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
