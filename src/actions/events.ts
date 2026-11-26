"use server";

import type { Prisma } from "@prisma/client";
import { receiptQuietly } from "@/lib/receipts";
import { secureEventQuietly } from "@/lib/secure-event";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireStaff, type AgencyUser } from "@/lib/auth";
import { createBookingWithReference, needsAct } from "@/lib/bookings";
import { vatOnShareFor } from "@/lib/pay-plan";
import { queueCalendarSync } from "@/lib/calendar-sync/queue";
import { findClashes } from "@/lib/clash-check";
import { logBookedAnyway, mergeHolds, signupGate } from "@/lib/book-signed-up-server";
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, LIVE_STATUSES, type BookingStatus } from "@/lib/constants";
import { sendOffers } from "@/lib/offers";
import { getSettings, logActivity, prisma } from "@/lib/db";
import { defaultTasks, EVENT_STEPS, isEventMessage, parseExtraFields, planChanges, planRows, readPlanForm } from "@/lib/event-plan";
import { eventInclude, markEventMessageSent, noActsWhy, sendActDetails, sendEventStep, sendPlannerEmail, unmarkEventMessageSent } from "@/lib/events";
import { FormError, confirmed, handleForm, int, oneOf, optStr, required, str, type FormState } from "@/lib/forms";
import { sendEmail } from "@/lib/messaging";
import { teamRecipients } from "@/lib/team-alerts";
import { dealBreakdown, defaultBookingFee, paymentTotals, toMinor } from "@/lib/money";
import { notifyArtistsOfNewGigs } from "@/lib/notify";
import { isDateKey } from "@/lib/rota";
import { buildSchedule } from "@/lib/schedule";
import { formatDate } from "@/lib/time";
import { leadAgentFor, teamMember } from "@/lib/lead-agent";

// Weddings and events: one customer booking with several acts. Every lookup includes the
// agency, so one agency can never see or change another's events.

const EVENT_KINDS = ["WEDDING", "CORPORATE", "PRIVATE_PARTY", "OTHER"] as const;
const TIME = /^\d{2}:\d{2}$/;

async function ownEvent(user: AgencyUser, eventId: string) {
  const e = await prisma.event.findFirst({ where: { id: eventId, agencyId: user.agencyId }, include: { venue: true } });
  if (!e) throw new FormError("Wedding or event not found");
  return e;
}

function money(form: FormData, key: string, currency: string, label: string) {
  const raw = str(form, key);
  if (!raw) return null;
  try {
    const v = toMinor(raw, currency);
    if (v < 0) throw new Error();
    return v;
  } catch {
    throw new FormError(`Enter the ${label} as a number, like 450.00`);
  }
}

/** The basics on the form: type, date, customer (existing or new) and venue. */
async function eventBasics(user: AgencyUser, form: FormData) {
  const date = str(form, "date");
  if (!isDateKey(date)) throw new FormError("Choose the date");
  const type = oneOf(str(form, "type"), EVENT_KINDS, "WEDDING");
  let customerId = optStr(form, "customerId");
  if (customerId && !(await prisma.contact.findFirst({ where: { id: customerId, agencyId: user.agencyId }, select: { id: true } }))) customerId = null;
  const newName = str(form, "customerName");
  if (!customerId && newName) {
    const c = await prisma.contact.create({
      data: {
        agencyId: user.agencyId,
        type: "CLIENT",
        name: newName,
        email: str(form, "customerEmail").toLowerCase(),
        phone: str(form, "customerPhone"),
        tags: type === "WEDDING" ? "wedding" : "",
      },
    });
    await logActivity(user, "CONTACT", c.id, "added private customer", newName);
    customerId = c.id;
  }
  // The lead agent chosen on the form, if it's someone on the team (blank or gone: left to the caller).
  const pickedAgent = optStr(form, "agentId");
  const agentId = pickedAgent ? ((await teamMember(user.agencyId, pickedAgent))?.id ?? null) : null;
  const venueId = optStr(form, "venueId");
  const venue = venueId ? await prisma.venue.findFirst({ where: { id: venueId, agencyId: user.agencyId } }) : null;
  const settings = await getSettings(user.agencyId);
  const customer = customerId ? await prisma.contact.findUnique({ where: { id: customerId }, select: { name: true } }) : null;
  const name = str(form, "name") || (customer ? `${customer.name}${type === "WEDDING" ? "'s wedding" : ""}` : type === "WEDDING" ? "Wedding" : "Event");
  return {
    name,
    type,
    date,
    customerId,
    venueId: venue?.id ?? null,
    venueText: venue ? "" : str(form, "venueText"),
    timezone: venue?.timezone ?? settings.defaultTimezone,
    agentId,
  };
}

