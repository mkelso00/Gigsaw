import type { Metadata } from "next";
import { AvailabilityForm, type AvailabilityDefaults } from "@/components/availability-form";
import { PageHeader } from "@/components/ui";
import { ACT_TYPE_LABELS } from "@/lib/act-profile";
import { requireStaff } from "@/lib/auth";
import { actHintsOn } from "@/lib/away";
import { getSettings, prisma } from "@/lib/db";
import { minorToInput } from "@/lib/money";
import { isDateKey } from "@/lib/rota";
import { localDateKey, localTime } from "@/lib/time";

export const metadata: Metadata = { title: "Ask who's free" };

export default async function NewAvailabilityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const settings = await getSettings(user.agencyId);
  const today = localDateKey(new Date(), settings.defaultTimezone);
  // Asked from a gig that needs an act: start from its date, times, place and fee.
  const gig = sp.bookingId
    ? await prisma.booking.findFirst({
        where: { id: sp.bookingId, agencyId: user.agencyId },
        select: {
          id: true,
          arriveBy: true,
          setStart: true,
          setEnd: true,
          timezone: true,
          venueId: true,
          eventType: true,
          eventName: true,
          currency: true,
          artistFeeMinor: true,
        },
      })
    : null;
  const gigDate = gig ? localDateKey(gig.arriveBy, gig.timezone) : null;
  const date = isDateKey(sp.date) && sp.date >= today ? sp.date : gigDate && gigDate >= today ? gigDate : today;
  const [acts, venues, hints] = await Promise.all([
    prisma.artist.findMany({ where: { agencyId: user.agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true, actType: true, town: true } }),
    prisma.venue.findMany({ where: { agencyId: user.agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true, city: true } }),
    actHintsOn(user.agencyId, date, settings.defaultTimezone),
  ]);
  const defaults: AvailabilityDefaults = gig
    ? {
        date,
        arriveTime: localTime(gig.arriveBy, gig.timezone),
        startTime: localTime(gig.setStart, gig.timezone),
        endTime: gig.setEnd ? localTime(gig.setEnd, gig.timezone) : "",
        venueId: gig.venueId ?? undefined,
        place: gig.venueId ? "" : gig.eventName,
        eventType: gig.eventType,
        cost: minorToInput(gig.artistFeeMinor, gig.currency),
        bookingId: gig.id,
      }
    : { date, venueId: sp.venueId, actIds: sp.artistId ? [sp.artistId] : undefined };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Ask who's free"
        eyebrow={gig ? "For a gig that needs an act" : undefined}
        subtitle="Pick a date and the acts to ask. They answer Yes or No from a link or their app, and you see the answers come in."
      />
      <AvailabilityForm
        acts={acts.map((a) => {
          const h = hints.get(a.id);
          return {
            id: a.id,
            name: a.name,
            detail: [ACT_TYPE_LABELS[a.actType as keyof typeof ACT_TYPE_LABELS], a.town].filter(Boolean).join(" · "),
            hint: h?.hint,
            tone: h?.tone,
          };
        })}
        venues={venues.map((v) => ({ id: v.id, name: v.name, detail: v.city }))}
        currency={settings.defaultCurrency}
        today={today}
        defaults={defaults}
      />
    </div>
  );
}
