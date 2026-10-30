import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { daysBetween, eventMessagesDue, PLAN_FIELDS, type EventMessage, type TaskKey } from "./event-plan";
import { appUrl, sendEmail, sendPush, sendSms } from "./messaging";
import { dealBreakdown, formatMoney, paymentTotals, type DealInput, type PaymentLike } from "./money";
import { actName } from "./constants";
import { messageFor } from "./message-templates";
import { recipientsForActs } from "./people";
import { claimedReminders, claimReminder } from "./reminders";
import { formatDate, localDateKey, localTime } from "./time";

// Weddings and events: one customer booking with several acts. Each act's gig is an ordinary
// booking linked to the event, so the acts only ever see their own gig and fee, while the
// customer's money (sale, VAT, payments) is added up across all of them.

type MoneyBooking = DealInput & { status: string; currency: string; payments: PaymentLike[] };

/** The customer's money for an event, added up across its acts (cancelled gigs left out). */
export function eventTotals(bookings: MoneyBooking[]) {
  const live = bookings.filter((b) => b.status !== "CANCELLED");
  let sale = 0;
  let fees = 0;
  let vat = 0;
  let cost = 0;
  let received = 0;
  let deposits = 0;
  for (const b of live) {
    const d = dealBreakdown(b);
    sale += d.grossMinor;
    fees += d.bookingFeeMinor;
    vat += d.vatMinor;
    cost += d.artistMinor;
    const t = paymentTotals(b.payments);
    received += t.receivedMinor;
    deposits += t.depositReceivedMinor;
  }
  const currency = live[0]?.currency ?? bookings[0]?.currency ?? "GBP";
  return {
    currency,
    sale,
    /** Booking fees on top of the acts' fees, all ours. */
    fees,
    vat,
    total: sale + fees + vat,
    cost,
    margin: sale + fees - cost,
    received,
    deposits,
    outstanding: Math.max(0, sale + fees + vat - received),
    acts: live.length,
  };
}

/** Checklist items that tick themselves once the thing has happened. */
export function autoDone(
  key: string,
  e: { plannerDoneAt: Date | null },
  totals: ReturnType<typeof eventTotals>,
  sent: Set<string>,
  contractSigned = false,
): boolean {
  switch (key as TaskKey) {
    case "CONTRACT":
      return contractSigned;
    case "DEPOSIT":
      return totals.received > 0;
    case "PLANNER":
      return !!e.plannerDoneAt;
    case "BALANCE":
      return totals.total > 0 && totals.outstanding === 0;
    case "ITINERARY":
      return sent.has("ACT_DETAILS");
    case "THANKS":
      return sent.has("THANKS");
    default:
      return false;
  }
}

export const eventInclude = {
  customer: true,
  venue: true,
  bookings: {
    where: { archivedAt: null },
    include: { artist: { select: { id: true, name: true, colour: true, phone: true } }, payments: true, agent: { select: { email: true, name: true } } },
    orderBy: { setStart: "asc" },
  },
  agency: { include: { settings: true } },
} satisfies Prisma.EventInclude;
export type FullEvent = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

/** Which automatic emails have gone for an event (claimed in the Reminder table). */
export async function sentEventMessages(eventId: string) {
  return (await sentEventMessagesFor([eventId])).get(eventId)!;
}

/** The same for several events in one query, by event id. */
export async function sentEventMessagesFor(eventIds: string[]) {
  const rows = await prisma.reminder.findMany({ where: { recipient: { in: eventIds.map((id) => `event:${id}`) } }, select: { kind: true, recipient: true } });
  const out = new Map(eventIds.map((id) => [id, new Set<string>()]));
  for (const r of rows) out.get(r.recipient.replace(/^event:/, ""))?.add(r.kind.replace(/^EV_/, ""));
  return out;
}

const claim = (kind: EventMessage, eventId: string) => claimReminder(`EV_${kind}`, `event:${eventId}`, "");

