"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff, requireUser, type AgencyUser } from "@/lib/auth";
import { checkAwayRange, formatRange, isAnswer, type ReplyAnswer } from "@/lib/availability";
import { answerAvailability, newReplyToken, requestToday, sendAvailability } from "@/lib/availability-requests";
import { createBookingWithReference } from "@/lib/bookings";
import { EVENT_TYPES, LIVE_STATUSES } from "@/lib/constants";
import { getSettings, logActivity, prisma } from "@/lib/db";
import { FormError, handleForm, oneOf, optStr, str, type FormState } from "@/lib/forms";
import { defaultBookingFee, toMinor } from "@/lib/money";
import { actIdsFor, ownActIds } from "@/lib/people";
import { isDateKey } from "@/lib/rota";
import { buildSchedule } from "@/lib/schedule";
import { addDaysToKey, localDateKey, zonedToUtc } from "@/lib/time";

// Act availability: blocking out dates an act can't play (by the agency, or by the act in their
// app), and "Are you free?" requests that acts answer from a private link or their app.

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The act's live gigs on any of these days, e.g. "GS-0042", so a new block can mention them. */
async function gigsBetween(agencyId: string, artistId: string, startDate: string, endDate: string, tz: string) {
  const gigs = await prisma.booking.findMany({
    where: {
      agencyId,
      artistId,
      status: { in: LIVE_STATUSES },
      arriveBy: { gte: zonedToUtc(addDaysToKey(startDate, -1), "00:00", tz), lt: zonedToUtc(addDaysToKey(endDate, 2), "00:00", tz) },
    },
    select: { reference: true, arriveBy: true, timezone: true },
  });
  return gigs.filter((g) => {
    const day = localDateKey(g.arriveBy, g.timezone);
    return day >= startDate && day <= endDate;
  });
}

async function readAway(form: FormData, tz: string) {
  const range = checkAwayRange(str(form, "startDate"), str(form, "endDate"), localDateKey(new Date(), tz));
  if ("error" in range) throw new FormError(range.error);
  return { ...range, note: str(form, "note").slice(0, 200) };
}

/** Acts that already have exactly these dates blocked out, so saving twice doesn't list them twice. */
async function alreadyBlocked(artistIds: string[], away: { startDate: string; endDate: string }) {
  const rows = await prisma.artistUnavailability.findMany({
    where: { artistId: { in: artistIds }, startDate: away.startDate, endDate: away.endDate },
    select: { artistId: true },
  });
  return rows.map((r) => r.artistId);
}

/** Staff: block out dates on an act's page. */
export async function addAway(artistId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const act = await prisma.artist.findFirst({ where: { id: artistId, agencyId: user.agencyId }, select: { id: true, name: true } });
    if (!act) throw new FormError("Act not found");
    const settings = await getSettings(user.agencyId);
    const away = await readAway(form, settings.defaultTimezone);
    if (!(await alreadyBlocked([act.id], away)).length)
      await prisma.artistUnavailability.create({ data: { ...away, agencyId: user.agencyId, artistId: act.id, source: "AGENCY", createdById: user.id } });
    await logActivity(user, "ARTIST", act.id, "blocked out dates", formatRange(away.startDate, away.endDate));
    revalidatePath("/", "layout");
    const gigs = await gigsBetween(user.agencyId, act.id, away.startDate, away.endDate, settings.defaultTimezone);
    return {
      ok: `Blocked out ${formatRange(away.startDate, away.endDate)}.${gigs.length ? ` They already have ${gigs.length === 1 ? "a booking" : `${gigs.length} bookings`} then: ${gigs.map((g) => g.reference).join(", ")}.` : ""}`,
    };
  });
}

export async function removeAway(id: string) {
  const user = await requireStaff();
  const row = await prisma.artistUnavailability.findFirst({ where: { id, agencyId: user.agencyId } });
  if (!row) return;
  await prisma.artistUnavailability.delete({ where: { id: row.id } });
  await logActivity(user, "ARTIST", row.artistId, "removed blocked-out dates", formatRange(row.startDate, row.endDate));
  revalidatePath("/", "layout");
}

