import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatRange, replyCounts, requestTimes } from "@/lib/availability";
import { requestPlace } from "@/lib/availability-requests";
import { getSettings, prisma } from "@/lib/db";
import { localDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "Who's free" };

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const past = sp.show === "past";
  const settings = await getSettings(user.agencyId);
  const today = localDateKey(new Date(), settings.defaultTimezone);
  const requests = await prisma.availabilityRequest.findMany({
    where: { agencyId: user.agencyId, date: past ? { lt: today } : { gte: today } },
    orderBy: past ? [{ date: "desc" }, { createdAt: "desc" }] : [{ date: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: { venue: { select: { name: true, city: true } }, replies: { select: { answer: true, bookingId: true } } },
  });

  return (
    <div>
      <PageHeader
        title="Who's free"
        subtitle="Ask several acts if they're free on a date. They answer Yes or No, and a Yes can be booked in one click."
        actions={
          <Link href="/availability/new" className="btn btn-primary">
            Ask who&apos;s free
          </Link>
        }
      />
      <div className="mb-4 inline-flex gap-1 rounded-xl border border-ink-200 bg-white p-1 text-sm">
        {(
          [
            ["", "Coming up"],
            ["past", "Past"],
          ] as const
        ).map(([v, label]) => (
          <Link
            key={v}
            href={v ? `/availability?show=${v}` : "/availability"}
            className={`rounded-lg px-3.5 py-2 font-medium ${(sp.show ?? "") === v ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-ink-100"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      {requests.length === 0 ? (
        <Empty>
          {past ? "No past requests." : "Nothing asked yet."}{" "}
          <Link href="/availability/new" className="link">
            Ask who&apos;s free
          </Link>
        </Empty>
      ) : (
        <ul className="card divide-y divide-ink-100">
          {requests.map((r) => {
            const c = replyCounts(r.replies);
            const booked = r.replies.filter((x) => x.bookingId).length;
            const where = requestPlace(r);
            const times = requestTimes(r);
            return (
              <li key={r.id}>
                <Link href={`/availability/${r.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3.5 hover:bg-ink-50 sm:px-5">
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="font-medium">{formatRange(r.date, r.date)}</div>
                    <div className="truncate text-sm text-ink-500">{[where, times].filter(Boolean).join(" · ") || "No place or times given"}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="badge bg-emerald-100 text-emerald-800">{c.yes} free</span>
                    <span className="badge bg-ink-100 text-ink-700">{c.waiting} waiting</span>
                    <span className="badge bg-rose-50 text-rose-800">{c.no} not free</span>
                    {booked > 0 && <span className="badge bg-volt-200 text-ink-950">{booked} booked</span>}
                    {r.closedAt && <span className="badge bg-ink-100 text-ink-500">Closed</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