export async function createEvent(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  let id = "";
  const res = await handleForm(async () => {
    const basics = await eventBasics(user, form);
    const { randomBytes } = await import("node:crypto");
    const e = await prisma.event.create({
      data: {
        ...basics,
        agencyId: user.agencyId,
        agentId: basics.agentId ?? leadAgentFor(user),
        notes: str(form, "notes"),
        plannerToken: randomBytes(18).toString("base64url"),
        tasks: { create: defaultTasks(basics.type, basics.date) },
      },
    });
    await logActivity(user, "EVENT", e.id, "created", e.name);
    id = e.id;
  });
  if (res?.error) return res;
  revalidatePath("/", "layout");
  redirect(`/events/${id}`);
}

export async function updateEvent(eventId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const before = await ownEvent(user, eventId);
    const { agentId, ...basics } = await eventBasics(user, form);
    await prisma.event.update({
      where: { id: eventId },
      data: { ...basics, ...(agentId ? { agentId } : {}), notes: str(form, "notes"), autoEmails: str(form, "autoEmails") === "on" },
    });
    // Keep the acts' gigs on the event's venue and customer, and with its new lead agent if that changed.
    await prisma.booking.updateMany({
      // Archived gigs too, so they're right if brought back.
      where: { eventId, agencyId: user.agencyId, archivedAt: undefined },
      data: { venueId: basics.venueId, promoterId: basics.customerId, eventName: basics.name, ...(agentId && agentId !== before.agentId ? { agentId } : {}) },
    });
    queueCalendarSync((await prisma.booking.findMany({ where: { eventId, agencyId: user.agencyId }, select: { id: true } })).map((b) => b.id));
    await logActivity(user, "EVENT", eventId, "updated");
    revalidatePath("/", "layout");
    return { ok: before.date !== basics.date ? "Saved. The date changed: move each act's booking on its booking too." : "Saved." };
  });
}

/** The plan is in the acts' calendar events (src/lib/act-calendar.ts), so a change to it updates their connected calendars. */
async function syncEventGigs(eventId: string, agencyId: string) {
  queueCalendarSync((await prisma.booking.findMany({ where: { eventId, agencyId }, select: { id: true } })).map((b) => b.id));
}

/** The plan the acts see (running order, contact on the day, parking…). Used by the agency. */
export async function updateEventPlan(eventId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    await ownEvent(user, eventId);
    const settings = await getSettings(user.agencyId);
    const extras = parseExtraFields(settings.planExtraFields);
    const { columns, planExtras } = readPlanForm((k) => str(form, k), extras);
    const before = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    const changed = planChanges(planRows({ ...before, ...columns, planExtras }, extras), planRows(before, extras)).length > 0;
    await prisma.event.update({
      where: { id: eventId },
      data: { ...columns, planExtras, guestCount: int(form, "guestCount"), ...(changed ? { planChangedAt: new Date() } : {}) },
    });
    await syncEventGigs(eventId, user.agencyId);
    await logActivity(user, "EVENT", eventId, "updated the plan");
    revalidatePath(`/events/${eventId}`);
    return { ok: "Plan saved. The acts see it on their booking page." };
  });
}