/** Acts: block out dates from their app, for one or more of their own acts. */
export async function addOwnAway(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser(["ARTIST"]);
  return handleForm(async () => {
    const own = await ownActIds(user);
    if (!own.length) throw new FormError("Your login isn't linked to an act yet");
    const picked = form.getAll("actId").filter((v): v is string => typeof v === "string" && own.includes(v));
    const acts = own.length === 1 ? own : picked;
    if (!acts.length) throw new FormError("Tick at least one act");
    const settings = await getSettings(user.agencyId);
    const away = await readAway(form, settings.defaultTimezone);
    const done = await alreadyBlocked(acts, away);
    await prisma.artistUnavailability.createMany({
      data: acts.filter((id) => !done.includes(id)).map((artistId) => ({ ...away, agencyId: user.agencyId, artistId, source: "ACT", createdById: user.id })),
    });
    for (const artistId of acts) await logActivity(user, "ARTIST", artistId, "blocked out dates in their app", formatRange(away.startDate, away.endDate));
    revalidatePath("/app", "layout");
    return { ok: `Saved. ${settings.agencyName || "Your agency"} can see you can't play ${formatRange(away.startDate, away.endDate)}.` };
  });
}

export async function removeOwnAway(id: string) {
  const user = await requireUser(["ARTIST"]);
  const row = await prisma.artistUnavailability.findFirst({ where: { id, agencyId: user.agencyId } });
  if (!row || !(await ownActIds(user)).includes(row.artistId)) return;
  await prisma.artistUnavailability.delete({ where: { id: row.id } });
  await logActivity(user, "ARTIST", row.artistId, "removed blocked-out dates in their app", formatRange(row.startDate, row.endDate));
  revalidatePath("/app", "layout");
}

/** The acts ticked on a form that belong to this agency. */
async function pickedActs(user: AgencyUser, form: FormData) {
  const ids = [...new Set(form.getAll("actId").filter((v): v is string => typeof v === "string" && !!v))];
  if (ids.length > 150) throw new FormError("Ask up to 150 acts at a time");
  return prisma.artist.findMany({ where: { id: { in: ids }, agencyId: user.agencyId }, select: { id: true } });
}

const sentMessage = (acts: number, people: number) =>
  people
    ? `Asked ${acts} act${acts === 1 ? "" : "s"}: ${people} ${people === 1 ? "person was" : "people were"} sent the question.`
    : `Added ${acts} act${acts === 1 ? "" : "s"}. Nobody could be messaged (no email, phone or login on file), so copy their links below.`;

/** Staff: ask several acts if they're free on a date. */
export async function createAvailabilityRequest(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  let id = "";
  let people = 0;
  const result = await handleForm(async () => {
    const settings = await getSettings(user.agencyId);
    const bookingId = optStr(form, "bookingId");
    const booking = bookingId ? await prisma.booking.findFirst({ where: { id: bookingId, agencyId: user.agencyId }, select: { id: true } }) : null;
    const venueId = optStr(form, "venueId");
    const venue = venueId ? await prisma.venue.findFirst({ where: { id: venueId, agencyId: user.agencyId }, select: { id: true, timezone: true } }) : null;
    if (venueId && !venue) throw new FormError("That venue no longer exists");
    const timezone = venue?.timezone ?? settings.defaultTimezone;
    const date = str(form, "date");
    if (!isDateKey(date)) throw new FormError("Choose a date");
    if (date < localDateKey(new Date(), timezone)) throw new FormError("That date has already passed");
    const [arriveTime, startTime, endTime] = ["arriveTime", "startTime", "endTime"].map((k) => str(form, k));
    for (const t of [arriveTime, startTime, endTime]) if (t && !TIME.test(t)) throw new FormError("Enter times like 19:30");
    if (endTime && !startTime) throw new FormError("Add when they're on as well as when they finish");
    const currency = settings.defaultCurrency;
    let costMinor: number | null = null;
    if (str(form, "cost")) {
      try {
        costMinor = toMinor(str(form, "cost"), currency);
      } catch {
        throw new FormError("Enter the act's fee as a number, like 150.00");
      }
      if (costMinor < 0) throw new FormError("The fee can't be negative");
    }
    const acts = await pickedActs(user, form);
    if (!acts.length) throw new FormError("Tick at least one act to ask");
    const request = await prisma.availabilityRequest.create({
      data: {
        agencyId: user.agencyId,
        date,
        timezone,
        arriveTime,
        startTime,
        endTime,
        venueId: venue?.id ?? null,
        place: venue ? "" : str(form, "place").slice(0, 200),
        eventType: oneOf(str(form, "eventType"), EVENT_TYPES, "GIG"),
        costMinor: costMinor || null,
        currency,
        note: str(form, "note").slice(0, 1000),
        bookingId: booking?.id ?? null,
        createdById: user.id,
        replies: { create: acts.map((a) => ({ artistId: a.id, token: newReplyToken() })) },
      },
    });
    if (booking) await logActivity(user, "BOOKING", booking.id, "asked acts if they're free", `${acts.length} act${acts.length === 1 ? "" : "s"}`);
    people = await sendAvailability(request.id);
    id = request.id;
  });
  if (result?.error) return result;
  revalidatePath("/", "layout");
  // The request page says how many were asked.
  redirect(`/availability/${id}?sent=${people}`);
}

