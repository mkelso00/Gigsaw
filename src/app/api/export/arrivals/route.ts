import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { ARRIVAL_STATE_LABELS, LOCATION_LABELS } from "@/lib/arrival";
import { arrivalFor } from "@/lib/bookings";
import { csvResponse, toCsv } from "@/lib/csv";
import { getSettings, prisma } from "@/lib/db";
import { localDateKey, localTime } from "@/lib/time";

// One row per past or current gig, with how and when the artist arrived.
export async function GET() {
  const user = await currentUser();
  if (!user || user.role === "ARTIST") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const settings = await getSettings();
  const now = new Date();
  const bookings = await prisma.booking.findMany({
    where: { arriveBy: { lte: new Date(now.getTime() + 86_400_000) }, status: { not: "CANCELLED" } },
    include: { artist: true, venue: true, checkIns: true },
    orderBy: { arriveBy: "desc" },
  });
  const rows = bookings.map((b) => {
    const a = arrivalFor(b, settings, now);
    return [
      b.reference,
      localDateKey(b.arriveBy, b.timezone),
      b.artist.name,
      b.venue?.name,
      b.venue?.city,
      localTime(b.arriveBy, b.timezone),
      a.arrivedAt ? localTime(a.arrivedAt, b.timezone) : "",
      a.minutesLate ?? "",
      ARRIVAL_STATE_LABELS[a.state],
      a.location ? LOCATION_LABELS[a.location] : "",
      a.distanceM !== null ? Math.round(a.distanceM) : "",
      a.departedAt ? localTime(a.departedAt, b.timezone) : "",
      b.timezone,
    ];
  });
  const csv = toCsv(
    ["Reference", "Date", "Artist", "Venue", "City", "Call time", "Arrived at", "Minutes late (negative = early)", "Result", "Location check", "Metres from venue", "Left at", "Time zone"],
    rows,
  );
  return csvResponse(`gigsaw-arrivals-${localDateKey(now, settings.defaultTimezone)}.csv`, csv);
}