/** Add an act to the event: a booking with its own times, sale and cost. */
export async function addEventAct(eventId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const e = await ownEvent(user, eventId);
    const artistId = optStr(form, "artistId");
    const artist = artistId ? await prisma.artist.findFirst({ where: { id: artistId, agencyId: user.agencyId } }) : null;
    if (artistId && !artist) throw new FormError("That act no longer exists");
    const start = str(form, "startTime");
    const end = str(form, "endTime");
    if (!TIME.test(start)) throw new FormError("Enter when they're on, like 19:30");
    const arrive = TIME.test(str(form, "arriveTime")) ? str(form, "arriveTime") : start;
    const settings = await getSettings(user.agencyId);
    const currency = settings.defaultCurrency;
    const sale = money(form, "sale", currency, "sale") ?? 0;
    const cost = money(form, "cost", currency, "cost");
    const status = oneOf(str(form, "status"), BOOKING_STATUSES, "PENDING") as BookingStatus;
    if (!artist && needsAct(status, true)) throw new FormError(`Choose an act to make it ${BOOKING_STATUS_LABELS[status]}, or leave it Pending or On hold.`);
    const schedule = buildSchedule(e.date, { arrive, setStart: start, setEnd: TIME.test(end) ? end : null }, e.timezone);
    // An act who hasn't signed up to Gigsaw yet: refused, or for an admin "Book anyway" (src/lib/book-signed-up.ts).
    const gate = await signupGate(user, [artistId], confirmed(form));
    let clash: FormState | null = null;
    if (artistId && !confirmed(form) && LIVE_STATUSES.includes(status)) {
      const warnings = await findClashes(
        { agencyId: user.agencyId, artistId, venueId: e.venueId, timezone: e.timezone, ...schedule },
        settings.changeoverMinutes,
      );
      if (warnings.length) clash = { confirm: { title: "Hold on: this act may not be free", items: warnings.map((w) => w.text), button: "Add anyway" } };
    }
    const hold = mergeHolds(gate.hold, clash);
    if (hold) return hold;
    // The booking fee is charged once per event, so it goes on the first gig only.
    const eventHasFee = !!(await prisma.booking.findFirst({
      where: { eventId, status: { not: "CANCELLED" }, bookingFeeMinor: { gt: 0 } },
      select: { id: true },
    }));
    const b = await createBookingWithReference(user.agencyId, {
      ...schedule,
      eventId,
      artistId,
      venueId: e.venueId,
      promoterId: e.customerId,
      agentId: e.agentId ?? artist?.agentId ?? leadAgentFor(user),
      createdById: user.id,
      status,
      eventType: e.type,
      eventName: e.name,
      timezone: e.timezone,
      currency,
      feeMinor: sale,
      vatPct: Number(str(form, "vatPct")) || 0,
      // A wedding paying its balance in cash has no VAT on the acts' fees (src/lib/pay-plan.ts).
      vatOnShare: vatOnShareFor(e.payPlan),
      ...(cost != null ? { dealType: "BUY_SELL", artistFeeMinor: cost } : {}),
      commissionPct: artist?.defaultCommission ?? settings.defaultCommission,
      bookingFeeMinor: defaultBookingFee(settings, { eventType: e.type, eventHasFee }),
      dayContact: e.dayContact,
      demo: e.demo || !!artist?.demo,
      notifyClientOnArrival: false,
    });
    await logActivity(user, "BOOKING", b.id, "added to event", e.name);
    await logBookedAnyway(user, [b.id], gate.overridden);
    if (status === "AWAITING") await sendOffers([b.id]);
    else if (str(form, "notify") === "on") await notifyArtistsOfNewGigs([b.id]);
    revalidatePath("/", "layout");
    return {
      ok: artist
        ? `${artist.name} added (${b.reference})${status === "AWAITING" ? ": offer sent" : ""}.`
        : `Booking added (${b.reference}): Pending, needs an act.`,
    };
  });
}

/** Record a payment from the customer, shared across the acts' gigs (soonest first). */
export async function recordEventPayment(eventId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    await ownEvent(user, eventId);
    const bookings = await prisma.booking.findMany({
      where: { eventId, agencyId: user.agencyId, status: { not: "CANCELLED" } },
      include: { payments: true },
      orderBy: { setStart: "asc" },
    });
    if (!bookings.length) throw new FormError("Add an act first");
    let left = money(form, "amount", bookings[0].currency, "amount") ?? 0;
    if (left <= 0) throw new FormError("Enter the amount received");
    const kind = str(form, "kind") === "DEPOSIT" ? "DEPOSIT" : "BALANCE";
    const paidAt = isDateKey(str(form, "paidAt")) ? new Date(`${str(form, "paidAt")}T12:00:00Z`) : new Date();
    const note = str(form, "note");
    const total = left;
    const parts: Prisma.PaymentCreateManyInput[] = [];
    for (const [i, b] of bookings.entries()) {
      const owed = Math.max(0, dealBreakdown(b).totalDueMinor - paymentTotals(b.payments).receivedMinor);
      // Anything over what's owed goes on the last gig.
      const part = i === bookings.length - 1 ? left : Math.min(left, owed);
      if (part <= 0) continue;
      parts.push({ bookingId: b.id, direction: "IN", kind, amountMinor: part, paidAt, note: note || "Payment for the whole event" });
      left -= part;
      if (left <= 0) break;
    }
    await prisma.payment.createMany({ data: parts });
    await logActivity(user, "EVENT", eventId, "recorded a payment", (total / 100).toFixed(2));
    // The deposit that books a wedding: the couple's "you're booked" email covers the receipt (src/lib/secure-event.ts).
    const secured = await secureEventQuietly(eventId);
    if (str(form, "receipt") === "on" && !secured.told) await receiptQuietly({ eventId, amountMinor: total });
    revalidatePath("/", "layout");
    return { ok: "Payment recorded and shared across the acts." };
  });
}

