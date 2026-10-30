import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { messageFor } from "./message-templates";
import { wants } from "./notify-prefs";
import { appUrl, sendEmail, sendPush, sendSms } from "./messaging";
import { dealBreakdown, formatMoney } from "./money";
import { onConfirmed } from "./confirmations";
import { groupByRecipient, recipientsForActs } from "./people";
import { formatDate, localTime } from "./time";

// Offering gigs to acts. Setting a gig to "Awaiting confirmation" sends the act (or each of its
// members) a message with a private link where they accept or decline, no login needed.
// Accepting confirms the gig; declining leaves it as it is and alerts the agent.
// The act only ever sees their own fee, never what the venue or customer pays.

const offerInclude = {
  artist: { select: { name: true } },
  venue: { select: { name: true, city: true } },
  agent: { select: { email: true, name: true, phone: true, notifyPrefs: true } },
  agency: { include: { settings: true } },
} as const;

const when = (b: { arriveBy: Date; setStart: Date; setEnd: Date | null; timezone: string }) =>
  `${formatDate(b.arriveBy, b.timezone)}, on ${localTime(b.setStart, b.timezone)}${b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""} (arrive ${localTime(b.arriveBy, b.timezone)})`;

/**
 * Send offers for these gigs (those awaiting confirmation with an act). Each person gets one
 * message listing their offers. Returns how many people were contacted.
 */
export async function sendOffers(bookingIds: string[]) {
  if (!bookingIds.length) return 0;
  const gigs = await prisma.booking.findMany({
    where: { id: { in: bookingIds }, status: "AWAITING", artistId: { not: null } },
    include: offerInclude,
    orderBy: { arriveBy: "asc" },
  });
  if (!gigs.length) return 0;
  // A fresh link and a clean answer for each offer, saved in one transaction.
  const offeredAt = new Date();
  await prisma.$transaction(
    gigs.map((g) => {
      g.offerToken ??= randomBytes(18).toString("base64url");
      return prisma.booking.update({ where: { id: g.id }, data: { offerToken: g.offerToken, offeredAt, offerResponse: null, respondedAt: null } });
    }),
  );
  const live = gigs.filter((g) => !g.demo); // demo data never sends anything
  const recipients = await recipientsForActs(live.map((g) => g.artistId!));
  const byPerson = groupByRecipient(live, recipients);
  for (const { to: r, gigs: list } of byPerson.values()) {
    const first = list[0];
    const agencyName = first.agency.settings?.agencyName || first.agency.name;
    const link = `${appUrl()}/o/${first.offerToken}`;
    const n = list.length;
    const title =
      n === 1 ? `Booking offer: ${first.venue?.name ?? "a booking"}, ${formatDate(first.arriveBy, first.timezone)}` : `${n} booking offers from ${agencyName}`;
    const base = { kind: "BOOKING_CHANGE" as const, agencyId: first.agencyId, bookingId: n === 1 ? first.id : null };
    const named = r.isMember || new Set(list.map((g) => g.artistId)).size > 1;
    const t = messageFor(first.agency.settings?.messageTemplates, "OFFER", {
      first_name: r.firstName,
      act: first.artist?.name,
      venue: first.venue?.name ?? "a booking",
      date: formatDate(first.arriveBy, first.timezone),
      time: localTime(first.arriveBy, first.timezone),
      business: agencyName,
    });
    if (!t.on) continue;
    const reached = r.userId
      ? await sendPush({
          ...base,
          userId: r.userId,
          payload: { title, body: "Tap to accept or decline.", url: `/o/${first.offerToken}`, tag: `offer-${first.id}` },
        })
      : 0;
    for (const to of r.emails) {
      await sendEmail({
        ...base,
        to,
        replyTo: first.agent?.email || first.agency.settings?.agencyEmail,
        subject: t.subject ?? title,
        email: {
          brand: agencyName,
          preheader: "Please accept or decline",
          title,
          intro:
            t.intro ??
            `Hi ${r.firstName}, ${agencyName} would like to book ${named ? "your act" : "you"} for ${n === 1 ? "this booking" : "these bookings"}. Please accept or decline as soon as you can.`,
          rows: list.map((g) => {
            const fee = dealBreakdown(g).artistMinor;
            return [
              formatDate(g.arriveBy, g.timezone),
              `${named ? `${g.artist!.name} at ` : ""}${g.venue?.name ?? "Venue to be confirmed"}${g.venue?.city ? `, ${g.venue.city}` : ""}\n${when(g)}${fee > 0 ? `\nFee: ${formatMoney(fee, g.currency)}` : ""}`,
            ] as [string, string];
          }),
          cta: { label: n === 1 ? "Accept or decline" : "See the offers", url: link },
          outro: `Questions? Reply to this email to reach ${first.agent?.name ?? agencyName}.`,
        },
      });
    }
    if (!reached && r.phone) {
      await sendSms({
        ...base,
        to: r.phone,
        text: t.text
          ? `${t.text} ${link}`
          : `${agencyName}: ${n === 1 ? `booking offer, ${first.venue?.name ?? ""} ${formatDate(first.arriveBy, first.timezone)}` : `${n} booking offers`}. Accept or decline: ${link}`,
      });
    }
  }
  return byPerson.size;
}