async function ownRequest(user: AgencyUser, requestId: string) {
  const r = await prisma.availabilityRequest.findFirst({
    where: { id: requestId, agencyId: user.agencyId },
    include: { replies: { select: { artistId: true } } },
  });
  if (!r) throw new FormError("Request not found");
  return r;
}

/** Staff: add more acts to a request and ask them. */
export async function askMoreActs(requestId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const r = await ownRequest(user, requestId);
    if (r.closedAt || r.date < requestToday(r)) throw new FormError("This request is closed");
    const already = new Set(r.replies.map((x) => x.artistId));
    const acts = (await pickedActs(user, form)).filter((a) => !already.has(a.id));
    if (!acts.length) throw new FormError("Tick at least one act who hasn't been asked yet");
    const created = await prisma.$transaction(
      acts.map((a) => prisma.availabilityReply.create({ data: { requestId: r.id, artistId: a.id, token: newReplyToken() } })),
    );
    const people = await sendAvailability(
      r.id,
      created.map((c) => c.id),
    );
    revalidatePath(`/availability/${r.id}`);
    return { ok: sentMessage(acts.length, people) };
  });
}

/** Staff: ask again everyone who hasn't answered. */
export async function remindAvailability(requestId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  return handleForm(async () => {
    const r = await ownRequest(user, requestId);
    if (r.closedAt || r.date < requestToday(r)) throw new FormError("This request is closed");
    const people = await sendAvailability(r.id);
    revalidatePath(`/availability/${r.id}`);
    return { ok: people ? `Asked again: ${people} ${people === 1 ? "person" : "people"}.` : "Nobody is waiting to answer, or they can't be messaged." };
  });
}

/** Staff: stop (or start again) taking answers. */
export async function setRequestClosed(requestId: string, closed: boolean) {
  const user = await requireStaff();
  const r = await prisma.availabilityRequest.findFirst({ where: { id: requestId, agencyId: user.agencyId }, select: { id: true } });
  if (!r) return;
  await prisma.availabilityRequest.update({ where: { id: r.id }, data: { closedAt: closed ? new Date() : null } });
  revalidatePath("/availability", "layout");
}

/**
 * Staff: turn a "Yes" into a booking. If the request was made for a gig that still needs an
 * act, the act is put on that gig; otherwise a new Pending booking is made with the request's
 * date, times, place and the act's fee. Either way it opens the booking.
 */