export function plannerUrl(token: string) {
  return `${appUrl()}/w/${token}`;
}

/** Make the customer's planner link if the event doesn't have one yet. */
export async function ensurePlannerToken(eventId: string) {
  const e = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { plannerToken: true } });
  if (e.plannerToken) return e.plannerToken;
  const { randomBytes } = await import("node:crypto");
  const token = randomBytes(18).toString("base64url");
  await prisma.event.update({ where: { id: eventId }, data: { plannerToken: token } });
  return token;
}

const brandOf = (e: FullEvent) => e.agency.settings?.agencyName || e.agency.name;
const replyOf = (e: FullEvent) => e.bookings.find((b) => b.agent?.email)?.agent?.email || e.agency.settings?.agencyEmail;
const isWedding = (e: FullEvent) => e.type === "WEDDING";
const eventDay = (e: FullEvent) => formatDate(new Date(`${e.date}T12:00:00Z`), "UTC");
const live = (e: FullEvent) => e.bookings.filter((b) => b.status !== "CANCELLED" && b.status !== "ENQUIRY");
/** Gigs that have an act, for messages to the acts. */
const withAct = (e: FullEvent) => live(e).filter((b): b is typeof b & { artistId: string; artist: NonNullable<typeof b.artist> } => !!b.artistId && !!b.artist);

/** The business's wording for an event email, if it has changed it (Settings > Notifications). */
const tpl = (e: FullEvent, key: string, firstName: string) =>
  messageFor(e.agency.settings?.messageTemplates, key, { first_name: firstName, event: e.name, date: eventDay(e), business: brandOf(e) });
const TEMPLATE_OF: Partial<Record<EventMessage, string>> = {
  PLANNER_REQUEST: "PLANNER",
  PLANNER_CHASE: "PLANNER",
  BALANCE_REMINDER: "BALANCE",
  ACT_DETAILS: "EVENT_DETAILS",
  THANKS: "THANKS",
};

/** Email the customer their planner link. Used by the automatic emails and the "Send" button. */
export async function sendPlannerEmail(e: FullEvent, chase = false) {
  if (!e.customer?.email) return false;
  const token = await ensurePlannerToken(e.id);
  const what = isWedding(e) ? "your wedding" : "your event";
  const t = tpl(e, "PLANNER", e.customer.name.split(" ")[0]);
  await sendEmail({
    kind: "EVENT",
    agencyId: e.agencyId,
    to: e.customer.email,
    replyTo: replyOf(e),
    subject: t.subject ?? (chase ? `A quick reminder: the details for ${what}` : `${e.name}: a few details from you`),
    email: {
      brand: brandOf(e),
      title: chase ? `A quick reminder about ${what}` : `Let's get ${what} just right`,
      intro:
        t.intro ??
        `Hi ${e.customer.name.split(" ")[0]}, ${
          chase ? "we still need a few details" : "so everyone performing knows exactly what you'd like, please tell us a few details"
        }: the running order, who to ask for on the day, parking, and any song requests. It takes about five minutes, and you can come back and change it.`,
      rows: [
        ["Date", eventDay(e)],
        ...live(e).map((b) => [actName(b), `${localTime(b.setStart, b.timezone)}${b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}`] as [string, string]),
      ],
      cta: { label: "Fill in your details", url: plannerUrl(token) },
      outro: "Any questions, just reply to this email.",
    },
  });
  await prisma.event.update({ where: { id: e.id }, data: { plannerSentAt: new Date() } });
  return true;
}

