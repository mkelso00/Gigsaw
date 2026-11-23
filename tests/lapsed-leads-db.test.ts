import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// A lead whose proposal lapsed (expired with no reply, or declined by the customer) stops holding the
// date: its Enquiry booking, and its wedding's gigs that are still an enquiry or on hold, are cancelled with
// the reason in their activity log, the wedding is cancelled once nothing on it is left, and the lead is
// marked dealt with (src/lib/lapsed-leads.ts). Confirmed or paid gigs, replaced versions and leads that have
// been accepted since are left alone, the acts are never told, and running it again does nothing.
// Database tests: TEST_DATABASE_URL only.

type Sent = { to: string; subject: string; kind: string };
const state = vi.hoisted(() => ({ sent: [] as Sent[], sms: [] as unknown[], push: [] as unknown[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/messaging", async (orig) => {
  const real = await orig<typeof import("@/lib/messaging")>();
  return {
    ...real,
    sendEmail: async (m: Parameters<typeof real.sendEmail>[0]) => {
      state.sent.push(m as never);
      return "SENT";
    },
    sendSms: async (m: unknown) => {
      state.sms.push(m);
      return "SENT";
    },
    sendPush: async (m: unknown) => {
      state.push.push(m);
      return 0;
    },
  };
});

type Db = typeof import("@/lib/db");
const EXPIRED = "Proposal expired, no reply";
const DECLINED = "Proposal declined by the customer";
const answer = { name: "Hannah Smith", note: "We found a DJ", ip: "10.0.0.1", agent: "vitest" };

describeDb("a lapsed proposal frees its lead's date (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let n = 0;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "lapsed", { agencyName: "Lapse Test Music", agencyEmail: `team-${Date.now()}@lapsed.gigsaw.invalid` });
    agencyId = t.agency.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  const gig = async (o: { status: string; eventId?: string | null; artistId?: string | null; offered?: boolean; ref: string }) =>
    prisma.booking.create({
      data: {
        agencyId,
        reference: o.ref,
        status: o.status,
        eventId: o.eventId ?? null,
        artistId: o.artistId ?? null,
        arriveBy: new Date("2030-08-14T17:00:00Z"),
        setStart: new Date("2030-08-14T18:00:00Z"),
        setEnd: new Date("2030-08-14T22:00:00Z"),
        timezone: "Europe/London",
        feeMinor: 100_000,
        ...(o.offered && o.artistId ? { offerToken: randomBytes(16).toString("base64url"), offeredArtistId: o.artistId, offeredAt: new Date() } : {}),
      },
    });

  /** A lead as the enquiry form makes it (a booking, or for a wedding an event), with a proposal sent for it. */
  const makeLead = async (o: { wedding?: boolean; validUntil?: string } = {}) => {
    const i = ++n;
    const stamp = `${i}-${Date.now().toString(36)}`;
    const contact = await prisma.contact.create({ data: { agencyId, name: "Hannah Smith", email: `hannah-${stamp}@lapsed.gigsaw.invalid`, type: "CLIENT" } });
    const act = await prisma.artist.create({
      data: { agencyId, name: `Lapse Band ${stamp}`, email: `band-${stamp}@lapsed.gigsaw.invalid`, phone: "+447700900123" },
    });
    const event = o.wedding
      ? await prisma.event.create({ data: { agencyId, name: `Hannah's wedding ${stamp}`, type: "WEDDING", date: "2030-08-14", customerId: contact.id } })
      : null;
    const booking = o.wedding ? null : await gig({ status: "ENQUIRY", ref: `LE-${stamp}` });
    const enquiry = await prisma.enquiry.create({
      data: {
        agencyId,
        name: "Hannah Smith",
        email: contact.email!,
        eventType: o.wedding ? "WEDDING" : "PRIVATE_PARTY",
        date: "2030-08-14",
        contactId: contact.id,
        bookingId: booking?.id ?? null,
        eventId: event?.id ?? null,
      },
    });
    const q = await prisma.quote.create({
      data: {
        agencyId,
        number: `QL-${stamp}`,
        enquiryId: enquiry.id,
        contactId: contact.id,
        title: `Hannah's ${o.wedding ? "wedding" : "party"} ${i}`,
        eventType: o.wedding ? "WEDDING" : "PRIVATE_PARTY",
        status: "SENT",
        sentAt: new Date(),
        sentTo: contact.email,
        token: randomBytes(24).toString("base64url"),
        tokenExpiresAt: new Date("2031-01-01T00:00:00Z"),
        validUntil: o.validUntil ?? "2030-12-31",
        lines: {
          create: [
            { sort: 0, artistId: act.id, date: "2030-08-14", startTime: "19:00", endTime: "23:00", place: "Home Farm", saleMinor: 150_000, costMinor: 110_000 },
          ],
        },
      },
    });
    return { contact, act, event, booking, enquiry, q, stamp };
  };

  const activityOf = (entityId: string) => prisma.activity.findMany({ where: { agencyId, entityId }, orderBy: { createdAt: "asc" } });
  const actHeard = (email: string) => state.sent.some((m) => m.to === email) || state.sms.length > 0 || state.push.length > 0;

  it("cancels the Enquiry booking with the reason when the scheduler expires the proposal, and marks the lead dealt with", async () => {
    const { runProposalChasers } = await import("@/lib/proposal-chasers");
    const { calendarQueueIdle } = await import("@/lib/calendar-sync/queue");
    const { FREED_ACTION } = await import("@/lib/lapsed-leads");
    const { booking, enquiry, q, act } = await makeLead({ validUntil: "2026-01-10" });
    state.sent = [];
    state.sms = [];
    // Night-time, so no reminder is sent alongside.
    await runProposalChasers(new Date(Date.UTC(2026, 0, 12, 2)));
    await calendarQueueIdle();

    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("EXPIRED");
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: booking!.id } });
    expect(b.status).toBe("CANCELLED");
    expect((await activityOf(b.id)).map((a) => [a.action, a.detail])).toEqual([["cancelled", EXPIRED]]);
    const lead = await prisma.enquiry.findUniqueOrThrow({ where: { id: enquiry.id } });
    expect(lead.status).toBe("DONE");
    expect(lead.doneAt).not.toBeNull();
    expect((await activityOf(enquiry.id)).map((a) => a.action)).toEqual(["marked an enquiry dealt with"]);
    const onQuote = (await activityOf(q.id)).find((a) => a.action === FREED_ACTION);
    expect(onQuote?.detail).toBe(b.reference);
    expect(actHeard(act.email!)).toBe(false);
  });

  it("does the same when the customer's page saves it as expired (markExpired), and is safe to run twice", async () => {
    const { markExpired } = await import("@/lib/proposal-server");
    const { freeLapsedLead } = await import("@/lib/lapsed-leads");
    const { booking, enquiry, q } = await makeLead({ validUntil: "2026-01-10" });
    await prisma.enquiry.update({ where: { id: enquiry.id }, data: { status: "DONE", doneAt: new Date("2026-01-01T10:00:00Z") } });
    await markExpired(q);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("EXPIRED");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking!.id } })).status).toBe("CANCELLED");
    // Already dealt with: left as it was.
    const lead = await prisma.enquiry.findUniqueOrThrow({ where: { id: enquiry.id } });
    expect(lead.doneAt?.toISOString()).toBe("2026-01-01T10:00:00.000Z");
    expect(await activityOf(enquiry.id)).toHaveLength(0);

    const before = await prisma.activity.count({ where: { agencyId } });
    await markExpired(q); // nothing to save: not out with the customer any more
    expect(await freeLapsedLead(q.id)).toEqual({ cancelled: [], eventCancelled: false, enquiryDone: false });
    await Promise.all([freeLapsedLead(q.id), freeLapsedLead(q.id)]);
    expect(await prisma.activity.count({ where: { agencyId } })).toBe(before);
    expect((await activityOf(booking!.id)).filter((a) => a.action === "cancelled")).toHaveLength(1);
  });

  it("cancels a wedding's held gigs and the wedding when the customer declines, without telling the acts", async () => {
    const { declineProposal, afterDeclined } = await import("@/lib/proposal-server");
    const { calendarQueueIdle } = await import("@/lib/calendar-sync/queue");
    const { event, q, act, contact, stamp } = await makeLead({ wedding: true });
    const held = await gig({ status: "HOLD", eventId: event!.id, artistId: act.id, offered: true, ref: `LW1-${stamp}` });
    const asked = await gig({ status: "ENQUIRY", eventId: event!.id, artistId: act.id, ref: `LW2-${stamp}` });
    state.sent = [];
    state.sms = [];
    state.push = [];

    expect(await declineProposal(q.token!, answer)).toBe(true);
    await afterDeclined(q.id);
    await calendarQueueIdle();

    for (const id of [held.id, asked.id]) {
      const b = await prisma.booking.findUniqueOrThrow({ where: { id } });
      expect(b.status).toBe("CANCELLED");
      expect(b.offerToken).toBeNull(); // the usual cancel: the offer link goes
      expect((await activityOf(id)).map((a) => [a.action, a.detail])).toEqual([["cancelled", DECLINED]]);
    }
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event!.id } })).status).toBe("CANCELLED");
    expect((await activityOf(event!.id)).map((a) => [a.action, a.detail])).toEqual([["cancelled", DECLINED]]);
    // The acts hear nothing; the customer is still thanked.
    expect(actHeard(act.email!)).toBe(false);
    expect(state.sent.filter((m) => m.to === contact.email)).toHaveLength(1);
  });

  it("cancels a wedding lead that never had gigs added", async () => {
    const { declineProposal, afterDeclined } = await import("@/lib/proposal-server");
    const { event, q } = await makeLead({ wedding: true });
    await declineProposal(q.token!, answer);
    await afterDeclined(q.id);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event!.id } })).status).toBe("CANCELLED");
  });

  it("leaves confirmed and paid gigs alone, and keeps the wedding while any are left", async () => {
    const { declineProposal, afterDeclined } = await import("@/lib/proposal-server");
    const { event, q, act, stamp } = await makeLead({ wedding: true });
    const confirmed = await gig({ status: "CONFIRMED", eventId: event!.id, artistId: act.id, ref: `LC1-${stamp}` });
    const pending = await gig({ status: "PENDING", eventId: event!.id, ref: `LC2-${stamp}` });
    const paid = await gig({ status: "HOLD", eventId: event!.id, artistId: act.id, ref: `LC3-${stamp}` });
    await prisma.payment.create({ data: { bookingId: paid.id, direction: "IN", kind: "DEPOSIT", amountMinor: 20_000, paidAt: new Date() } });
    const free = await gig({ status: "HOLD", eventId: event!.id, artistId: act.id, ref: `LC4-${stamp}` });
    state.sent = [];
    state.sms = [];
    state.push = [];

    await declineProposal(q.token!, answer);
    await afterDeclined(q.id);

    const status = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(confirmed.id)).toBe("CONFIRMED");
    expect(await status(pending.id)).toBe("PENDING");
    expect(await status(paid.id)).toBe("HOLD");
    expect(await status(free.id)).toBe("CANCELLED");
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event!.id } })).status).toBe("ACTIVE");
    expect(await activityOf(confirmed.id)).toHaveLength(0);
    expect(actHeard(act.email!)).toBe(false);
  });

  it("does nothing for a version a newer one has replaced, or once the lead has been accepted", async () => {
    const { freeLapsedLead } = await import("@/lib/lapsed-leads");
    const { markExpired } = await import("@/lib/proposal-server");

    // Replaced: v1 expired, v2 out with the customer.
    const a = await makeLead({ validUntil: "2026-01-10" });
    const v2 = await prisma.quote.create({
      data: { agencyId, number: a.q.number, version: 2, enquiryId: a.enquiry.id, contactId: a.contact.id, title: a.q.title, status: "SENT" },
    });
    await prisma.quote.update({ where: { id: a.q.id }, data: { supersededById: v2.id } });
    await markExpired(a.q);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: a.q.id } })).status).toBe("EXPIRED");
    expect(await freeLapsedLead(a.q.id)).toBeNull();
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: a.booking!.id } })).status).toBe("ENQUIRY");
    expect((await prisma.enquiry.findUniqueOrThrow({ where: { id: a.enquiry.id } })).status).toBe("NEW");

    // Another proposal for the same lead was accepted.
    const b = await makeLead({ wedding: true });
    const held = await gig({ status: "HOLD", eventId: b.event!.id, artistId: b.act.id, ref: `LA-${b.stamp}` });
    await prisma.quote.create({
      data: { agencyId, number: `QA-${b.stamp}`, enquiryId: b.enquiry.id, contactId: b.contact.id, title: b.q.title, status: "ACCEPTED", eventId: b.event!.id },
    });
    await prisma.quote.update({ where: { id: b.q.id }, data: { status: "DECLINED" } });
    expect(await freeLapsedLead(b.q.id)).toBeNull();
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: held.id } })).status).toBe("HOLD");
    expect((await prisma.event.findUniqueOrThrow({ where: { id: b.event!.id } })).status).toBe("ACTIVE");

    // Withdrawn by staff: out of scope.
    const c = await makeLead();
    await prisma.quote.update({ where: { id: c.q.id }, data: { status: "WITHDRAWN" } });
    expect(await freeLapsedLead(c.q.id)).toBeNull();
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: c.booking!.id } })).status).toBe("ENQUIRY");
  });

  it("books as usual when a new version is accepted after the lead was cancelled", async () => {
    const { declineProposal, afterDeclined, acceptProposal, newProposalVersion } = await import("@/lib/proposal-server");
    const { event, q, enquiry, stamp, act } = await makeLead({ wedding: true });
    const held = await gig({ status: "HOLD", eventId: event!.id, artistId: act.id, ref: `LB-${stamp}` });
    await declineProposal(q.token!, answer);
    await afterDeclined(q.id);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event!.id } })).status).toBe("CANCELLED");

    // The customer comes back: staff make version 2 and send it.
    const admin = await prisma.user.findFirstOrThrow({ where: { agencyId } });
    const v2 = await newProposalVersion({ id: admin.id, agencyId }, q.id);
    const token = randomBytes(24).toString("base64url");
    await prisma.quote.update({ where: { id: v2.id }, data: { status: "SENT", sentAt: new Date(), token, tokenExpiresAt: new Date("2031-01-01T00:00:00Z") } });

    // Version 2 offers the couple the usual choice of how to pay the balance, so they pick one.
    expect(v2.payOptions).toEqual(["CASH", "TRANSFER"]);
    const done = await acceptProposal(token, { ...answer, note: "", payPlan: "TRANSFER" });
    expect(done).not.toBeNull();
    // A new wedding with new bookings, held until its deposit (the share plus VAT) is in; the cancelled one and its gig stay as they were.
    expect(done!.eventId).not.toBe(event!.id);
    expect(done!.bookings.map((b) => b.status)).toEqual(["HOLD"]);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: done!.eventId } })).status).toBe("ACTIVE");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: held.id } })).status).toBe("CANCELLED");
    expect((await prisma.enquiry.findUniqueOrThrow({ where: { id: enquiry.id } })).eventId).toBe(done!.eventId);
  });
});
