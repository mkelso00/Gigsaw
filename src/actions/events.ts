"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff, type AgencyUser } from "@/lib/auth";
import { createBookingWithReference } from "@/lib/bookings";
import { findClashes } from "@/lib/clash-check";
import { BOOKING_STATUSES, LIVE_STATUSES, type BookingStatus } from "@/lib/constants";
import { getSettings, logActivity, prisma } from "@/lib/db";
import { defaultTasks, PLAN_FIELDS } from "@/lib/event-plan";
import { eventInclude, markEventMessageSent, sendActDetails, sendPlannerEmail } from "@/lib/events";
import { FormError, confirmed, handleForm, int, oneOf, optStr, required, str, type FormState } from "@/lib/forms";
import { sendEmail } from "@/lib/messaging";
import { dealBreakdown, paymentTotals, toMinor } from "@/lib/money";
import { notifyArtistsOfNewGigs } from "@/lib/notify";
import { isDateKey } from "@/lib/rota";
import { buildSchedule } from "@/lib/schedule";
import { formatDate } from "@/lib/time";

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
        agentId: user.id,
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
    const basics = await eventBasics(user, form);
    await prisma.event.update({
      where: { id: eventId },
      data: { ...basics, notes: str(form, "notes"), autoEmails: str(form, "autoEmails") === "on" },
    });
    // Keep the acts' gigs on the event's venue and customer.
    await prisma.booking.updateMany({
      where: { eventId, agencyId: user.agencyId },
      data: { venueId: basics.venueId, promoterId: basics.customerId, eventName: basics.name },
    });
    await logActivity(user, "EVENT", eventId, "updated");
    revalidatePath("/", "layout");
    return { ok: before.date !== basics.date ? "Saved. The date changed: move each act's gig on its booking too." : "Saved." };
  });
}

/** The plan the acts see (running order, contact on the day, parking…). Used by the agency. */
export async function updateEventPlan(eventId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    await ownEvent(user, eventId);
    const data = Object.fromEntries(PLAN_FIELDS.map(([k]) => [k, str(form, k)]));
    await prisma.event.update({ where: { id: eventId }, data: { ...data, guestCount: int(form, "guestCount") } });
    await logActivity(user, "EVENT", eventId, "updated the plan");
    revalidatePath(`/events/${eventId}`);
    return { ok: "Plan saved. The acts see it on their gig page." };
  });
}

/** Add an act to the event: a booking with its own times, sale and cost. */
export async function addEventAct(eventId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const e = await ownEvent(user, eventId);
    const artistId = required(form, "artistId", "Act");
    const artist = await prisma.artist.findFirst({ where: { id: artistId, agencyId: user.agencyId } });
    if (!artist) throw new FormError("Choose an act");
    const start = str(form, "startTime");
    const end = str(form, "endTime");
    if (!TIME.test(start)) throw new FormError("Enter when they're on, like 19:30");
    const arrive = TIME.test(str(form, "arriveTime")) ? str(form, "arriveTime") : start;
    const settings = await getSettings(user.agencyId);
    const currency = settings.defaultCurrency;
    const sale = money(form, "sale", currency, "sale") ?? 0;
    const cost = money(form, "cost", currency, "cost");
    const status = oneOf(str(form, "status"), BOOKING_STATUSES, "CONFIRMED") as BookingStatus;
    const schedule = buildSchedule(e.date, { arrive, setStart: start, setEnd: TIME.test(end) ? end : null }, e.timezone);
    if (!confirmed(form) && LIVE_STATUSES.includes(status)) {
      const warnings = await findClashes(
        { agencyId: user.agencyId, artistId, venueId: e.venueId, timezone: e.timezone, ...schedule },
        settings.changeoverMinutes,
      );
      if (warnings.length) return { confirm: { title: "Hold on: this act may not be free", items: warnings.map((w) => w.text), button: "Add anyway" } };
    }
    const b = await createBookingWithReference(user.agencyId, {
      ...schedule,
      eventId,
      artistId,
      venueId: e.venueId,
      promoterId: e.customerId,
      agentId: artist.agentId ?? user.id,
      createdById: user.id,
      status,
      eventType: e.type,
      eventName: e.name,
      timezone: e.timezone,
      currency,
      feeMinor: sale,
      vatPct: Number(str(form, "vatPct")) || 0,
      ...(cost != null ? { dealType: "BUY_SELL", artistFeeMinor: cost } : {}),
      commissionPct: artist.defaultCommission ?? settings.defaultCommission,
      dayContact: e.dayContact,
      demo: e.demo || artist.demo,
      notifyClientOnArrival: false,
    });
    await logActivity(user, "BOOKING", b.id, "added to event", e.name);
    if (str(form, "notify") === "on") await notifyArtistsOfNewGigs([b.id]);
    revalidatePath("/", "layout");
    return { ok: `${artist.name} added (${b.reference}).` };
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
    for (const [i, b] of bookings.entries()) {
      const owed = Math.max(0, dealBreakdown(b).totalDueMinor - paymentTotals(b.payments).receivedMinor);
      // Anything over what's owed goes on the last gig.
      const part = i === bookings.length - 1 ? left : Math.min(left, owed);
      if (part <= 0) continue;
      await prisma.payment.create({ data: { bookingId: b.id, direction: "IN", kind, amountMinor: part, paidAt, note: note || "Payment for the whole event" } });
      left -= part;
      if (left <= 0) break;
    }
    await logActivity(user, "EVENT", eventId, "recorded a payment", (total / 100).toFixed(2));
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

/** Send each act their final details now (instead of waiting for a week before). */
export async function sendActDetailsNow(eventId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    await ownEvent(user, eventId);
    const e = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: eventInclude });
    const n = await sendActDetails(e);
    if (!n) throw new FormError("No acts to send to yet");
    await markEventMessageSent(eventId, "ACT_DETAILS");
    await logActivity(user, "EVENT", eventId, "sent final details to the acts");
    revalidatePath(`/events/${eventId}`);
    return { ok: `Final details sent (${n} ${n === 1 ? "person" : "people"}).` };
  });
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
    const data = Object.fromEntries(PLAN_FIELDS.map(([k]) => [k, str(form, k).slice(0, 5000)]));
    const guests = int(form, "guestCount");
    const first = !e.plannerDoneAt;
    await prisma.event.update({
      where: { id: e.id },
      data: { ...data, guestCount: guests && guests > 0 && guests < 100_000 ? guests : null, plannerDoneAt: new Date() },
    });
    await prisma.activity.create({
      data: { agencyId: e.agencyId, entity: "EVENT", entityId: e.id, action: first ? "customer filled in the planner" : "customer updated the planner" },
    });
    // Let the agency know.
    const agent = e.agentId ? await prisma.user.findUnique({ where: { id: e.agentId }, select: { email: true } }) : null;
    const to = agent?.email || e.agency.settings?.agencyEmail;
    if (to) {
      await sendEmail({
        kind: "EVENT",
        agencyId: e.agencyId,
        to,
        subject: `${e.name}: ${first ? "details received" : "details updated"}`,
        email: {
          brand: e.agency.settings?.agencyName || e.agency.name,
          title: `${e.customer?.name ?? "The customer"} has ${first ? "filled in" : "updated"} their details`,
          intro: `${e.name}, ${formatDate(new Date(`${e.date}T12:00:00Z`), "UTC")}.`,
          rows: PLAN_FIELDS.filter(([k]) => data[k]).map(([k, label]) => [label, data[k]] as [string, string]),
        },
      });
    }
    return { ok: "Thank you! We've got your details. You can come back to this page to change anything." };
  });
}
