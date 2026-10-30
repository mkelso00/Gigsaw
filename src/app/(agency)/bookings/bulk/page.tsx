import type { Metadata } from "next";
import Link from "next/link";
import { bulkUpdateBookings } from "@/actions/bulk";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ArtistDot, Empty, Field, PageHeader, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDate, localTime } from "@/lib/time";
import { actName } from "@/lib/constants";

export const metadata: Metadata = { title: "Change several bookings" };
export const dynamic = "force-dynamic";

export default async function BulkEditPage({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const ids = (Array.isArray(sp.ids) ? sp.ids : sp.ids ? [sp.ids] : []).slice(0, 500);
  const bookings = await prisma.booking.findMany({
    where: { id: { in: ids }, agencyId: user.agencyId },
    include: { artist: { select: { name: true, colour: true } }, venue: { select: { name: true } } },
    orderBy: { arriveBy: "asc" },
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={
          <Link href="/bookings" className="hover:text-ink-950">
            ← Bookings
          </Link>
        }
        title={`Change ${bookings.length} booking${bookings.length === 1 ? "" : "s"}`}
        subtitle="Times are in each venue's local time and keep each booking's own date. Leave a box empty to keep what's there."
      />
      {bookings.length === 0 ? (
        <Empty>
          No bookings selected. Go to{" "}
          <Link href="/bookings" className="link">
            Bookings
          </Link>
          , tick the bookings you want and press &ldquo;Change selected bookings&rdquo;.
        </Empty>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <ActionForm action={bulkUpdateBookings} className="card card-pad space-y-6">
            {bookings.map((b) => (
              <input key={b.id} type="hidden" name="ids" value={b.id} />
            ))}
            <section>
              <h2 className="section-title mb-1">New times</h2>
              <p className="mb-4 text-sm text-ink-500">For example, every Wednesday moving from 18:00–20:00 to 19:00–21:00.</p>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Arrive by">
                  <input type="time" name="arriveTime" className="input" />
                </Field>
                <Field label="Soundcheck">
                  <input type="time" name="soundcheckTime" className="input" />
                </Field>
                <Field label="On stage">
                  <input type="time" name="setStartTime" className="input" />
                </Field>
                <Field label="Off stage">
                  <input type="time" name="setEndTime" className="input" />
                </Field>
              </div>
            </section>
            <section className="border-t border-ink-100 pt-6">
              <h2 className="section-title mb-1">Or move all times</h2>
              <Field label="Minutes" hint="Use 30 for half an hour later, -60 for an hour earlier" className="max-w-xs">
                <input name="shiftMinutes" inputMode="numeric" placeholder="30" className="input" />
              </Field>
            </section>
            <section className="border-t border-ink-100 pt-6">
              <h2 className="section-title mb-1">New money</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Sale for each booking" hint="What the venue or customer pays, before VAT. Empty keeps each booking's sale.">
                  <input name="fee" inputMode="decimal" placeholder="150.00" className="input" />
                </Field>
                <Field label="Cost for each booking (act's fee)" hint="What the act is paid. The act only sees this. Empty keeps it.">
                  <input name="cost" inputMode="decimal" placeholder="120.00" className="input" />
                </Field>
              </div>
            </section>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-volt-400 bg-volt-100/60 p-4">
              <input type="checkbox" name="notifyArtists" defaultChecked className="mt-0.5 h-4 w-4 accent-ink-950" />
              <span>
                <span className="block text-sm font-medium">Tell each artist what changed</span>
                <span className="block text-xs text-ink-600">An email and text with old and new times and fee. Past bookings and demo data are skipped.</span>
              </span>
            </label>
            <SubmitButton pendingText="Updating…">
              Update {bookings.length} booking{bookings.length === 1 ? "" : "s"}
            </SubmitButton>
          </ActionForm>

          <aside className="card h-fit overflow-hidden">
            <div className="border-b border-ink-100 px-4 py-3 text-sm font-medium">Selected bookings</div>
            <ul className="max-h-[560px] divide-y divide-ink-100 overflow-y-auto text-sm">
              {bookings.map((b) => (
                <li key={b.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-medium">
                      <ArtistDot colour={b.artist?.colour ?? "#a2a199"} />
                      {actName(b)}
                    </span>
                    <StatusBadge status={b.status} />
                  </div>
                  <div className="mt-1 text-xs text-ink-500">
                    {formatDate(b.arriveBy, b.timezone)} · {b.venue?.name ?? "No venue"} · {localTime(b.setStart, b.timezone)}
                    {b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""} · {formatMoney(b.feeMinor, b.currency)}
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </div>
  );
}
