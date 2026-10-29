import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { submitPlanner } from "@/actions/events";
import { ActionForm, SubmitButton } from "@/components/forms";
import { prisma } from "@/lib/db";
import { PLAN_FIELDS } from "@/lib/event-plan";
import { localTime } from "@/lib/time";
import { actName } from "@/lib/constants";

// The customer's planner: a private link (no login) where a couple tells the agency the running
// order, contacts, parking and song requests. Shows which acts are booked and when, never money.

export const metadata: Metadata = { title: "Your details", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PlannerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) notFound();
  const e = await prisma.event.findUnique({
    where: { plannerToken: token },
    include: {
      agency: { include: { settings: true } },
      venue: { select: { name: true, city: true } },
      bookings: {
        where: { archivedAt: null, status: { notIn: ["CANCELLED", "ENQUIRY"] } },
        include: { artist: { select: { name: true } } },
        orderBy: { setStart: "asc" },
      },
    },
  });
  if (!e || e.status !== "ACTIVE" || e.agency.status !== "ACTIVE") notFound();
  const brand = e.agency.settings?.agencyName || e.agency.name;
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${e.date}T12:00:00Z`),
  );
  const wedding = e.type === "WEDDING";

  return (
    <div className="min-h-screen bg-ink-50 px-4 py-10 text-ink-950">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <div className="text-sm font-medium text-ink-500">{brand}</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{e.name}</h1>
          <p className="mt-1 text-ink-600">
            {day}
            {e.venue ? ` · ${e.venue.name}${e.venue.city ? `, ${e.venue.city}` : ""}` : e.venueText ? ` · ${e.venueText}` : ""}
          </p>
        </div>

        {e.bookings.length > 0 && (
          <section className="card card-pad mb-6">
            <h2 className="section-title mb-3">What&apos;s booked</h2>
            <ul className="divide-y divide-ink-100 text-sm">
              {e.bookings.map((b) => (
                <li key={b.id} className="flex justify-between gap-3 py-2.5">
                  <span className="font-medium">{actName(b)}</span>
                  <span className="text-ink-600 tabular-nums">
                    {localTime(b.setStart, b.timezone)}
                    {b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <ActionForm action={submitPlanner.bind(null, token)} className="card card-pad space-y-5">
          <div>
            <h2 className="section-title">{wedding ? "Your wedding day" : "Your event"}</h2>
            <p className="mt-1 text-sm text-ink-500">
              Tell us as much as you can. Everyone performing gets these details before the day. You can come back to this page and change anything.
            </p>
          </div>
          <label className="block max-w-40">
            <span className="label">Number of guests</span>
            <input name="guestCount" inputMode="numeric" defaultValue={e.guestCount ?? ""} className="input" />
          </label>
          {PLAN_FIELDS.map(([k, label, hint]) => (
            <label key={k} className="block">
              <span className="label">{label}</span>
              <textarea name={k} rows={k === "timeline" || k === "songRequests" ? 5 : 3} defaultValue={e[k]} className="input" />
              {hint && <span className="hint block">{hint}</span>}
            </label>
          ))}
          <SubmitButton className="btn btn-primary w-full sm:w-auto" pendingText="Sending…">
            Send to {brand}
          </SubmitButton>
        </ActionForm>
        <p className="mt-6 text-center text-xs text-ink-400">This page is private to you. Please don&apos;t share the link.</p>
      </div>
    </div>
  );
}
