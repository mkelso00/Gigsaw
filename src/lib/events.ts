import "server-only";
import { directTotals, isDirectPlan } from "./pay-plan";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import {
  balanceDueDate,
  daysBetween,
  EVENT_STEPS,
  eventMessagesDue,
  GATE_KIND,
  JOURNEY_LOOKAHEAD_DAYS,
  journeySecured,
  missedAtLaunch,
  parseExtraFields,
  planChanges,
  plannerDueDate,
  planRows,
  SECURED_STATUSES,
  timeToGo,
  type EventMessage,
  type TaskKey,
} from "./event-plan";
import { appUrl, sendEmail, sendPush, sendSms } from "./messaging";
import { dealBreakdown, formatMoney, paymentTotals, type DealInput, type PaymentLike } from "./money";
import { actName } from "./constants";
import { messageFor } from "./message-templates";
import { recipientsForGigs } from "./people";
import { claimedReminders, claimReminder } from "./reminders";
import { cashAddressLine } from "./proposal-pay";
import { formatDate, localDateKey, localTime } from "./time";

export { JOURNEY_LIVE, missedAtLaunch } from "./event-plan";

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
  return (await eventMessageLog(eventIds)).sent;
}

/**
 * Which automatic emails have gone (`sent`), and which were looked at in their window and found not
 * needed (`checked`, e.g. the balance reminder when nothing was owed), by event id.
 */
export async function eventMessageLog(eventIds: string[]) {
  const rows = await prisma.reminder.findMany({
    where: { recipient: { in: eventIds.map((id) => `event:${id}`) } },
    select: { kind: true, recipient: true, key: true },
  });
  const sent = new Map(eventIds.map((id) => [id, new Set<string>()]));
  const checked = new Map(eventIds.map((id) => [id, new Set<string>()]));
  for (const r of rows) (r.key === CHECKED ? checked : sent).get(r.recipient.replace(/^event:/, ""))?.add(r.kind.replace(/^EV_/, ""));
  return { sent, checked };
}

const claim = (kind: EventMessage, eventId: string) => claimReminder(`EV_${kind}`, `event:${eventId}`, "");
/**
 * The Reminder key that marks a step as looked at in its window and not needed, so the every-minute run
 * doesn't load the event again and again to find the same thing. It doesn't count as sent.
 */
const CHECKED = "checked";

export function plannerUrl(token: string) {
  return `${appUrl()}/w/${token}`;
}

