import "server-only";
import type { Booking, Venue } from "@prisma/client";
import { describeChanges, type BookingSnapshot, type Change } from "./changes";
import { prisma } from "./db";
import { appUrl, sendEmail, sendPush, sendSms } from "./messaging";
import { recipientsForActs, type Recipient } from "./people";
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
  // Being confirmed has its own "You're booked" message (confirmations.ts); cancellations are told here.
  const changes = all.filter(([k, , to]) => k !== "Status" || to === "Cancelled");
  if (!changes.length || b.demo) return changes;
  // Acts aren't involved until the gig is offered to them.
  const notYet = ["ENQUIRY", "PENDING"];
  if (notYet.includes(b.status) && notYet.includes(before.status)) return changes;
  if (b.setStart.getTime() < Date.now() - 6 * 3_600_000) return changes;

  const tz = b.timezone;
  const agencyName = b.agency.settings?.agencyName || b.agency.name;
  const where = b.venue?.name ?? "your gig";
  const cancelled = b.status === "CANCELLED" && before.status !== "CANCELLED";
  const title = cancelled ? `Cancelled: ${where}, ${formatDate(b.arriveBy, tz)}` : `Your gig at ${where} has changed`;
  const base = { kind: "BOOKING_CHANGE" as const, agencyId: b.agencyId, bookingId: b.id };
  const replyTo = b.agent?.email || b.agency.settings?.agencyEmail;

  if (!b.artistId || !b.artist) return changes;
  const act = b.artist;
  const recipients = (await recipientsForActs([b.artistId])).get(b.artistId) ?? [];
  for (const r of recipients) {
    const whose = r.isMember ? `${act.name}'s` : "your";
    const link = r.userId ? `${appUrl()}/app/gigs/${b.id}` : null;
    if (r.userId) {
      await sendPush({
        ...base,
        userId: r.userId,
        payload: { title, body: changes.map(([k, , v]) => `${k}: ${v || "none"}`).join(" · "), url: `/app/gigs/${b.id}`, tag: `change-${b.id}` },
      });
    }
    for (const to of r.emails) {
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
            ? `Hi ${r.firstName}, ${r.isMember ? `${act.name}'s gig` : "this gig"} has been cancelled.`
            : `Hi ${r.firstName}, ${agencyName} has updated ${whose} gig. Here's what's different:`,
          changes,
          rows: cancelled
            ? []
            : [
                ...(r.isMember ? ([["Act", act.name]] as [string, string][]) : []),
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
    if (r.phone) {
      const summary = changes.map(([k, from, to]) => `${k} ${from || "none"} → ${to || "none"}`).join("; ");
      await sendSms({
        ...base,
        to: r.phone,
        text: `${agencyName}: ${cancelled ? "CANCELLED" : "Gig change"}${r.isMember ? ` (${act.name})` : ""} at ${where}, ${formatDate(b.arriveBy, tz)}. ${summary}.${link ? ` ${link}` : ""}`,
      });
    }
  }
  return changes;
}

/** One message per artist listing the new gigs they've been booked for. */
export async function notifyArtistsOfNewGigs(bookingIds: string[]) {
  if (!bookingIds.length) return 0;
  const bookings = await prisma.booking.findMany({
    // Offers (awaiting confirmation) go out separately; pending gigs aren't the act's business yet.
    where: { id: { in: bookingIds }, demo: false, artistId: { not: null }, status: { in: ["HOLD", "CONFIRMED", "SETTLED"] } },
    include: { venue: true, artist: { include: { login: true } }, agent: true, agency: { include: { settings: true } } },
    orderBy: { arriveBy: "asc" },
  });
  const recipients = await recipientsForActs(bookings.map((b) => b.artistId!));
  const byRecipient = new Map<string, { to: Recipient; gigs: typeof bookings }>();
  for (const b of bookings) {
    for (const r of recipients.get(b.artistId!) ?? []) {
      const entry = byRecipient.get(r.key) ?? { to: r, gigs: [] };
      entry.gigs.push(b);
      byRecipient.set(r.key, entry);
    }
  }

  let sent = 0;
  for (const { to: r, gigs } of byRecipient.values()) {
    const first = gigs[0];
    const agencyName = first.agency.settings?.agencyName || first.agency.name;
    const named = r.isMember || new Set(gigs.map((g) => g.artistId)).size > 1;
    const line = (b: (typeof gigs)[number]) =>
      `${formatDate(b.arriveBy, b.timezone)}: ${named ? `${b.artist!.name} at ` : ""}${b.venue?.name ?? "venue to be confirmed"}, ${localTime(b.setStart, b.timezone)}${b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""} (arrive ${localTime(b.arriveBy, b.timezone)})`;
    const n = gigs.length;
    const title = n === 1 ? `New gig: ${first.venue?.name ?? "booked"}, ${formatDate(first.arriveBy, first.timezone)}` : `You've been booked for ${n} gigs`;
    const link = r.userId ? `${appUrl()}/app` : null;
    const base = { kind: "BOOKING_CHANGE" as const, agencyId: first.agencyId, bookingId: n === 1 ? first.id : null };
    if (r.userId) await sendPush({ ...base, userId: r.userId, payload: { title, body: line(first), url: "/app", tag: `new-${first.id}` } });
    for (const to of r.emails) {
      await sendEmail({
        ...base,
        to,
        replyTo: first.agent?.email || first.agency.settings?.agencyEmail,
        subject: title,
        email: {
          brand: agencyName,
          preheader: line(first),
          title,
          intro: `Hi ${r.firstName}, ${agencyName} has booked you for:`,
          rows: gigs.slice(0, 40).map((b) => [formatDate(b.arriveBy, b.timezone), line(b).split(": ").slice(1).join(": ")]),
          cta: link ? { label: "See your gigs", url: link } : undefined,
          outro: "Times are the venue's local time. Reply to this email if anything doesn't work for you.",
        },
      });
    }
    if (r.phone) {
      await sendSms({
        ...base,
        to: r.phone,
        text: `${agencyName}: ${n === 1 ? "new gig" : `${n} new gigs`} booked. ${n === 1 ? line(first) : `First: ${line(first)}`}.${link ? ` ${link}` : ""}`,
      });
    }
    sent++;
  }
  return sent;
}