/** Email the customer what they owe, act by act (sale prices only, never what the acts are paid). */
async function sendBalanceReminder(e: FullEvent) {
  if (!e.customer?.email) return false;
  const t = eventTotals(e.bookings);
  if (t.outstanding <= 0) return false;
  const m = (x: number) => formatMoney(x, t.currency);
  const w = tpl(e, "BALANCE", e.customer.name.split(" ")[0]);
  await sendEmail({
    kind: "EVENT",
    agencyId: e.agencyId,
    to: e.customer.email,
    replyTo: replyOf(e),
    subject: w.subject ?? `${e.name}: balance of ${m(t.outstanding)}`,
    email: {
      brand: brandOf(e),
      title: `Your balance for ${eventDay(e)}`,
      intro: w.intro ?? `Hi ${e.customer.name.split(" ")[0]}, not long now! Here's a summary of what's booked and what's left to pay.`,
      rows: [
        ...live(e).map((b) => {
          const d = dealBreakdown(b);
          return [actName(b), m(d.totalDueMinor)] as [string, string];
        }),
        ["Total", m(t.total)],
        ["Paid so far", m(t.received)],
        ["Left to pay", m(t.outstanding)],
      ],
      outro: "Reply to this email if you'd like our bank details again or have any questions.",
    },
  });
  return true;
}

/** Each act's final details: their own times plus the plan. No money at all. */
export async function sendActDetails(e: FullEvent) {
  const gigs = withAct(e);
  if (!gigs.length) return 0;
  const recipients = await recipientsForActs(gigs.map((g) => g.artistId));
  const plan = PLAN_FIELDS.filter(([k]) => e[k]).map(([k, label]) => [label, e[k]] as [string, string]);
  const where = e.venue ? [e.venue.name, e.venue.address, e.venue.city].filter(Boolean).join(", ") : e.venueText;
  let sent = 0;
  for (const b of gigs) {
    const others = gigs.filter((o) => o.id !== b.id).map((o) => `${o.artist.name} ${localTime(o.setStart, o.timezone)}`);
    for (const r of recipients.get(b.artistId) ?? []) {
      const t = tpl(e, "EVENT_DETAILS", r.firstName);
      const title = `Final details: ${e.name}, ${eventDay(e)}`;
      const base = { kind: "EVENT" as const, agencyId: e.agencyId, bookingId: b.id };
      if (r.userId)
        await sendPush({
          ...base,
          userId: r.userId,
          payload: { title, body: `Arrive ${localTime(b.arriveBy, b.timezone)}. Tap for the running order and contacts.`, url: `/app/gigs/${b.id}` },
        });
      for (const to of r.emails) {
        await sendEmail({
          ...base,
          to,
          replyTo: replyOf(e),
          subject: t.subject ?? title,
          email: {
            brand: brandOf(e),
            title,
            intro:
              t.intro ??
              `Hi ${r.firstName}, here's everything for ${r.isMember ? `${b.artist.name}'s` : "your"} ${isWedding(e) ? "wedding" : "event"} booking.`,
            rows: [
              ["Where", where || "To be confirmed"],
              ["Arrive by", localTime(b.arriveBy, b.timezone)],
              ["On", `${localTime(b.setStart, b.timezone)}${b.setEnd ? ` to ${localTime(b.setEnd, b.timezone)}` : ""}`],
              ...(others.length ? ([["Also performing", others.join(", ")]] as [string, string][]) : []),
              ...plan,
            ],
            cta: r.userId ? { label: "Open in Gigsaw", url: `${appUrl()}/app/gigs/${b.id}` } : undefined,
            outro: "Anything unclear? Reply to this email.",
          },
        });
      }
      if (!r.userId && r.phone) {
        await sendSms({ ...base, to: r.phone, text: `${brandOf(e)}: ${title}. Arrive ${localTime(b.arriveBy, b.timezone)}. Full details are in your email.` });
      }
      sent++;
    }
  }
  return sent;
}