export async function bookFromReply(replyId: string, _: FormState): Promise<FormState> {
  const user = await requireStaff();
  let id = "";
  const result = await handleForm(async () => {
    const reply = await prisma.availabilityReply.findFirst({
      where: { id: replyId, request: { agencyId: user.agencyId } },
      include: { request: { include: { venue: { select: { id: true, name: true } } } }, artist: true },
    });
    if (!reply) throw new FormError("Answer not found");
    if (reply.answer !== "YES") throw new FormError(`${reply.artist.name} hasn't said they're free`);
    const req = reply.request;
    // Already booked from this answer: just open it.
    if (reply.bookingId && (await prisma.booking.findFirst({ where: { id: reply.bookingId, agencyId: user.agencyId }, select: { id: true } }))) {
      id = reply.bookingId;
      return;
    }
    const gig = req.bookingId ? await prisma.booking.findFirst({ where: { id: req.bookingId, agencyId: user.agencyId } }) : null;
    if (gig && !gig.artistId && gig.status !== "CANCELLED") {
      await prisma.booking.update({
        where: { id: gig.id },
        data: {
          artistId: reply.artistId,
          agentId: gig.agentId ?? reply.artist.agentId ?? user.id,
          // The fee the act was asked at, unless the gig already has one.
          ...(req.costMinor != null && gig.artistFeeMinor == null ? { dealType: "BUY_SELL", artistFeeMinor: req.costMinor } : {}),
        },
      });
      await logActivity(user, "BOOKING", gig.id, "act added from Who's free", reply.artist.name);
      id = gig.id;
    } else {
      if (!req.startTime) throw new FormError("This request has no times. Use Full form to book them with times.");
      const settings = await getSettings(user.agencyId);
      const booking = await createBookingWithReference(user.agencyId, {
        ...buildSchedule(req.date, { arrive: req.arriveTime || req.startTime, setStart: req.startTime, setEnd: req.endTime || null }, req.timezone),
        artistId: reply.artistId,
        venueId: req.venue?.id ?? null,
        agentId: reply.artist.agentId ?? user.id,
        createdById: user.id,
        status: "PENDING",
        eventType: req.eventType,
        eventName: req.venue ? "" : req.place,
        timezone: req.timezone,
        currency: req.currency,
        ...(req.costMinor != null ? { dealType: "BUY_SELL", artistFeeMinor: req.costMinor } : {}),
        commissionPct: reply.artist.defaultCommission ?? settings.defaultCommission,
        bookingFeeMinor: defaultBookingFee(settings, { eventType: req.eventType }),
        notes: req.note,
      });
      await logActivity(user, "BOOKING", booking.id, "added from Who's free", `${reply.artist.name} said they're free`);
      id = booking.id;
    }
    await prisma.availabilityReply.update({ where: { id: reply.id }, data: { bookingId: id } });
  });
  if (result?.error) return result;
  revalidatePath("/", "layout");
  redirect(`/bookings/${id}`);
}

export type AnswerResult = { ok: boolean; message: string };

const answered = (answer: ReplyAnswer): AnswerResult => ({
  ok: true,
  message:
    answer === "YES"
      ? "Thanks, we've told them you're free. It isn't a booking yet: you'll hear if they book you."
      : "Thanks, we've told them you're not free.",
});

/** From the private link in the message (no login). The token is the only key. */
export async function answerAvailabilityByToken(token: string, answer: string, note: string): Promise<AnswerResult> {
  if (!token || token.length < 20 || !isAnswer(answer)) return { ok: false, message: "This link isn't valid." };
  const reply = await prisma.availabilityReply.findUnique({ where: { token }, select: { id: true } });
  if (!reply) return { ok: false, message: "This link isn't valid." };
  if (!(await answerAvailability(reply.id, answer, note))) return { ok: false, message: "This question has closed, so answers can't be changed now." };
  revalidatePath(`/f/${token}`);
  return answered(answer);
}

/** From the act app: only for acts this login can see. */
export async function answerAvailabilityInApp(replyId: string, answer: string, note: string): Promise<AnswerResult> {
  const user = await requireUser(["ARTIST"]);
  if (!isAnswer(answer)) return { ok: false, message: "Choose Yes or No." };
  const reply = await prisma.availabilityReply.findFirst({
    where: { id: replyId, request: { agencyId: user.agencyId } },
    select: { id: true, artistId: true },
  });
  if (!reply || !(await actIdsFor(user)).includes(reply.artistId)) return { ok: false, message: "This question isn't for you." };
  if (!(await answerAvailability(reply.id, answer, note))) return { ok: false, message: "This question has closed, so answers can't be changed now." };
  revalidatePath("/app");
  return answered(answer);
}
