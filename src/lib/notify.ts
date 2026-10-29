import "server-only";
import type { Booking, Venue } from "@prisma/client";
import { describeChanges, type BookingSnapshot, type Change } from "./changes";
import { prisma } from "./db";
import { appUrl, sendEmail, sendSms } from "./messaging";
import { dealBreakdown } from "./money";
import { formatDate, localTime } from "./time";

export function snapshotOf(b: Booking & { venue: Pick<Venue, "name"> | null }): BookingSnapshot {
  return {
    status: b.status,
    timezone: b.timezone,
    arriveBy: b.arriveBy,
    soundcheckAt: b.soundcheckAt,
    setStart: b.setStart,
    setEnd: b.setEnd,
    venueName: b.venue?.name ?? null,
    artistFeeMinor: dealBreakdown(b).artistMinor,
    currency: b.currency,
  };
}

/**
 * Compare a booking before and after an edit and, if anything the artist cares about changed,
 * email and text them. Returns the changes (empty if nothing relevant changed).
 * Skips demo data, enquiries (artists don't see those) and gigs that are already over.
 */
export async function notifyArtistIfChanged(before: BookingSnapshot, bookingId: string): Promise<Change[]> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { venue: true, artist: { include: { login: true } }, agent: true, agency: { include: { settings: true } } },
  });
  if (!b) return [];
  const all = describeChanges(before, snapshotOf(b));
  // Status steps like hold → pending don't concern the artist; confirmed and cancelled do.
  const changes = all.filter(([k, , to]) => k !== "Status" || to === "Confirmed" || to === "Cancelled");
  if (!changes.length || b.demo) return changes;
  if (b.status === "ENQUIRY" && before.status === "ENQUIRY") return changes;
  if (b.setStart.getTime() < Date.now() - 6 * 3_600_000) return changes;

  const tz = b.timezone;
  const agencyName = b.agency.settings?.agencyName || b.agency.name;
  const where = b.venue?.name ?? "your gig";
  const cancelled = b.status === "CANCELLED" && before.status !== "CANCELLED";
  const title = cancelled ? `Cancelled: ${where}, ${formatDate(b.arriveBy, tz)}` : `Your gig at ${where} has changed`;
  const link = b.artist.login ? `${appUrl()}/app/gigs/${b.id}` : null;
  const base = { kind: "BOOKING_CHANGE" as const, agencyId: b.agencyId, bookingId: b.id };
  const replyTo = b.agent?.email || b.agency.settings?.agencyEmail;

  const emails = new Set([b.artist.email, b.artist.login?.email].filter((e): e is string => !!e?.trim()).map((e) => e.trim().toLowerCase()));
  for (const to of emails) {
    await sendEmail({
      ...base,
      to,
      replyTo,
      subject: title,
      email: {
        brand: agencyName,
        preheader: changes.map(([k, , v]) => `${k}: ${v}`).join(" · "),
        title,
        intro: cancelled
          ? `Hi ${b.artist.name}, this gig has been cancelled.`
          : `Hi ${b.artist.name}, ${agencyName} has updated your gig. Here's what's different:`,
        changes,
        rows: cancelled
          ? []
          : [
              ["Venue", where],
              ["Date", formatDate(b.arriveBy, tz)],
              ["Arrive by", localTime(b.arriveBy, tz)],
              ["On stage", `${localTime(b.setStart, tz)}${b.setEnd ? ` to ${localTime(b.setEnd, tz)}` : ""}`],
            ],
        cta: link ? { label: "Open in Gigsaw", url: link } : undefined,
        outro: `Questions? Reply to this email to reach ${b.agent?.name ?? agencyName}.`,
      },
    });
  }
  if (b.artist.phone) {
    const summary = changes.map(([k, from, to]) => `${k} ${from || "none"} → ${to || "none"}`).join("; ");
    await sendSms({
      ...base,
      to: b.artist.phone,
      text: `${agencyName}: ${cancelled ? "CANCELLED" : "Gig change"} at ${where}, ${formatDate(b.arriveBy, tz)}. ${summary}.${link ? ` ${link}` : ""}`,
    });
  }
  return changes;
}

/** One message per artist listing the new gigs they've been booked for. */
export async function notifyArtistsOfNewGigs(bookingIds: string[]) {
  if (!bookingIds.length) return 0;
  const bookings = await prisma.booking.findMany({
    where: { id: { in: bookingIds }, demo: false, status: { notIn: ["ENQUIRY", "CANCELLED"] } },
    include: { venue: true, artist: { include: { login: true } }, agent: true, agency: { include: { settings: true } } },
    orderBy: { arriveBy: "asc" },
  });
  const byArtist = new Map<string, typeof bookings>();
  for (const b of bookings) byArtist.set(b.artistId, [...(byArtist.get(b.artistId) ?? []), b]);

  let sent = 0;
  for (const gigs of byArtist.values()) {
    const first = gigs[0];
    const artist = first.artist;
    const agencyName = first.agency.settings?.agencyName || first.agency.name;
    const line = (b: (typeof gigs)[number]) =>
      `${formatDate(b.arriveBy, b.timezone)}: ${b.venue?.name ?? "venue to be confirmed"}, ${localTime(b.setStart, b.timezone)}${b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""} (arrive ${localTime(b.arriveBy, b.timezone)})`;
    const n = gigs.length;
    const title = n === 1 ? `New gig: ${first.venue?.name ?? "booked"}, ${formatDate(first.arriveBy, first.timezone)}` : `You've been booked for ${n} gigs`;
    const link = artist.login ? `${appUrl()}/app` : null;
    const base = { kind: "BOOKING_CHANGE" as const, agencyId: first.agencyId, bookingId: n === 1 ? first.id : null };
    const emails = new Set([artist.email, artist.login?.email].filter((e): e is string => !!e?.trim()).map((e) => e.trim().toLowerCase()));
    for (const to of emails) {
      await sendEmail({
        ...base,
        to,
        replyTo: first.agent?.email || first.agency.settings?.agencyEmail,
        subject: title,
        email: {
          brand: agencyName,
          preheader: line(first),
          title,
          intro: `Hi ${artist.name}, ${agencyName} has booked you for:`,
          rows: gigs.slice(0, 40).map((b) => [formatDate(b.arriveBy, b.timezone), line(b).split(": ").slice(1).join(": ")]),
          cta: link ? { label: "See your gigs", url: link } : undefined,
          outro: "Times are the venue's local time. Reply to this email if anything doesn't work for you.",
        },
      });
    }
    if (artist.phone) {
      await sendSms({ ...base, to: artist.phone, text: `${agencyName}: ${n === 1 ? "new gig" : `${n} new gigs`} booked. ${n === 1 ? line(first) : `First: ${line(first)}`}.${link ? ` ${link}` : ""}` });
    }
    sent++;
  }
  return sent;
}