async function sendThanks(e: FullEvent) {
  if (!e.customer?.email) return false;
  const review = e.agency.settings?.reviewLink;
  const t = tpl(e, "THANKS", e.customer.name.split(" ")[0]);
  await sendEmail({
    kind: "EVENT",
    agencyId: e.agencyId,
    to: e.customer.email,
    replyTo: replyOf(e),
    subject: t.subject ?? (isWedding(e) ? "Congratulations, and thank you!" : "Thank you!"),
    email: {
      brand: brandOf(e),
      title: isWedding(e) ? "Congratulations!" : "Thank you",
      intro:
        t.intro ??
        `Hi ${e.customer.name.split(" ")[0]}, thank you for booking ${withAct(e)
          .map((b) => b.artist.name)
          .join(", ")} with us. We hope it was a brilliant day.`,
      cta: review ? { label: "Leave us a review", url: review } : undefined,
      outro: review ? "If you have a minute, a review really helps other couples find us." : "We'd love to hear how it went: just reply to this email.",
    },
  });
  return true;
}

/** Send whichever automatic event emails are due. Safe to run as often as you like. */
export async function runEventMessages(now = new Date()) {
  const where = {
    status: "ACTIVE",
    autoEmails: true,
    demo: false,
    agency: { status: "ACTIVE", settings: { eventEmails: true } },
    date: { gte: localDateKey(new Date(now.getTime() - 8 * 86_400_000), "UTC"), lte: localDateKey(new Date(now.getTime() + 57 * 86_400_000), "UTC") },
  } satisfies Prisma.EventWhereInput;
  // The emails in their sending window that could go: all but the acts' details need the customer's email.
  const dueNow = (e: { date: string; timezone: string; plannerDoneAt: Date | null; customer: { email: string } | null }) => {
    // Office hours only: nothing before 9am or after 8pm, the event's local time.
    const hour = localTime(now, e.timezone);
    if (hour < "09:00" || hour >= "20:00") return [];
    return eventMessagesDue(daysBetween(localDateKey(now, e.timezone), e.date)).filter((kind) => {
      if (kind === "ACT_DETAILS") return true;
      if ((kind === "PLANNER_REQUEST" || kind === "PLANNER_CHASE") && e.plannerDoneAt) return false;
      return !!e.customer?.email;
    });
  };
  // This runs every minute, so look first at just the dates: only events with an email due that
  // hasn't gone yet are loaded in full.
  const candidates = (
    await prisma.event.findMany({ where, select: { id: true, date: true, timezone: true, plannerDoneAt: true, customer: { select: { email: true } } } })
  ).filter((e) => dueNow(e).length);
  const claimed = await claimedReminders(
    [...new Set(candidates.flatMap(dueNow))].map((k) => `EV_${k}`),
    candidates.map((e) => `event:${e.id}`),
    [""],
  );
  const isSent = (kind: EventMessage, eventId: string) => claimed.has(`EV_${kind}|event:${eventId}|`);
  const ids = candidates.filter((e) => dueNow(e).some((kind) => !isSent(kind, e.id))).map((e) => e.id);
  if (!ids.length) return 0;
  const events = await prisma.event.findMany({ where: { ...where, id: { in: ids } }, include: eventInclude });
  let sent = 0;
  for (const e of events) {
    for (const kind of dueNow(e)) {
      if (isSent(kind, e.id)) continue;
      if (kind === "BALANCE_REMINDER" && eventTotals(e.bookings).outstanding <= 0) continue;
      if (kind === "ACT_DETAILS" && !withAct(e).length) continue;
      // Switched off in Settings > Notifications: the automatic email doesn't go.
      const key = TEMPLATE_OF[kind];
      if (key && !messageFor(e.agency.settings?.messageTemplates, key, {}).on) continue;
      if (!(await claim(kind, e.id))) continue;
      if (kind === "PLANNER_REQUEST") await sendPlannerEmail(e);
      else if (kind === "PLANNER_CHASE") await sendPlannerEmail(e, true);
      else if (kind === "BALANCE_REMINDER") await sendBalanceReminder(e);
      else if (kind === "ACT_DETAILS") await sendActDetails(e);
      else if (kind === "THANKS") await sendThanks(e);
      sent++;
    }
  }
  return sent;
}

/** Mark an automatic email as sent by hand (e.g. "Send final details now"), so it doesn't go twice. */
export async function markEventMessageSent(eventId: string, kind: EventMessage) {
  return claim(kind, eventId);
}
