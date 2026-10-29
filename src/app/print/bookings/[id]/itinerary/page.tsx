import type { Metadata } from "next";
import { DocTable, DocumentShell } from "@/components/document";
import { loadPrintable } from "@/lib/print";
import { formatDate, localTime, zoneLabel } from "@/lib/time";
import { actName } from "@/lib/constants";

export const metadata: Metadata = { title: "Itinerary" };

export default async function ItineraryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { booking: b, settings } = await loadPrintable(id, true);
  const tz = b.timezone;
  const v = b.venue;
  return (
    <DocumentShell title="Day sheet" reference={b.reference} settings={settings}>
      <h1 className="mb-1 text-2xl font-bold">{actName(b)}</h1>
      <p className="mb-6 text-slate-600">
        {formatDate(b.arriveBy, tz)}
        {v ? ` · ${v.name}${v.city ? `, ${v.city}` : ""}` : ""}
        {b.eventName ? ` · ${b.eventName}` : ""}
      </p>
      <h2 className="mb-2 font-semibold">Schedule ({zoneLabel(b.arriveBy, tz)})</h2>
      <DocTable
        rows={[
          ["Arrive by", localTime(b.arriveBy, tz)],
          ["Soundcheck", b.soundcheckAt ? localTime(b.soundcheckAt, tz) : ""],
          ["On stage", localTime(b.setStart, tz)],
          ["Off stage", b.setEnd ? localTime(b.setEnd, tz) : ""],
        ]}
      />
      <h2 className="mt-6 mb-2 font-semibold">Venue</h2>
      <DocTable
        rows={[
          ["Venue", v?.name ?? "To be confirmed"],
          ["Address", v ? [v.address, v.city, v.country].filter(Boolean).join(", ") : ""],
          ["Venue notes", v?.notes ?? ""],
        ]}
      />
      <h2 className="mt-6 mb-2 font-semibold">Logistics</h2>
      <DocTable
        rows={[
          ["Travel", b.travel],
          ["Accommodation", b.accommodation],
          ["Day of show contact", b.dayContact],
          ["Hospitality", b.hospitality],
          ["Promoter", b.promoter ? `${b.promoter.name}${b.promoter.phone ? `, ${b.promoter.phone}` : ""}` : ""],
          ["Agent", b.agent ? `${b.agent.name}, ${b.agent.email}` : ""],
        ]}
      />
      <p className="mt-8 rounded-lg bg-brand-50 p-4 text-sm text-brand-700">
        Please check in on the Gigsaw app when you arrive so {settings.agencyName} knows you&apos;re there.
      </p>
    </DocumentShell>
  );
}