/** Make the customer's planner link if the event doesn't have one yet. */
async function ensurePlannerToken(eventId: string) {
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
type ActGig = FullEvent["bookings"][number] & { artistId: string; artist: NonNullable<FullEvent["bookings"][number]["artist"]> };
const hasAct = (b: FullEvent["bookings"][number]): b is ActGig => !!b.artistId && !!b.artist;
/** Every live gig with an act, On hold included: for the customer's and staff's emails (names, never fees). */
const actsOf = (e: FullEvent) => live(e).filter(hasAct);
/**
 * Gigs whose act may hear about the event: those that have an act and aren't On hold. An On hold gig is a
 * date kept for a wedding that isn't booked yet (or pencilled in by staff), so its act isn't told anything.
 */
const withAct = (e: FullEvent) => actsOf(e).filter((b) => b.status !== "HOLD");
/** Why the acts can't be sent anything: no act at all, or only On hold ones. */
export const noActsWhy = (e: FullEvent) =>
  actsOf(e).length ? "The acts are On hold until the booking is secured, so nothing goes to them yet" : "No acts to send to yet";

/** The business's wording for an event email, if it has changed it (Settings > Notifications). */
const tpl = (e: FullEvent, key: string, firstName: string, extra: Record<string, string> = {}) =>
  messageFor(e.agency.settings?.messageTemplates, key, { first_name: firstName, event: e.name, date: eventDay(e), business: brandOf(e), ...extra });
/** Each automatic email's wording in Settings > Notifications, where it can also be switched off. */
const TEMPLATE_OF: Record<EventMessage, string> = {
  PLANNER_REQUEST: "PLANNER",
  TEAM_SIX_MONTHS: "TEAM_SIX_MONTHS",
  BALANCE_REMINDER: "BALANCE",
  PLANNER_CHASE: "PLANNER_CHASE",
  TEAM_THREE_MONTHS: "TEAM_THREE_MONTHS",
  PLANNER_FINAL: "PLANNER_FINAL",
  TEAM_PLANNER_LATE: "TEAM_PLANNER_LATE",
  WEEK_TO_GO: "WEEK_TO_GO",
  ACT_DETAILS: "EVENT_DETAILS",
  THANKS: "THANKS",
};

const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const dayText = (key: string) => formatDate(new Date(`${key}T12:00:00Z`), "UTC");
const todayOf = (e: { timezone: string }) => localDateKey(new Date(), e.timezone);
const theCustomer = (e: FullEvent) => (isWedding(e) ? "the couple" : "the customer");
/** The balance is paid to the business in cash, with no VAT (src/lib/pay-plan.ts BALANCE_CASH). */
const cashBalance = (e: FullEvent) => e.payPlan === "BALANCE_CASH";
/** How a cash balance reaches the business, for the customer's emails. */
export function cashHow(address: string | null | undefined) {
  const where = cashAddressLine(address);
  return where ? `In cash, with no VAT, brought to ${where}` : "In cash, with no VAT. We'll send you the address to bring it to";
}
const moneyOf = (e: FullEvent) => {
  const currency = eventTotals(e.bookings).currency;
  return (x: number) => formatMoney(x, currency);
};
/** Each act's times on the day, for the customer: no money. */
const actTimes = (e: FullEvent) =>
  live(e).map((b) => [actName(b), `${localTime(b.setStart, b.timezone)}${b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}`] as [string, string]);

/**
 * What the customer still owes the business. With a deposit plan (src/lib/pay-plan.ts) the acts are
 * paid direct, so only the business's own part counts.
 */
export function owedToUs(e: FullEvent) {
  return isDirectPlan(e.payPlan) ? directTotals(live(e)).usLeft : eventTotals(e.bookings).outstanding;
}

/**
 * The customer's money in a few rows: totals for the whole wedding (never what an act is paid) and when
 * the balance is due. With a deposit plan, what's owed to the business and how the acts are paid.
 */
function paymentSummary(e: FullEvent): [string, string][] {
  const t = eventTotals(e.bookings);
  if (t.total <= 0) return [];
  const m = moneyOf(e);
  const due = balanceDueDate(e.date);
  const dueText = due > todayOf(e) ? dayText(due) : "Now";
  const rows: [string, string][] = [
    ["Total", m(t.total)],
    ["Paid so far", m(t.received)],
    ["Left to pay", m(t.outstanding)],
  ];
  if (isDirectPlan(e.payPlan)) {
    const usLeft = directTotals(live(e)).usLeft;
    rows.push([`Deposit to ${brandOf(e)}`, usLeft > 0 ? `${m(usLeft)}, due ${due > todayOf(e) ? `by ${dueText}` : "now"}` : "Paid, thank you"]);
    rows.push(["The acts", e.payPlan === "DEPOSIT_CASH" ? "Paid in cash on the day" : "Paid by bank transfer, straight to them"]);
  } else if (t.outstanding > 0) {
    rows.push(["Balance due", dueText]);
    if (cashBalance(e)) rows.push(["How to pay the balance", cashHow(e.agency.settings?.cashAddress)]);
  }
  return rows;
}

/** Which planner email: the first ask (6 months before), the 3-month reminder, or the last call when it's due (4 weeks before). */
export type PlannerStep = "request" | "nudge" | "final";

/**
 * Email the customer their planner link. Used by the automatic emails and the "Send" buttons; `money`
 * adds the payment summary. A customer who has never been sent the link always gets the first ask,
 * whatever the step, so a late booking is never reminded of something it hasn't had.
 */
export async function sendPlannerEmail(e: FullEvent, step: PlannerStep = "request", opts: { money?: boolean } = {}) {
  if (!e.customer?.email) return false;
  const token = await ensurePlannerToken(e.id);
  if (!e.plannerSentAt) step = "request";
  const first = firstOf(e.customer.name);
  const what = isWedding(e) ? "your wedding" : "your event";
  const today = todayOf(e);
  const due = plannerDueDate(e.date);
  const by = due > today ? `by ${dayText(due)}` : "as soon as you can";
  const t = tpl(e, step === "request" ? "PLANNER" : step === "nudge" ? "PLANNER_CHASE" : "PLANNER_FINAL", first);
  const words = {
    request: {
      subject: `${e.name}: a few details from you`,
      title: `Let's get ${what} just right`,
      intro: `Hi ${first}, so everyone performing knows exactly what you'd like, please fill in your running order: the timings, who to ask for on the day, parking, and any song requests. We need it ${by}. It takes about five minutes, and you can come back and change it.`,
    },
    nudge: {
      subject: `A quick reminder: the running order for ${what}`,
      title: `A quick reminder about ${what}`,
      intro: `Hi ${first}, we still need your running order and a few details for ${what}: the timings, who to ask for on the day, parking, and any song requests. Please fill them in ${by}. It takes about five minutes.`,
    },
    final: {
      subject: `${e.name}: we need your running order`,
      title: "Your running order is due",
      intro: `Hi ${first}, ${what} is only ${timeToGo(daysBetween(today, e.date))} away and we still need your running order and song choices. Our terms ask for them at least four weeks before the day, so please fill them in ${due > today ? by : "today"}. It takes about five minutes.`,
    },
  }[step];
  await sendEmail({
    kind: "EVENT",
    agencyId: e.agencyId,
    to: e.customer.email,
    replyTo: replyOf(e),
    subject: t.subject ?? words.subject,
    email: {
      brand: brandOf(e),
      title: words.title,
      intro: t.intro ?? words.intro,
      rows: [["Date", eventDay(e)], ...actTimes(e), ["Needed by", due > today ? dayText(due) : "As soon as you can"], ...(opts.money ? paymentSummary(e) : [])],
      cta: { label: "Fill in your details", url: plannerUrl(token) },
      outro: "Any questions, just reply to this email.",
    },
  });
  e.plannerSentAt = new Date();
  await prisma.event.update({ where: { id: e.id }, data: { plannerSentAt: e.plannerSentAt } });
  return true;
}

/**
 * Email the customer the balance when it's due (3 months before), if anything is owed to the business:
 * sale prices only, never what the acts are paid. With a deposit plan the acts are paid direct, so it's
 * only the business's part (the deposit); the customer's page shows what goes to each act.
 */
async function sendBalanceReminder(e: FullEvent) {
  if (!e.customer?.email) return false;
  const owed = owedToUs(e);
  if (owed <= 0) return false;
  const t = eventTotals(e.bookings);
  const m = moneyOf(e);
  const first = firstOf(e.customer.name);
  const w = tpl(e, "BALANCE", first);
  const what = isWedding(e) ? "your wedding" : "your event";
  const due = balanceDueDate(e.date);
  const later = due > todayOf(e);
  const direct = isDirectPlan(e.payPlan);
  const rows: [string, string][] = direct
    ? [[`Deposit to ${brandOf(e)}`, `${m(owed)} still to pay`]]
    : [
        ...live(e).map((b) => [actName(b), m(dealBreakdown(b).totalDueMinor)] as [string, string]),
        ["Total", m(t.total)],
        ["Paid so far", m(t.received)],
        ["Left to pay", m(t.outstanding)],
      ];
  rows.push(["Due", later ? dayText(due) : "Now"]);
  const cash = cashBalance(e);
  if (cash) rows.push(["How to pay", cashHow(e.agency.settings?.cashAddress)]);
  const acts = cash
    ? " As agreed, it's paid to us in cash with no VAT added, and we pass it to your musicians in full."
    : !direct
      ? ""
      : e.payPlan === "DEPOSIT_CASH"
        ? " The rest is paid in cash to each act on the day."
        : " The rest goes straight to each act by bank transfer: their details are on your page.";
  await sendEmail({
    kind: "EVENT",
    agencyId: e.agencyId,
    to: e.customer.email,
    replyTo: replyOf(e),
    subject: w.subject ?? `${e.name}: ${direct ? "deposit" : "balance"} of ${m(owed)}`,
    email: {
      brand: brandOf(e),
      title: direct ? `Your deposit for ${eventDay(e)}` : `Your balance for ${eventDay(e)}`,
      intro:
        w.intro ??
        `Hi ${first}, a quick reminder that the ${direct ? "deposit" : "balance"} for ${what} is due ${later ? `by ${dayText(due)}` : "now"}. Here's ${
          direct ? "what's left to pay us" : "a summary of what's booked and what's left to pay"
        }.${acts}`,
      rows,
      cta: e.plannerToken ? { label: "See your page", url: plannerUrl(e.plannerToken) } : undefined,
      outro: cash ? "Reply to this email if you have any questions." : "Reply to this email if you'd like our bank details again or have any questions.",
    },
  });
  return true;
}

/** Each act's final details: their own times plus the plan. No money at all. On hold gigs are left out (withAct). */
export async function sendActDetails(e: FullEvent) {
  const gigs = withAct(e);
  if (!gigs.length) return 0;
  const recipients = await recipientsForGigs(gigs);
  const plan = planRows(e, parseExtraFields(e.agency.settings?.planExtraFields));
  const where = e.venue ? [e.venue.name, e.venue.address, e.venue.city].filter(Boolean).join(", ") : e.venueText;
  let sent = 0;
  for (const b of gigs) {
    const others = gigs.filter((o) => o.id !== b.id).map((o) => `${o.artist.name} ${localTime(o.setStart, o.timezone)}`);
    for (const r of recipients.get(b.id) ?? []) {
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
  // What the acts now have, so a later change sends only what's new (runPlanUpdates).
  await prisma.event.update({ where: { id: e.id }, data: { planToldActs: plan, planChangedAt: null } });
  return sent;
}

/** How long a plan has to stay still before the acts hear about the change, so a couple's run of edits sends one email. */
export const PLAN_QUIET_MS = 15 * 60_000;

/**
 * Tell each confirmed act on a wedding or event what's changed in its plan, once the edits have stopped for a
 * while: one email listing the new values (and anything removed). Runs with the other event emails.
 */
export async function runPlanUpdates(now = new Date()) {
  const due = await prisma.event.findMany({
    where: {
      status: "ACTIVE",
      demo: false,
      autoEmails: true,
      planChangedAt: { lte: new Date(now.getTime() - PLAN_QUIET_MS) },
      date: { gte: localDateKey(new Date(now.getTime() - 86_400_000), "UTC") },
      agency: { status: "ACTIVE" },
    },
    include: eventInclude,
  });
  let sent = 0;
  for (const e of due) {
    // Claimed by clearing the mark, so two servers never send it twice.
    const claimed = await prisma.event.updateMany({ where: { id: e.id, planChangedAt: e.planChangedAt }, data: { planChangedAt: null } });
    if (!claimed.count) continue;
    const plan = planRows(e, parseExtraFields(e.agency.settings?.planExtraFields));
    const changes = planChanges(plan, e.planToldActs);
    const gigs = withAct(e).filter((b) => b.status === "CONFIRMED");
    const t = tpl(e, "EVENT_UPDATED", "");
    if (changes.length && gigs.length && t.on) {
      const recipients = await recipientsForGigs(gigs);
      const told = new Set<string>();
      for (const b of gigs) {
        for (const r of recipients.get(b.id) ?? []) {
          if (told.has(r.key)) continue;
          told.add(r.key);
          const w = tpl(e, "EVENT_UPDATED", r.firstName);
          const title = `${e.name}: details updated`;
          const base = { kind: "EVENT" as const, agencyId: e.agencyId, bookingId: b.id };
          if (r.userId) await sendPush({ ...base, userId: r.userId, payload: { title, body: changes.map(([k]) => k).join(", "), url: `/app/gigs/${b.id}` } });
          for (const to of r.emails) {
            await sendEmail({
              ...base,
              to,
              replyTo: replyOf(e),
              subject: w.subject ?? title,
              email: {
                brand: brandOf(e),
                title: "Some details have changed",
                intro: w.intro ?? `Hi ${r.firstName}, some details for ${e.name} (${eventDay(e)}) have changed. Here's what's new:`,
                rows: changes,
                rowsTitle: "What's changed",
                cta: r.userId ? { label: "See the full details", url: `${appUrl()}/app/gigs/${b.id}` } : undefined,
                outro: "Anything unclear? Reply to this email.",
              },
            });
          }
          sent++;
        }
      }
    }
    await prisma.event.update({ where: { id: e.id }, data: { planToldActs: plan } });
  }
  return sent;
}

async function sendThanks(e: FullEvent) {
  if (!e.customer?.email) return false;
  const review = e.agency.settings?.reviewLink?.trim();
  const first = firstOf(e.customer.name);
  const t = tpl(e, "THANKS", first);
  const acts = [...new Set(actsOf(e).map((b) => b.artist.name))];
  await sendEmail({
    kind: "EVENT",
    agencyId: e.agencyId,
    to: e.customer.email,
    replyTo: replyOf(e),
    subject: t.subject ?? (isWedding(e) ? "Congratulations, and thank you!" : "Thank you!"),
    email: {
      brand: brandOf(e),
      title: isWedding(e) ? "Congratulations!" : "Thank you",
      intro: t.intro ?? `Hi ${first}, thank you for booking ${acts.length ? `${acts.join(", ")} ` : ""}with us. We hope it was a brilliant day.`,
      cta: review ? { label: "Leave us a review", url: review } : undefined,
      outro: review ? "If you have a minute, a review really helps other couples find us." : "We'd love to hear how it went: just reply to this email.",
    },
  });
  return true;
}

/** A week before: short and warm. Anything still owed to the business, or cash for the acts, gets one gentle line. */
async function sendWeekToGo(e: FullEvent) {
  if (!e.customer?.email) return false;
  const first = firstOf(e.customer.name);
  const w = tpl(e, "WEEK_TO_GO", first);
  const owed = owedToUs(e);
  const actsLeft = isDirectPlan(e.payPlan) ? directTotals(live(e)).actLeft : 0;
  const outro =
    owed > 0
      ? cashBalance(e)
        ? `One small thing: there's ${moneyOf(e)(owed)} still to pay us. ${cashHow(e.agency.settings?.cashAddress)}.`
        : `One small thing: there's ${moneyOf(e)(owed)} still to pay us. Reply to this email if you'd like our bank details again.`
      : actsLeft > 0
        ? e.payPlan === "DEPOSIT_CASH"
          ? "Just remember the cash for the acts on the day: your page has the details."
          : "If you haven't paid the acts yet, their bank details are on your page."
        : "Anything at all, just reply to this email.";
  await sendEmail({
    kind: "EVENT",
    agencyId: e.agencyId,
    to: e.customer.email,
    replyTo: replyOf(e),
    subject: w.subject ?? `${e.name}: one week to go!`,
    email: {
      brand: brandOf(e),
      title: "We can't wait!",
      intro: w.intro ?? `Hi ${first}, we can't wait! There's nothing for you to worry about, we're all ready to go 👌`,
      rows: [["Date", eventDay(e)], ...actTimes(e)],
      cta: actsLeft > 0 && e.plannerToken ? { label: "See your page", url: plannerUrl(e.plannerToken) } : undefined,
      outro,
    },
  });
  return true;
}

/** Who at the business hears about a wedding: its lead agent (the wedding coordinator), or else the business email. */
async function teamContact(e: FullEvent) {
  const agent = e.agentId ? await prisma.user.findFirst({ where: { id: e.agentId, agencyId: e.agencyId }, select: { email: true, name: true } }) : null;
  if (agent?.email) return { to: agent.email, first: firstOf(agent.name) };
  const to = e.agency.settings?.agencyEmail?.trim();
  return to ? { to, first: "" } : null;
}

type TeamStep = "TEAM_SIX_MONTHS" | "TEAM_THREE_MONTHS" | "TEAM_PLANNER_LATE";

/**
 * The coordinator's notices: 6 months out (get in touch with the couple), 3 months out (what's missing,
 * or all in hand) and 4 weeks out (the running order is still missing). Staff see the money in full.
 */
async function sendTeamNotice(e: FullEvent, kind: TeamStep) {
  const who = await teamContact(e);
  if (!who) return false;
  const away = timeToGo(daysBetween(todayOf(e), e.date));
  const name = e.customer?.name || theCustomer(e);
  const w = tpl(e, kind, who.first, { customer: name });
  const hi = who.first ? `Hi ${who.first}` : "Hi";
  const sent = await sentEventMessages(e.id);
  const m = moneyOf(e);
  const owed = owedToUs(e);
  const direct = isDirectPlan(e.payPlan);
  const total = eventTotals(e.bookings).total;
  const acts = [...new Set(actsOf(e).map((b) => b.artist.name))];
  const planner = e.plannerDoneAt
    ? "Filled in"
    : !e.customer?.email
      ? "Not filled in, and there's no email address to send the link to"
      : e.plannerSentAt
        ? `Not filled in yet (link sent ${formatDate(e.plannerSentAt, e.timezone)})`
        : "Not filled in yet";
  const money =
    total <= 0
      ? "No prices yet"
      : owed > 0
        ? `${m(owed)} ${direct ? "deposit " : ""}still to pay${sent.has("BALANCE_REMINDER") ? " (we've sent a reminder)" : ""}`
        : direct
          ? "Deposit paid. The acts are paid direct."
          : "All paid";
  const rows: [string, string][] = [
    ["Customer", [e.customer?.name, e.customer?.email, e.customer?.phone].filter(Boolean).join("\n") || "Not set"],
    ["Date", `${eventDay(e)} (${away} to go)`],
    ["Running order", planner],
    ["Money", money],
    ["Acts", acts.join(", ") || "None yet"],
  ];
  let subject: string;
  let title: string;
  let intro: string;
  if (kind === "TEAM_SIX_MONTHS") {
    subject = `${e.name}: ${away} to go`;
    title = `${away[0].toUpperCase()}${away.slice(1)} to go`;
    const asked = e.plannerDoneAt
      ? "They've already filled in their running order."
      : e.plannerSentAt
        ? `We've asked ${name} for their running order.`
        : `We haven't been able to ask ${name} for their running order yet.`;
    intro = `${hi}, ${e.name} is ${away} away. ${asked} Please get in touch with them to say hello and see how their plans are going.`;
  } else if (kind === "TEAM_THREE_MONTHS") {
    const missing = [...(e.plannerDoneAt ? [] : ["the running order"]), ...(owed > 0 ? [direct ? "the deposit" : "the balance"] : [])];
    const reminded = ["BALANCE_REMINDER", "PLANNER_CHASE"].some((k) => sent.has(k));
    subject = `${e.name}: ${away} to go, ${missing.length ? "a few things missing" : "all in hand"}`;
    title = missing.length ? "A few things still to sort" : "All in hand";
    const due = balanceDueDate(e.date);
    intro = missing.length
      ? `${hi}, ${e.name} is ${away} away${owed > 0 ? ` and the ${direct ? "deposit" : "balance"} is due ${due > todayOf(e) ? `by ${dayText(due)}` : "now"}` : ""}. Still missing: ${missing.join(" and ")}.${reminded ? ` We've sent ${name} a reminder.` : ""}${
          e.plannerDoneAt
            ? ""
            : " Nothing has gone to the acts yet: if the running order doesn't come in, you can send them what you have from the wedding page."
        }`
      : `${hi}, ${e.name} is ${away} away and everything's in hand: the running order is in and ${direct ? "the deposit is paid" : "it's all paid"}.`;
  } else {
    subject = `${e.name}: running order still missing`;
    title = "Running order still missing";
    intro = `${hi}, ${e.name} is ${away} away and ${name} still haven't filled in their running order. It's due 4 weeks before the day${
      sent.has("PLANNER_FINAL") ? ", and we've sent them a last reminder" : ""
    }. Please give them a call.`;
  }
  await sendEmail({
    kind: "EVENT",
    agencyId: e.agencyId,
    to: who.to,
    subject: w.subject ?? subject,
    email: {
      brand: brandOf(e),
      title,
      intro: w.intro ?? intro,
      rows,
      cta: { label: isWedding(e) ? "Open the wedding" : "Open the event", url: `${appUrl()}/events/${e.id}` },
    },
  });
  return true;
}

/** How a step went: how many people it went to, and if none, why not (shown by the Send now buttons). */
export type StepResult = { sent: number; why?: string };

/** Send one step of the journey now, whatever the date. The automatic run and the Send now buttons both use it. */
export async function sendEventStep(e: FullEvent, kind: EventMessage): Promise<StepResult> {
  const one = (ok: boolean, why: string): StepResult => (ok ? { sent: 1 } : { sent: 0, why });
  const noEmail = `Add ${theCustomer(e)}'s email address first`;
  switch (kind) {
    case "PLANNER_REQUEST":
      return one(await sendPlannerEmail(e, "request", { money: true }), noEmail);
    case "PLANNER_CHASE":
      return one(await sendPlannerEmail(e, "nudge"), noEmail);
    case "PLANNER_FINAL":
      return one(await sendPlannerEmail(e, "final"), noEmail);
    case "BALANCE_REMINDER":
      return one(await sendBalanceReminder(e), e.customer?.email ? "Nothing is left to pay you" : noEmail);
    case "WEEK_TO_GO":
      return one(await sendWeekToGo(e), noEmail);
    case "THANKS":
      return one(await sendThanks(e), noEmail);
    case "ACT_DETAILS": {
      const n = await sendActDetails(e);
      return n ? { sent: n } : { sent: 0, why: noActsWhy(e) };
    }
    default:
      return one(await sendTeamNotice(e, kind), "No one to tell: choose a lead agent, or add your business email in Settings");
  }
}

const audienceOf = (kind: EventMessage) => EVENT_STEPS.find((s) => s.kind === kind)!.to;
const ABOUT_PLANNER: EventMessage[] = ["PLANNER_REQUEST", "PLANNER_CHASE", "PLANNER_FINAL", "TEAM_PLANNER_LATE"];

/**
 * Send whichever automatic event emails are due. Safe to run as often as you like.
 *
 * It runs every minute, so it looks first at just the dates (Event.date is indexed) and a few cheap
 * columns, and loads in full only the events with an email due that hasn't gone. Only the journey
 * stage live today can send (eventMessagesDue: a late booking never gets the earlier stages in a rush),
 * and nothing goes to the customer or about them (nor, for a wedding, to the acts) until the booking is
 * secured (journeySecured): for a wedding, until it has passed the gate in src/lib/secure-event.ts.
 */
export async function runEventMessages(now = new Date()) {
  const DAY = 86_400_000;
  const where = {
    status: "ACTIVE",
    autoEmails: true,
    demo: false,
    agency: { status: "ACTIVE", settings: { eventEmails: true } },
    date: {
      gte: localDateKey(new Date(now.getTime() - 8 * DAY), "UTC"),
      lte: localDateKey(new Date(now.getTime() + JOURNEY_LOOKAHEAD_DAYS * DAY), "UTC"),
    },
  } satisfies Prisma.EventWhereInput;
  const rows = (
    await prisma.event.findMany({
      where,
      select: {
        id: true,
        agencyId: true,
        date: true,
        timezone: true,
        plannerDoneAt: true,
        createdAt: true,
        type: true,
        customer: { select: { email: true } },
        // Which statuses its gigs have (journeySecured), a row per status at most.
        bookings: { where: { archivedAt: null, status: { in: [...SECURED_STATUSES, "HOLD"] } }, select: { status: true }, distinct: ["status"] },
      },
    })
  ).filter((e) => {
    // Office hours only: nothing before 9am or after 8pm, the event's local time.
    const hour = localTime(now, e.timezone);
    return hour >= "09:00" && hour < "20:00";
  });
  if (!rows.length) return runPlanUpdates(now);
  // When each wedding passed the gate, if it has: one query.
  const gates = await securedAtFor(rows.filter((e) => e.type === "WEDDING").map((e) => e.id));
  // Emails a business has switched off in Settings > Notifications don't go: one look per business.
  const templates = new Map(
    (
      await prisma.settings.findMany({
        where: { agencyId: { in: [...new Set(rows.map((e) => e.agencyId))] } },
        select: { agencyId: true, messageTemplates: true },
      })
    ).map((s) => [s.agencyId, s.messageTemplates]),
  );
  const dueNow = (e: (typeof rows)[number]) => {
    const facts = { ...e, gateAt: gates.get(e.id) ?? null };
    return eventMessagesDue(daysBetween(localDateKey(now, e.timezone), e.date)).filter((kind) => {
      if (!messageFor(templates.get(e.agencyId), TEMPLATE_OF[kind], {}).on) return false;
      if (!journeySecured(facts, kind)) return false;
      if (kind === "ACT_DETAILS") return true;
      if (missedAtLaunch(facts, kind)) return false;
      if (ABOUT_PLANNER.includes(kind) && e.plannerDoneAt) return false;
      return audienceOf(kind) === "TEAM" || !!e.customer?.email;
    });
  };
  const due = new Map(rows.map((e) => [e.id, dueNow(e)]));
  const candidates = rows.filter((e) => due.get(e.id)!.length);
  const claimed = await claimedReminders(
    [...new Set(candidates.flatMap((e) => due.get(e.id)!))].map((k) => `EV_${k}`),
    candidates.map((e) => `event:${e.id}`),
    ["", CHECKED],
  );
  const isDone = (kind: EventMessage, eventId: string) => claimed.has(`EV_${kind}|event:${eventId}|`) || claimed.has(`EV_${kind}|event:${eventId}|${CHECKED}`);
  const ids = candidates.filter((e) => due.get(e.id)!.some((kind) => !isDone(kind, e.id))).map((e) => e.id);
  if (!ids.length) return runPlanUpdates(now);
  const events = await prisma.event.findMany({ where: { ...where, id: { in: ids } }, include: eventInclude });
  let sent = 0;
  for (const e of events) {
    for (const kind of due.get(e.id) ?? []) {
      if (isDone(kind, e.id)) continue;
      if (kind === "ACT_DETAILS" && !withAct(e).length) continue;
      if (!(await claim(kind, e.id))) continue;
      const r = await sendEventStep(e, kind);
      if (r.sent) {
        sent++;
        continue;
      }
      // Nothing to send (e.g. nothing owed when the balance fell due): marked as looked at, not sent,
      // so the wedding page says so and this doesn't load the event again every minute.
      await prisma.reminder.deleteMany({ where: { kind: `EV_${kind}`, recipient: `event:${e.id}`, key: "" } });
      await claimReminder(`EV_${kind}`, `event:${e.id}`, CHECKED);
    }
  }
  return sent + (await runPlanUpdates(now));
}

/** When each of these weddings passed the gate (its GATE_KIND row), by event id. Those that haven't are missing. */
export async function securedAtFor(eventIds: string[]) {
  if (!eventIds.length) return new Map<string, Date>();
  const rows = await prisma.reminder.findMany({
    where: { kind: GATE_KIND, recipient: { in: eventIds.map((id) => `event:${id}`) }, key: "" },
    select: { recipient: true, createdAt: true },
  });
  return new Map(rows.map((r) => [r.recipient.replace(/^event:/, ""), r.createdAt]));
}

/**
 * Mark an automatic email as sent by hand ("Send now"), before it goes, so an automatic run at the same
 * moment can't send it too. False if it was already marked (sent before, or being sent right now).
 */
export async function markEventMessageSent(eventId: string, kind: EventMessage) {
  return claim(kind, eventId);
}

/** Take the mark off again: a Send now that turned out to have nothing to send. */
export async function unmarkEventMessageSent(eventId: string, kind: EventMessage) {
  await prisma.reminder.deleteMany({ where: { kind: `EV_${kind}`, recipient: `event:${eventId}`, key: "" } });
}