/**
 * Record the act's answer. Accepting confirms the gig; declining leaves it awaiting
 * confirmation. Either way the agent is told straight away. Returns false if the offer is no
 * longer open (cancelled, or moved to another act).
 */
export async function answerOffer(bookingId: string, answer: "ACCEPTED" | "DECLINED") {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: offerInclude });
  if (!b || b.status !== "AWAITING" || !b.artist) return false;
  await prisma.booking.update({
    where: { id: b.id },
    data: { offerResponse: answer, respondedAt: new Date(), ...(answer === "ACCEPTED" ? { status: "CONFIRMED" } : {}) },
  });
  await prisma.activity.create({
    data: {
      agencyId: b.agencyId,
      entity: "BOOKING",
      entityId: b.id,
      action: answer === "ACCEPTED" ? "act accepted the offer" : "act declined the offer",
      detail: b.artist.name,
    },
  });
  if (b.demo) return true;
  if (answer === "ACCEPTED") await onConfirmed(b.id);
  const agencyName = b.agency.settings?.agencyName || b.agency.name;
  const accepted = answer === "ACCEPTED";
  const subject = `${b.artist.name} ${accepted ? "accepted" : "declined"}: ${b.venue?.name ?? "booking"}, ${formatDate(b.arriveBy, b.timezone)}`;
  // The lead agent hears about it (unless they've turned this off); with no agent, the business email does.
  const kind = accepted ? "ACCEPTED" : "DECLINED";
  const to = b.agent ? (wants(b.agent.notifyPrefs, kind, "email") ? b.agent.email : null) : b.agency.settings?.agencyEmail;
  const base = { kind: "BOOKING_CHANGE" as const, agencyId: b.agencyId, bookingId: b.id };
  if (to) {
    await sendEmail({
      ...base,
      to,
      subject,
      email: {
        brand: agencyName,
        title: subject,
        highlight: { label: accepted ? "Confirmed" : "Declined", value: accepted ? "The booking is on" : "Find another act", tone: accepted ? "good" : "bad" },
        rows: [
          ["Booking", `${b.venue?.name ?? "No venue"}${b.venue?.city ? `, ${b.venue.city}` : ""}`],
          ["When", when(b)],
        ],
        cta: { label: "Open the booking", url: `${appUrl()}/bookings/${b.id}` },
      },
    });
  }
  // A decline needs sorting quickly: text the agent too.
  if (!accepted && b.agent?.phone && wants(b.agent.notifyPrefs, "DECLINED", "text")) {
    await sendSms({ ...base, to: b.agent.phone, text: `Gigsaw: ${subject}. ${appUrl()}/bookings/${b.id}` });
  }
  return true;
}
