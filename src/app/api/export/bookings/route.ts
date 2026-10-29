import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { BOOKING_STATUS_LABELS, DEAL_TYPE_LABELS, type BookingStatus, type DealType } from "@/lib/constants";
import { csvResponse, toCsv } from "@/lib/csv";
import { getSettings, prisma } from "@/lib/db";
import { arrivalFor } from "@/lib/bookings";
import { ARRIVAL_STATE_LABELS } from "@/lib/arrival";
import { dealBreakdown, fromMinor, paymentTotals } from "@/lib/money";
import { localDateKey, localTime, zonedToUtc } from "@/lib/time";

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user || user.role === "ARTIST") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const settings = await getSettings();
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const artist = sp.get("artist");

  const bookings = await prisma.booking.findMany({
    where: {
      ...(artist ? { artistId: artist } : {}),
      arriveBy: {
        ...(from ? { gte: zonedToUtc(from, "00:00", settings.defaultTimezone) } : {}),
        ...(to ? { lt: zonedToUtc(to, "23:59", settings.defaultTimezone) } : {}),
      },
    },
    include: { artist: true, venue: true, promoter: true, agent: true, payments: true, checkIns: true },
    orderBy: { arriveBy: "asc" },
  });

  const now = new Date();
  const rows = bookings.map((b) => {
    const d = dealBreakdown(b);
    const t = paymentTotals(b.payments);
    const a = arrivalFor(b, settings, now);
    const m = (v: number) => fromMinor(v, b.currency).toFixed(b.currency === "JPY" ? 0 : 2);
    return [
      b.reference,
      localDateKey(b.arriveBy, b.timezone),
      localTime(b.arriveBy, b.timezone),
      localTime(b.setStart, b.timezone),
      b.timezone,
      b.artist.name,
      b.eventName,
      b.venue?.name,
      b.venue?.city,
      b.promoter?.name,
      b.agent?.name,
      BOOKING_STATUS_LABELS[b.status as BookingStatus] ?? b.status,
      DEAL_TYPE_LABELS[b.dealType as DealType] ?? b.dealType,
      b.currency,
      m(d.grossMinor),
      m(d.vatMinor),
      m(d.agencyMinor),
      m(d.artistMinor),
      m(t.receivedMinor),
      m(Math.max(0, d.totalDueMinor - t.receivedMinor)),
      m(t.paidOutMinor),
      ARRIVAL_STATE_LABELS[a.state],
      a.arrivedAt ? localTime(a.arrivedAt, b.timezone) : "",
      a.minutesLate ?? "",
      b.tags,
    ];
  });
  const csv = toCsv(
    [
      "Reference", "Date", "Arrive by", "On stage", "Time zone", "Artist", "Event", "Venue", "City", "Promoter", "Agent", "Status", "Deal",
      "Currency", "Fee", "VAT", "Agency commission", "Artist earnings", "Received", "Owed by promoter", "Paid to artist",
      "Arrival", "Arrived at", "Minutes late", "Tags",
    ],
    rows,
  );
  return csvResponse(`gigsaw-bookings-${localDateKey(now, settings.defaultTimezone)}.csv`, csv);
}
