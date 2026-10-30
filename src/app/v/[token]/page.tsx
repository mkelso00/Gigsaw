import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import { appUrl } from "@/lib/messaging";
import { findSharedVenue, venueLineup } from "@/lib/venue-share";
import { addDaysToKey, localTime } from "@/lib/time";

export const dynamic = "force-dynamic";
// Private link: keep it out of search engines.
export const metadata: Metadata = { title: "What's on", robots: { index: false, follow: false } };

const dayTitle = (key: string, today: string) => {
  const d = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
  return key === today ? `Tonight · ${d}` : key === addDaysToKey(today, 1) ? `Tomorrow · ${d}` : d;
};

export default async function VenueLineupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const venue = await findSharedVenue(token);
  if (!venue) notFound();
  const { today, days } = await venueLineup(venue);
  const tz = venue.timezone;
  const agencyName = venue.agency.settings?.agencyName || venue.agency.name;
  const feed = `${appUrl()}/api/venue-calendar/${token}.ics`;
  const t = (d: Date) => localTime(d, tz);

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="bg-ink-950 text-white">
        <div className="mx-auto max-w-3xl px-5 pt-6 pb-10">
          <div className="flex items-center justify-between">
            <Logo size={26} sub={agencyName} />
            <a
              href={feed.replace(/^https?:\/\//, "webcal://")}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
            >
              Add to calendar
            </a>
          </div>
          <p className="mt-10 text-sm text-volt-400">What&apos;s on</p>
          <h1 className="mt-1 text-[34px] leading-tight font-semibold tracking-[-0.02em]">{venue.name}</h1>
          {venue.city && <p className="text-ink-400">{venue.city}</p>}
        </div>
      </header>

      <main className="mx-auto -mt-5 max-w-3xl space-y-5 px-5 pb-16">
        {days.length === 0 && <div className="card p-8 text-center text-ink-500">Nothing booked in the next eight weeks yet.</div>}
        {days.map(([key, entries]) => (
          <section key={key} className={`card overflow-hidden ${key === today ? "ring-2 ring-volt-400" : ""}`}>
            <h2 className={`px-5 py-3 text-sm font-semibold ${key === today ? "bg-volt-300 text-ink-950" : "border-b border-ink-100"}`}>
              {dayTitle(key, today)}
            </h2>
            <ul className="divide-y divide-ink-100">
              {entries.map((e) =>
                e.kind === "booking" ? (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-5 gap-y-1 px-5 py-4">
                    <div className="w-28 shrink-0 font-semibold tabular-nums">
                      {t(e.start)}
                      {e.end ? `–${t(e.end)}` : ""}
                    </div>
                    <div className="min-w-40 flex-1">
                      <div className="text-[17px] font-semibold tracking-tight">{e.artist}</div>
                      <div className="text-sm text-ink-500">{[e.act, e.genre].filter(Boolean).join(" · ") || "Live music"}</div>
                    </div>
                    <div className="text-right text-xs">
                      {e.arrivedAt ? (
                        <span className="badge bg-emerald-50 text-emerald-800">Arrived {t(e.arrivedAt)}</span>
                      ) : e.provisional ? (
                        <span className="badge bg-amber-50 text-amber-800">Provisional</span>
                      ) : (
                        <span className="text-ink-500">Arriving {t(e.arriveBy)}</span>
                      )}
                    </div>
                  </li>
                ) : (
                  <li key={`${e.slotId}-${key}`} className="flex flex-wrap items-center gap-x-5 gap-y-1 px-5 py-4 text-ink-500">
                    <div className="w-28 shrink-0 font-semibold tabular-nums">
                      {t(e.start)}–{t(e.end)}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">To be confirmed</div>
                      {e.act && <div className="text-sm">{e.act}</div>}
                    </div>
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}
        <p className="pt-4 text-center text-xs text-ink-500">
          Line-up from {agencyName}. It updates as acts are booked or changed.
          {venue.agency.settings?.agencyEmail && (
            <>
              {" "}
              Questions?{" "}
              <a href={`mailto:${venue.agency.settings.agencyEmail}`} className="underline">
                {venue.agency.settings.agencyEmail}
              </a>
            </>
          )}
        </p>
      </main>
    </div>
  );
}