export async function toggleEventTask(taskId: string) {
  const user = await requireStaff();
  const t = await prisma.eventTask.findFirst({ where: { id: taskId, event: { agencyId: user.agencyId } } });
  if (!t) return;
  await prisma.eventTask.update({ where: { id: t.id }, data: { doneAt: t.doneAt ? null : new Date() } });
  revalidatePath(`/events/${t.eventId}`);
}

export async function addEventTask(eventId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    await ownEvent(user, eventId);
    const title = required(form, "title", "Task");
    const due = str(form, "dueDate");
    await prisma.eventTask.create({ data: { eventId, title, dueDate: isDateKey(due) ? due : null, sort: 100 } });
    revalidatePath(`/events/${eventId}`);
    return { ok: "Added." };
  });
}

export async function deleteEventTask(taskId: string) {
  const user = await requireStaff();
  const t = await prisma.eventTask.findFirst({ where: { id: taskId, event: { agencyId: user.agencyId } } });
  if (!t) return;
  await prisma.eventTask.delete({ where: { id: t.id } });
  revalidatePath(`/events/${t.eventId}`);
}

/** Email the customer their planner link now. */
export async function sendPlannerNow(eventId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    await ownEvent(user, eventId);
    const e = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: eventInclude });
    if (!e.customer?.email) throw new FormError("Add the customer's email address first");
    await sendPlannerEmail(e);
    await logActivity(user, "EVENT", eventId, "sent the planner link");
    revalidatePath(`/events/${eventId}`);
    return { ok: `Planner link sent to ${e.customer.email}.` };
  });
}

/**
 * Send one step of the automatic emails now (the wedding page's "Send now"), e.g. for a last-minute booking:
 * it goes straight away, whatever the date. It's marked as sent first, so the automatic run can't send it at
 * the same moment; if there turns out to be nothing to send, the mark comes off again. "Send again" (the form's
 * `again`, on a step already sent) sends it whatever; a plain Send now that finds it has just gone doesn't.
 */
export async function sendEventStepNow(eventId: string, kind: string, _: FormState, form?: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    await ownEvent(user, eventId);
    if (!isEventMessage(kind)) throw new FormError("Unknown email");
    const e = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: eventInclude });
    const marked = await markEventMessageSent(eventId, kind);
    if (!marked && form?.get("again") !== "1") {
      revalidatePath(`/events/${eventId}`);
      return { ok: "It has just been sent." };
    }
    let r: Awaited<ReturnType<typeof sendEventStep>>;
    try {
      r = await sendEventStep(e, kind);
    } catch (err) {
      if (marked) await unmarkEventMessageSent(eventId, kind);
      throw err;
    }
    if (!r.sent) {
      if (marked) await unmarkEventMessageSent(eventId, kind);
      throw new FormError(r.why ?? "Nothing to send");
    }
    const step = EVENT_STEPS.find((s) => s.kind === kind)!;
    await logActivity(user, "EVENT", eventId, "sent an email now", step.label);
    revalidatePath(`/events/${eventId}`);
    return { ok: kind === "ACT_DETAILS" ? `Sent to the acts (${r.sent} ${r.sent === 1 ? "person" : "people"}).` : "Sent." };
  });
}

/**
 * Send the acts the plan as it stands, before the couple have filled in the planner (the 3-month prompt).
 * Their usual final details still go a week before, and later changes reach them as updates.
 */
export async function sendPlanToActsNow(eventId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    await ownEvent(user, eventId);
    const e = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: eventInclude });
    const n = await sendActDetails(e);
    if (!n) throw new FormError(noActsWhy(e));
    await logActivity(user, "EVENT", eventId, "sent the plan to the acts");
    revalidatePath(`/events/${eventId}`);
    return { ok: `Plan sent to the acts (${n} ${n === 1 ? "person" : "people"}).` };
  });
}

/**
 * Delete weddings or events for good, with everything made for them: their gigs (and those gigs' payments,
 * check-ins and line-ups), their proposals and their contracts. For test weddings and mistakes. Admins only.
 * The gigs come off the acts' calendars too. Act invoices already made stay as records, unlinked.
 */
