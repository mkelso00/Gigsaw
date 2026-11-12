import "server-only";
import { notFound } from "next/navigation";
import { arrivalFor } from "@/lib/bookings";
import { replyCounts } from "@/lib/availability";
import { awayBetween } from "@/lib/away";
import { buildChecklist } from "@/lib/checklist";
import { bookingContractDoc, contractState } from "@/lib/contract-doc";
import { contractStatusFor, contractSubject, type ContractTarget } from "@/lib/contracts";
import { linkedActIds } from "@/lib/people";
import { actName } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { dealBreakdown, paymentTotals } from "@/lib/money";
import { localDateKey, zoneLabel } from "@/lib/time";

/** Everything the booking page shows, loaded in one place so the sections only render. */
export async function loadBookingPage(agencyId: string, id: string) {
  const [booking, settings] = await Promise.all([
    prisma.booking.findFirst({
      where: { id, agencyId },
      include: {
        artist: true,
        venue: true,
        promoter: true,
        event: { select: { id: true, name: true } },
        agent: { select: { name: true } },
        payments: { orderBy: { paidAt: "asc" } },
        payLinks: true,
        checkIns: { orderBy: { at: "asc" }, include: { user: { select: { name: true } } } },
      },
    }),
    getSettings(agencyId),
  ]);
  if (!booking) notFound();

  const now = new Date();
  const tz = booking.timezone;
  const windowStart = new Date(booking.setStart.getTime() - 400 * 86_400_000);
  const windowEnd = new Date(booking.setStart.getTime() + 400 * 86_400_000);
  const linked = booking.artistId ? await linkedActIds(booking.artistId) : [];
  const gigDay = localDateKey(booking.arriveBy, tz);
  const [others, activity, away] = await Promise.all([
    prisma.booking.findMany({
      where: { agencyId, artistId: { in: linked }, id: { not: booking.id }, setStart: { gte: windowStart, lte: windowEnd } },
      select: {
        id: true,
        reference: true,
        status: true,
        artistId: true,
        artist: { select: { name: true } },
        arriveBy: true,
        setStart: true,
        setEnd: true,
        radiusKm: true,
        radiusDays: true,
        venue: { select: { name: true, latitude: true, longitude: true } },
      },
    }),
    prisma.activity.findMany({
      where: { agencyId, entity: "BOOKING", entityId: booking.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { user: { select: { name: true } } },
    }),
    booking.artistId ? awayBetween(agencyId, gigDay, gigDay) : [],
  ]);
  // A gig that needs an act: the last time acts were asked if they're free for it.
  const asked = booking.artistId
    ? null
    : await prisma.availabilityRequest.findFirst({
        where: { agencyId, bookingId: booking.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, replies: { select: { answer: true } } },
      });
  const askedCounts = asked ? replyCounts(asked.replies) : null;

  // A gig inside a wedding or event is covered by the event's contract.
  const contractTarget: ContractTarget = booking.eventId ? { kind: "event", id: booking.eventId } : { kind: "booking", id: booking.id };
  const contractDoc = booking.eventId ? (await contractSubject(agencyId, contractTarget))?.doc : bookingContractDoc(booking, settings);
  const contract = contractDoc ? await contractStatusFor(agencyId, contractTarget, contractDoc) : null;

  const deal = dealBreakdown(booking);
  const totals = paymentTotals(booking.payments);
  const checklist = buildChecklist(
    {
      ...booking,
      linkedArtistIds: linked,
      artistName: booking.artist?.name,
      away,
      contract: contract ? { state: contractState(contract.current), changed: contract.changes.length > 0 } : null,
    },
    others.map((o) => ({ ...o, artistName: actName(o) })),
    totals.depositReceivedMinor,
    now,
    settings.changeoverMinutes,
  );
  const arrival = arrivalFor(booking, settings, now);
  const zone = zoneLabel(booking.arriveBy, tz);

  return { booking, settings, now, zone, activity, asked, askedCounts, contractTarget, contract, deal, totals, checklist, arrival };
}

export type BookingPageData = Awaited<ReturnType<typeof loadBookingPage>>;
export type BookingView = BookingPageData["booking"];
