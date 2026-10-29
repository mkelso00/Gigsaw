import "server-only";
import { arrivalFor } from "./bookings";
import { LIVE_STATUSES } from "./constants";
import { prisma } from "./db";
import { appUrl, sendEmail, sendSms } from "./messaging";
import { formatMinutes, localTime } from "./time";

// Arrival messages:
//  - Overdue alert: once per gig, to the booking's agent and the agency's on-call contact,
//    when the call time (plus grace) passes with no arrival.
//  - Client arrival note: once per gig, to the booking's promoter/client when the artist arrives.
// Demo bookings never send anything. Each message is "claimed" with a conditional update first,
// so two servers (or two runs) can never send the same alert twice.

const HOUR = 3_600_000;

/** Find gigs that have just gone overdue and alert people. Safe to run as often as you like. */
export async function runOverdueCheck(now = new Date()) {
  const candidates = await prisma.booking.findMany({
    where: {
      demo: false,
      status: { in: LIVE_STATUSES },
      overdueAlertSentAt: null,
      arriveBy: { gte: new Date(now.getTime() - 12 * HOUR), lte: now },
      agency: { status: "ACTIVE", settings: { overdueAlerts: true } },
      checkIns: { none: { kind: "ARRIVED" } },
    },
    include: {
      checkIns: true,
      venue: true,
      artist: true,
      agent: true,
      agency: { include: { settings: true } },
    },
  });

  let sent = 0;
  for (const b of candidates) {
    const settings = b.agency.settings;
    if (!settings) continue;
    const a = arrivalFor(b, settings, now);
    if (a.state !== "OVERDUE") continue;
    const claim = await prisma.booking.updateMany({ where: { id: b.id, overdueAlertSentAt: null }, data: { overdueAlertSentAt: now } });
    if (claim.count !== 1) continue;

    const tz = b.timezone;
    const where = b.venue ? `${b.venue.name}${b.venue.city ? `, ${b.venue.city}` : ""}` : "the venue";
    const eta = a.expectedAt ? ` They said they'd arrive at ${localTime(a.expectedAt, tz)}.` : "";
    const link = `${appUrl()}/bookings/${b.id}`;
    const short = `Gigsaw: ${b.artist.name} hasn't checked in at ${where}. Call time was ${localTime(b.arriveBy, tz)} (${formatMinutes(a.minutesOverdue ?? 0)} ago).${eta} ${link}`;
    const text = `${b.artist.name} hasn't checked in at ${where}.\n\nCall time was ${localTime(b.arriveBy, tz)}, ${formatMinutes(a.minutesOverdue ?? 0)} ago. On stage at ${localTime(b.setStart, tz)}.${eta}\n\nArtist phone: ${b.artist.phone || "not on file"}\nDay of show contact: ${b.dayContact || "not on file"}\n\nOpen the booking (${b.reference}): ${link}`;
    const base = { kind: "OVERDUE_ALERT" as const, agencyId: b.agencyId, bookingId: b.id };
    const subject = `Late: ${b.artist.name} not at ${b.venue?.name ?? "the venue"} yet`;

    // Don't message the same address twice if the agent is also the on-call contact.
    const emails = new Set([b.agent?.email, settings.alertEmail].filter((e): e is string => !!e?.trim()).map((e) => e.trim().toLowerCase()));
    const phones = new Set([b.agent?.phone, settings.alertPhone].filter((p): p is string => !!p?.trim()));
    for (const to of emails) await sendEmail({ ...base, to, subject, text });
    for (const to of phones) await sendSms({ ...base, to, text: short });
    sent++;
  }
  return { checked: candidates.length, alerted: sent };
}

/** Tell the client the artist has arrived. Called after an ARRIVED check-in. */
export async function notifyClientOfArrival(bookingId: string) {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { artist: true, venue: true, promoter: true, agency: { include: { settings: true } } },
  });
  if (!b || b.demo || !b.notifyClientOnArrival || !b.promoter || !b.agency.settings?.clientArrivalMessages) return false;
  if (!b.promoter.email && !b.promoter.phone) return false;
  const claim = await prisma.booking.updateMany({ where: { id: b.id, clientNotifiedAt: null }, data: { clientNotifiedAt: new Date() } });
  if (claim.count !== 1) return false;

  const agencyName = b.agency.settings.agencyName || b.agency.name;
  const where = b.venue?.name ?? "the venue";
  const first = b.promoter.name.split(" ")[0];
  const text = `Hi ${first},\n\nGood news: ${b.artist.name} has arrived at ${where} and is getting set up. On stage at ${localTime(b.setStart, b.timezone)}.\n\n${agencyName}`;
  const base = { kind: "CLIENT_ARRIVAL" as const, agencyId: b.agencyId, bookingId: b.id };
  if (b.promoter.email) await sendEmail({ ...base, to: b.promoter.email, subject: `${b.artist.name} has arrived`, text });
  if (b.promoter.phone) {
    await sendSms({ ...base, to: b.promoter.phone, text: `${b.artist.name} has arrived at ${where} and is setting up. On stage ${localTime(b.setStart, b.timezone)}. ${agencyName}` });
  }
  return true;
}
