import "server-only";
import { prisma } from "./db";
import { appUrl, sendEmail, sendPush, sendSms } from "./messaging";
import { dealBreakdown, formatMoney } from "./money";
import { recipientsForActs } from "./people";
import { formatDate, localTime } from "./time";

// When a gig becomes Confirmed (the act accepted the offer, or the agent confirmed it):
//  - the act is told it's booked and in their calendar, with their own fee
//  - for weddings and private events, the customer is told the act is confirmed
//    (Settings decides: weddings and private events only, every booking, or never).
// A bar gig's venue is never told: that's just for the agency's records.

const CUSTOMER_EVENT_TYPES = ["WEDDING", "PRIVATE_PARTY", "CORPORATE"];

export async function onConfirmed(bookingId: string) {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      artist: { select: { name: true } },
      venue: { select: { name: true, city: true, address: true } },
      promoter: true,
      event: { select: { name: true, venueText: true } },
      agent: { select: { email: true, name: true } },
      agency: { include: { settings: true } },
    },
  });
  if (!b || b.status !== "CONFIRMED" || !b.artistId || !b.artist || b.demo) return;
  const agencyName = b.agency.settings?.agencyName || b.agency.name;
  const where = b.venue ? `${b.venue.name}${b.venue.city ? `, ${b.venue.city}` : ""}` : b.event?.venueText || "Venue to be confirmed";
  const times = `${localTime(b.setStart, b.timezone)}${b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}`;
  const replyTo = b.agent?.email || b.agency.settings?.agencyEmail;
  const base = { kind: "BOOKING_CHANGE" as const, agencyId: b.agencyId, bookingId: b.id };

  // ---- The act ----
  const fee = dealBreakdown(b).artistMinor;
  const title = `You're booked: ${b.venue?.name ?? b.event?.name ?? "gig"}, ${formatDate(b.arriveBy, b.timezone)}`;
  for (const r of (await recipientsForActs([b.artistId])).get(b.artistId) ?? []) {
    const link = r.userId ? `${appUrl()}/app/gigs/${b.id}` : null;
    const reached = r.userId
      ? await sendPush({
          ...base,
          userId: r.userId,
          payload: { title, body: `It's in your calendar. Arrive ${localTime(b.arriveBy, b.timezone)}.`, url: `/app/gigs/${b.id}` },
        })
      : 0;
    for (const to of r.emails) {
      await sendEmail({
        ...base,
        to,
        replyTo,
        subject: title,
        email: {
          brand: agencyName,
          title,
          highlight: { label: "Confirmed", value: "It's in our calendar and yours" },
          intro: `Hi ${r.firstName}, ${r.isMember ? `${b.artist.name} is` : "you're"} booked. Everything's in place.`,
          rows: [
            ...(r.isMember ? ([["Act", b.artist.name]] as [string, string][]) : []),
            ["Where", where],
            ["Date", formatDate(b.arriveBy, b.timezone)],
            ["Arrive by", localTime(b.arriveBy, b.timezone)],
            ["On", times],
            ...(fee > 0 ? ([["Fee", formatMoney(fee, b.currency)]] as [string, string][]) : []),
          ],
          cta: link ? { label: "Open in Gigsaw", url: link } : undefined,
          outro: "If you've added your gigs to your phone's calendar, it'll appear there by itself.",
        },
      });
    }
    if (!reached && r.phone)
      await sendSms({
        ...base,
        to: r.phone,
        text: `${agencyName}: ${title}. Arrive ${localTime(b.arriveBy, b.timezone)}, on ${times}.${link ? ` ${link}` : ""}`,
      });
  }

  // ---- The customer (weddings and private events) ----
  const mode = b.agency.settings?.customerConfirmations ?? "EVENTS";
  const isEvent = !!b.eventId || CUSTOMER_EVENT_TYPES.includes(b.eventType) || b.promoter?.type === "CLIENT";
  if (mode === "OFF" || (mode === "EVENTS" && !isEvent) || !b.promoter?.email || b.customerToldAt) return;
  const occasion = b.event?.name ?? (b.eventType === "WEDDING" ? "your wedding" : "your event");
  await sendEmail({
    kind: "EVENT",
    agencyId: b.agencyId,
    bookingId: b.id,
    to: b.promoter.email,
    replyTo,
    subject: `Confirmed: ${b.artist.name} for ${occasion}`,
    email: {
      brand: agencyName,
      title: `${b.artist.name} is confirmed`,
      intro: `Hi ${b.promoter.name.split(" ")[0]}, good news: ${b.artist.name} is confirmed for ${occasion}. Everything's booked in.`,
      rows: [
        ["Date", formatDate(b.arriveBy, b.timezone)],
        ["Where", where],
        ["Performing", times],
      ],
      outro: "Any questions, just reply to this email.",
    },
  });
  await prisma.booking.update({ where: { id: b.id }, data: { customerToldAt: new Date() } });
}
