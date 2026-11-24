import "server-only";
import { clientRecipient, leadPersonSelect } from "./client-recipient";
import { prisma } from "./db";
import { appUrl, sendEmail, sendPush, sendSms } from "./messaging";
import { dealBreakdown, formatMoney } from "./money";
import { messageFor } from "./message-templates";
import { recipientsForGigs } from "./people";
import { CUSTOMER_EVENT_TYPES } from "./team-alert-routing";
import { formatDate, localTime } from "./time";

// When a gig becomes Confirmed (the act accepted the offer, or the agent confirmed it):
//  - the act is told it's booked and in their calendar, with their own fee
//  - for weddings and private events, the customer is told the act is confirmed
//    (Settings decides: weddings and private events only, every booking, or never).
// By default a bar gig's venue is never told: that's just for the agency's records. When Settings says every booking,
// a venue gig's confirmation goes to the client's lead contact, as src/lib/client-recipient.ts decides.

export async function onConfirmed(bookingId: string) {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      artist: { select: { name: true } },
      venue: { select: { name: true, city: true, address: true, leadContact: { select: leadPersonSelect } } },
      promoter: { include: { leadContact: { select: leadPersonSelect } } },
      clientContact: { select: leadPersonSelect },
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
  const templates = b.agency.settings?.messageTemplates;
  const gigVars = {
    act: b.artist.name,
    venue: b.venue?.name ?? b.event?.name ?? "the venue",
    date: formatDate(b.arriveBy, b.timezone),
    time: localTime(b.arriveBy, b.timezone),
    business: agencyName,
  };
  const actOn = messageFor(templates, "BOOKED", gigVars).on;
  const title = `You're booked: ${b.venue?.name ?? b.event?.name ?? "booking"}, ${formatDate(b.arriveBy, b.timezone)}`;
  for (const r of actOn ? ((await recipientsForGigs([b])).get(b.id) ?? []) : []) {
    const t = messageFor(templates, "BOOKED", { ...gigVars, first_name: r.firstName });
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
        subject: t.subject ?? title,
        email: {
          brand: agencyName,
          title,
          highlight: { label: "Confirmed", value: "It's in our calendar and yours" },
          intro: t.intro ?? `Hi ${r.firstName}, ${r.isMember ? `${b.artist.name} is` : "you're"} booked. Everything's in place.`,
          rows: [
            ...(r.isMember ? ([["Act", b.artist.name]] as [string, string][]) : []),
            ["Where", where],
            ["Date", formatDate(b.arriveBy, b.timezone)],
            ["Arrive by", localTime(b.arriveBy, b.timezone)],
            ["On", times],
            ...(fee > 0 && !r.standIn ? ([["Fee", formatMoney(fee, b.currency)]] as [string, string][]) : []),
          ],
          cta: link ? { label: "Open in Gigsaw", url: link } : undefined,
          outro: "If you've added your bookings to your phone's calendar, it'll appear there by itself.",
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
  if (mode === "OFF" || (mode === "EVENTS" && !isEvent) || b.customerToldAt) return;
  // Part of a wedding or event: the customer booked it as one, so they hear once, when every act in it is confirmed.
  if (b.eventId) return tellCustomerEventConfirmed(b.eventId);
  // The customer, or for a venue gig the client's lead contact (never a company that asked not to get these at its own email).
  const to = clientRecipient(b, "DAY_TO_DAY");
  if (!to.email) return;
  const occasion = b.event?.name ?? (b.eventType === "WEDDING" ? "your wedding" : "your event");
  const c = messageFor(templates, "CUSTOMER_CONFIRMED", { ...gigVars, event: occasion, first_name: to.firstName });
  if (!c.on) return;
  await sendEmail({
    kind: "EVENT",
    agencyId: b.agencyId,
    bookingId: b.id,
    to: to.email,
    replyTo,
    subject: c.subject ?? `Confirmed: ${b.artist.name} for ${occasion}`,
    email: {
      brand: agencyName,
      title: `${b.artist.name} is confirmed`,
      intro: c.intro ?? `Hi ${to.firstName}, good news: ${b.artist.name} is confirmed for ${occasion}. Everything's booked in.`,
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

/**
 * A wedding or event with several acts is one booking to the customer. Once every act in it is confirmed,
 * they get one email listing them all (never one per act); until then, nothing. Acts already in the
 * "you're booked" email from their proposal are listed again here, so the email shows the whole booking.
 */
async function tellCustomerEventConfirmed(eventId: string) {
  const e = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      customer: true,
      venue: { select: { name: true, city: true } },
      agency: { include: { settings: true } },
      bookings: {
        where: { archivedAt: null, status: { notIn: ["CANCELLED", "ENQUIRY"] } },
        include: { artist: { select: { name: true } }, venue: { select: { name: true } }, promoter: true, agent: { select: { email: true } } },
        orderBy: { setStart: "asc" },
      },
    },
  });
  if (!e || e.status !== "ACTIVE" || !e.bookings.length) return;
  // Still waiting on an act (or a slot with no act yet): wait until they're all in.
  if (e.bookings.some((x) => !x.artist || (x.status !== "CONFIRMED" && x.status !== "SETTLED"))) return;
  const untold = e.bookings.filter((x) => !x.customerToldAt).map((x) => x.id);
  if (!untold.length) return;
  const to = e.customer?.email || e.bookings.find((x) => x.promoter?.email)?.promoter?.email;
  if (!to) return;
  // Claim them first, so two acts confirming at the same moment send one email, not two.
  const claimed = await prisma.booking.updateMany({ where: { id: { in: untold }, customerToldAt: null }, data: { customerToldAt: new Date() } });
  if (!claimed.count) return;

  const s = e.agency.settings;
  const agencyName = s?.agencyName || e.agency.name;
  const name = e.customer?.name ?? e.bookings.find((x) => x.promoter)?.promoter?.name ?? "";
  const first = name.split(" ")[0] || "there";
  const acts = e.bookings.map((x) => x.artist!.name);
  const actList = acts.length > 1 ? `${acts.slice(0, -1).join(", ")} and ${acts[acts.length - 1]}` : acts[0];
  const where = e.venue ? `${e.venue.name}${e.venue.city ? `, ${e.venue.city}` : ""}` : e.venueText || "Venue to be confirmed";
  const first0 = e.bookings[0];
  const c = messageFor(s?.messageTemplates, "CUSTOMER_CONFIRMED", {
    act: actList,
    event: e.name,
    date: formatDate(first0.arriveBy, first0.timezone),
    first_name: first,
    business: agencyName,
  });
  if (!c.on) return;
  await sendEmail({
    kind: "EVENT",
    agencyId: e.agencyId,
    bookingId: null,
    to,
    replyTo: first0.agent?.email || s?.agencyEmail,
    subject: c.subject ?? (acts.length > 1 ? `Everyone's confirmed for ${e.name}` : `Confirmed: ${actList} for ${e.name}`),
    email: {
      brand: agencyName,
      title: acts.length > 1 ? "Everyone's confirmed" : `${actList} is confirmed`,
      intro:
        c.intro ??
        `Hi ${first}, good news: ${acts.length > 1 ? `everyone is confirmed for ${e.name}` : `${actList} is confirmed for ${e.name}`}. Here's your booking with us:`,
      rows: [
        ["Date", formatDate(first0.arriveBy, first0.timezone)],
        ["Where", where],
        ...e.bookings.map(
          (x) => [x.artist!.name, `${localTime(x.setStart, x.timezone)}${x.setEnd ? `–${localTime(x.setEnd, x.timezone)}` : ""}`] as [string, string],
        ),
      ],
      rowsTitle: "Your booking",
      outro: "Any questions, just reply to this email.",
    },
  });
}
