import "server-only";
import { arrivalFor } from "./bookings";
import { ON_STATUSES } from "./constants";
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
      // Only gigs the act has confirmed: an unanswered offer isn't late.
      status: { in: [...ON_STATUSES, "HOLD"] },
      overdueAlertSentAt: null,
      artistId: { not: null },
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
    if (!b.artist) continue;
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
    const email = {
      brand: settings.agencyName || b.agency.name,
      preheader: `Call time was ${localTime(b.arriveBy, tz)}. No check-in yet.`,
      title: `${b.artist.name} is late`,
      intro: `${b.artist.name} hasn't checked in at ${where} yet.${eta}`,
      highlight: { label: "Past call time", value: formatMinutes(a.minutesOverdue ?? 0), tone: "bad" as const },
      rows: [
        ["Call time", localTime(b.arriveBy, tz)],
        ["On stage", localTime(b.setStart, tz)],
        ["Artist phone", b.artist.phone || "Not on file"],
        ["Day of show contact", b.dayContact || "Not on file"],
        ["Booking", b.reference],
      ] as [string, string][],
      cta: { label: "Open the booking", url: link },
    };
    const base = { kind: "OVERDUE_ALERT" as const, agencyId: b.agencyId, bookingId: b.id };
    const subject = `Late: ${b.artist.name} not at ${b.venue?.name ?? "the venue"} yet`;

    // Don't message the same address twice if the agent is also the on-call contact.
    const emails = new Set([b.agent?.email, settings.alertEmail].filter((e): e is string => !!e?.trim()).map((e) => e.trim().toLowerCase()));
    const phones = new Set([b.agent?.phone, settings.alertPhone].filter((p): p is string => !!p?.trim()));
    for (const to of emails) await sendEmail({ ...base, to, subject, email });
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
  if (!b || !b.artist || b.demo || !b.notifyClientOnArrival || !b.promoter || !b.agency.settings?.clientArrivalMessages) return false;
  if (!b.promoter.email && !b.promoter.phone) return false;
  const claim = await prisma.booking.updateMany({ where: { id: b.id, clientNotifiedAt: null }, data: { clientNotifiedAt: new Date() } });
  if (claim.count !== 1) return false;

  const agencyName = b.agency.settings.agencyName || b.agency.name;
  const where = b.venue?.name ?? "the venue";
  const first = b.promoter.name.split(" ")[0];
  const arrived = await prisma.checkIn.findFirst({ where: { bookingId: b.id, kind: "ARRIVED" }, orderBy: { at: "asc" } });
  const base = { kind: "CLIENT_ARRIVAL" as const, agencyId: b.agencyId, bookingId: b.id };
  if (b.promoter.email) {
    await sendEmail({
      ...base,
      to: b.promoter.email,
      replyTo: b.agency.settings.agencyEmail,
      subject: `${b.artist.name} has arrived`,
      email: {
        brand: agencyName,
        preheader: `${b.artist.name} is at ${where} and getting set up.`,
        title: `${b.artist.name} has arrived`,
        intro: `Hi ${first}, good news: ${b.artist.name} is at ${where} and getting set up.`,
        highlight: { label: "Checked in at", value: arrived ? localTime(arrived.at, b.timezone) : "Just now", tone: "good" },
        rows: [
          ["Venue", where],
          ["On stage", localTime(b.setStart, b.timezone)],
        ],
        outro: `Any questions on the day? Just reply to this email to reach ${agencyName}.`,
      },
    });
  }
  if (b.promoter.phone) {
    await sendSms({
      ...base,
      to: b.promoter.phone,
      text: `${b.artist.name} has arrived at ${where} and is setting up. On stage ${localTime(b.setStart, b.timezone)}. ${agencyName}`,
    });
  }
  return true;
}
