import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { autoDone, eventTotals, sentEventMessagesFor } from "@/lib/events";
import { formatMoney } from "@/lib/money";
import { localDateKey } from "@/lib/time";
import { actName } from "@/lib/constants";

export const metadata: Metadata = { title: "Weddings & events" };

const TYPE: Record<string, string> = { WEDDING: "Wedding", PRIVATE_PARTY: "Private party", CORPORATE: "Corporate", OTHER: "Event" };
const dayLabel = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ when?: string }> }) {
  const user = await requireStaff();
  const { when } = await searchParams;
  const settings = await getSettings(user.agencyId);
  const today = localDateKey(new Date(), settings.defaultTimezone);
  const past = when === "past";
  const events = await prisma.event.findMany({
    where: { agencyId: user.agencyId, date: past ? { lt: today } : { gte: today } },
    include: {
      customer: { select: { name: true } },
      venue: { select: { name: true, city: true } },
      tasks: true,
      bookings: { where: { archivedAt: null }, include: { payments: true, artist: { select: { name: true } } }, orderBy: { setStart: "asc" } },
    },
    orderBy: { date: past ? "desc" : "asc" },
    take: 200,
  });
  const sentByEvent = await sentEventMessagesFor(events.map((e) => e.id));
  const rows = events.map((e) => {
    const totals = eventTotals(e.bookings);
    const sent = sentByEvent.get(e.id)!;
    const done = e.tasks.filter((t) => t.doneAt || autoDone(t.key, e, totals, sent)).length;
    const overdue = e.tasks.some((t) => !t.doneAt && !autoDone(t.key, e, totals, sent) && t.dueDate && t.dueDate < today);
    return { e, totals, done, overdue };
  });

  return (
    <div>
      <PageHeader
        title="Weddings & events"
        subtitle="One booking per customer, with every act they've booked. Each act only sees its own gig and fee."
        actions={
          <Link href="/events/new" className="btn btn-primary">
            New wedding or event
          </Link>
        }
      />
      <div className="mb-6 inline-flex gap-1 rounded-xl border border-ink-200 bg-white p-1 text-sm">
        <Link href="/events" className={`rounded-lg px-3.5 py-2 font-medium ${!past ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-ink-100"}`}>
          Coming up
        </Link>
        <Link href="/events?when=past" className={`rounded-lg px-3.5 py-2 font-medium ${past ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-ink-100"}`}>
          Past
        </Link>
      </div>
      {rows.length === 0 ? (
        <Empty>
          {past ? "No past weddings or events." : "Nothing coming up."}{" "}
          <Link href="/events/new" className="link">
            Add a wedding or event
          </Link>
          .
        </Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Event</th>
                <th>Acts</th>
                <th>Checklist</th>
                <th>Details</th>
                <th className="text-right">Customer total</th>
                <th className="text-right">Left to pay</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, totals, done, overdue }) => (
                <tr key={e.id} className="hover:bg-ink-50">
                  <td className="whitespace-nowrap">
                    <div className="font-medium">{dayLabel(e.date)}</div>
                    <div className="text-xs text-ink-500">{TYPE[e.type] ?? "Event"}</div>
                  </td>
                  <td>
                    <Link href={`/events/${e.id}`} className="link">
                      {e.name}
                    </Link>
                    {e.status === "CANCELLED" && <span className="badge ml-2 bg-ink-100 text-ink-500">Cancelled</span>}
                    <div className="text-xs text-ink-500">
                      {[e.customer?.name, e.venue ? `${e.venue.name}${e.venue.city ? `, ${e.venue.city}` : ""}` : e.venueText].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="text-sm">
                    {e.bookings
                      .filter((b) => b.status !== "CANCELLED")
                      .map((b) => actName(b))
                      .join(", ") || <span className="text-amber-700">No acts yet</span>}
                  </td>
                  <td>
                    <span
                      className={`badge ${overdue ? "bg-rose-50 text-rose-800" : done === e.tasks.length ? "bg-emerald-50 text-emerald-800" : "bg-ink-100 text-ink-700"}`}
                    >
                      {done} / {e.tasks.length}
                      {overdue ? " · overdue" : ""}
                    </span>
                  </td>
                  <td>
                    {e.plannerDoneAt ? (
                      <span className="badge bg-emerald-50 text-emerald-800">Received</span>
                    ) : e.plannerSentAt ? (
                      <span className="badge bg-amber-50 text-amber-800">Asked</span>
                    ) : (
                      <span className="text-xs text-ink-400">Not asked yet</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">{totals.total ? formatMoney(totals.total, totals.currency) : "–"}</td>
                  <td className={`text-right tabular-nums ${totals.outstanding ? "font-medium" : "text-ink-400"}`}>
                    {totals.total ? formatMoney(totals.outstanding, totals.currency) : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