async function deleteEventsFully(user: AgencyUser, eventIds: string[]) {
  const events = await prisma.event.findMany({ where: { id: { in: eventIds.slice(0, 200) }, agencyId: user.agencyId }, select: { id: true, name: true } });
  if (!events.length) return 0;
  const ids = events.map((e) => e.id);
  const gigs = await prisma.booking.findMany({ where: { eventId: { in: ids }, agencyId: user.agencyId, archivedAt: undefined }, select: { id: true } });
  await prisma.$transaction([
    prisma.booking.deleteMany({ where: { id: { in: gigs.map((g) => g.id) }, agencyId: user.agencyId } }),
    prisma.quote.deleteMany({ where: { eventId: { in: ids }, agencyId: user.agencyId } }),
    prisma.event.deleteMany({ where: { id: { in: ids }, agencyId: user.agencyId } }),
  ]);
  // Ids read before deleting: the calendar links are found by them.
  queueCalendarSync(gigs.map((g) => g.id));
  for (const e of events) await logActivity(user, "EVENT", e.id, "deleted with its gigs and proposals", e.name);
  return events.length;
}

/** The wedding page's "Delete for good": the wedding, its gigs and its proposals. */
export async function deleteEventFully(eventId: string) {
  const user = await requireAdmin();
  await deleteEventsFully(user, [eventId]);
  revalidatePath("/", "layout");
  redirect("/events");
}

/** Wedding bookings list: delete the ticked weddings and everything made for them. */
export async function deleteEvents(form: FormData) {
  const user = await requireAdmin();
  await deleteEventsFully(user, form.getAll("ids").map(String));
  revalidatePath("/", "layout");
}

export async function deleteEvent(eventId: string) {
  const user = await requireStaff();
  const e = await prisma.event.findFirst({ where: { id: eventId, agencyId: user.agencyId } });
  if (e) {
    // The acts' gigs stay as ordinary bookings.
    await prisma.event.delete({ where: { id: e.id } });
    await logActivity(user, "EVENT", e.id, "deleted", e.name);
  }
  redirect("/events");
}

// ---------- The customer's planner (public link, no login) ----------

/** The couple or customer fills in their plan from their private link. */
export async function submitPlanner(token: string, _: FormState, form: FormData): Promise<FormState> {
  return handleForm(async () => {
    if (!token || token.length < 20) throw new FormError("This link isn't valid");
    const e = await prisma.event.findUnique({ where: { plannerToken: token }, include: { agency: { include: { settings: true } }, customer: true } });
    if (!e || e.status !== "ACTIVE" || e.agency.status !== "ACTIVE") throw new FormError("This link isn't valid any more. Please contact us.");
    const extras = parseExtraFields(e.agency.settings?.planExtraFields);
    const { columns, planExtras } = readPlanForm((k) => str(form, k), extras);
    const guests = int(form, "guestCount");
    const first = !e.plannerDoneAt;
    // A change the acts should hear about (sent once the edits stop: runPlanUpdates).
    const changed = planChanges(planRows({ ...e, ...columns, planExtras }, extras), planRows(e, extras)).length > 0;
    await prisma.event.update({
      where: { id: e.id },
      data: {
        ...columns,
        planExtras,
        guestCount: guests && guests > 0 && guests < 100_000 ? guests : null,
        plannerDoneAt: new Date(),
        ...(changed ? { planChangedAt: new Date() } : {}),
      },
    });
    await syncEventGigs(e.id, e.agencyId);
    await prisma.activity.create({
      data: { agencyId: e.agencyId, entity: "EVENT", entityId: e.id, action: first ? "customer filled in the planner" : "customer updated the planner" },
    });
    // Let the agency know, as Settings, Notifications says (by default the lead agent, or the business email).
    const team = await teamRecipients(e.agencyId, "PLANNER", { context: "EVENTS", agent: e.agentId });
    for (const to of team.emails) {
      await sendEmail({
        kind: "EVENT",
        agencyId: e.agencyId,
        to,
        subject: `${e.name}: ${first ? "details received" : "details updated"}`,
        email: {
          brand: e.agency.settings?.agencyName || e.agency.name,
          title: `${e.customer?.name ?? "The customer"} has ${first ? "filled in" : "updated"} their details`,
          intro: `${e.name}, ${formatDate(new Date(`${e.date}T12:00:00Z`), "UTC")}.`,
          rows: planRows({ ...columns, planExtras }, extras),
        },
      });
    }
    return { ok: "Thank you! We've got your details. You can come back to this page to change anything." };
  });
}
