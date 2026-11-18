import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// The proposal stage of a wedding, and holding it until it's secured:
//  - a customer who hasn't answered is reminded at 3 and 7 days (once each, office hours), and the
//    proposal expires after its valid-until date (14 days by default);
//  - declining thanks the customer;
//  - a wedding accepted with a deposit is held (Hold, acts not told) until the deposit is in; then the gate
//    (src/lib/secure-event.ts) confirms it, tells the acts and sends the couple one "you're booked" email;
//  - a signed contract goes through the same gate; a wedding with no deposit is booked on acceptance.
// Database tests: TEST_DATABASE_URL only.

type Sent = { to: string; subject: string; kind: string; email: { title?: string; rows?: [string, string][]; intro?: string; outro?: string } };
const state = vi.hoisted(() => ({ sent: [] as Sent[], user: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "10.9.8.7", "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  const signedIn = async () => state.user;
  return { ...real, requireUser: signedIn, requireStaff: signedIn, requireAdmin: signedIn };
});
vi.mock("@/lib/messaging", async (orig) => {
  const real = await orig<typeof import("@/lib/messaging")>();
  return {
    ...real,
    sendEmail: async (m: Parameters<typeof real.sendEmail>[0]) => {
      state.sent.push(m as never);
      return "SENT";
    },
    sendSms: async () => "SENT",
    sendPush: async () => 0,
  };
});

type Db = typeof import("@/lib/db");
const DAY = 86_400_000;
const HOUR = 3_600_000;
const PNG = (() => {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return `data:image/png;base64,${Buffer.concat([head, Buffer.alloc(200, 1)]).toString("base64")}`;
})();
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};
const answer = { name: "Hannah Smith", note: "", ip: "10.0.0.1", agent: "vitest", signature: PNG };

describeDb("proposal reminders, answers and the wedding's secure gate (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let admin: { id: string; agencyId: string };
  let n = 0;
  const teamEmail = `team-${Date.now()}@stages.gigsaw.invalid`;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "stages", { agencyName: "Suave Test Music", agencyEmail: teamEmail, defaultTimezone: "Europe/London" });
    agencyId = t.agency.id;
    admin = { id: t.admin.id, agencyId };
    state.user = { ...t.user, role: "ADMIN" };
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  const to = (email: string) => state.sent.filter((m) => m.to === email);

  /** A proposal out with the customer: one line with an act, sent `sentAt`. */
  const makeProposal = async (o: { eventType?: string; depositMinor?: number; sentAt?: Date; validUntil?: string | null; status?: string } = {}) => {
    const i = ++n;
    const stamp = `${i}-${Date.now()}`;
    const contact = await prisma.contact.create({ data: { agencyId, name: "Hannah Smith", email: `hannah-${stamp}@stages.gigsaw.invalid`, type: "CLIENT" } });
    const act = await prisma.artist.create({ data: { agencyId, name: `Stage Band ${stamp}`, email: `band-${stamp}@stages.gigsaw.invalid` } });
    const sentAt = o.sentAt ?? new Date();
    const q = await prisma.quote.create({
      data: {
        agencyId,
        number: `QT-${stamp}`,
        contactId: contact.id,
        title: `Hannah & Sam's wedding ${i}`,
        eventType: o.eventType ?? "WEDDING",
        status: o.status ?? "SENT",
        sentAt,
        sentTo: contact.email,
        token: randomBytes(24).toString("base64url"),
        tokenExpiresAt: new Date("2031-01-01T00:00:00Z"),
        depositMinor: o.depositMinor ?? 0,
        validUntil: o.validUntil === undefined ? "2030-12-31" : o.validUntil,
        terms: "1. The deposit secures your date.",
        lines: {
          create: [
            {
              sort: 0,
              artistId: act.id,
              description: "Evening band",
              date: "2030-08-14",
              startTime: "19:00",
              endTime: "23:00",
              place: "Home Farm",
              saleMinor: 150_000,
              costMinor: 110_000,
            },
          ],
        },
      },
    });
    return { q, contact, act };
  };

  const accept = async (token: string, id: string) => {
    const { acceptProposal, afterAccepted } = await import("@/lib/proposal-server");
    const done = await acceptProposal(token, answer);
    expect(done).not.toBeNull();
    await afterAccepted(id);
    return done!;
  };

  // ---------- Reminders and expiry ----------

  it("reminds the customer 3 and 7 days after sending, once each, in office hours, and expires the proposal after 14 days", async () => {
    const { runProposalChasers } = await import("@/lib/proposal-chasers");
    // Noon in London, in January (GMT).
    const sentAt = new Date(Date.UTC(2027, 0, 11, 9));
    const validUntil = "2027-01-25"; // 14 days after sending, as the default
    const open = await makeProposal({ sentAt, validUntil });
    const declined = await makeProposal({ sentAt, validUntil, status: "DECLINED" });
    const replaced = await makeProposal({ sentAt, validUntil });
    const newer = await prisma.quote.create({ data: { agencyId, number: `QT-new-${Date.now()}`, title: "newer", status: "DRAFT" } });
    await prisma.quote.update({ where: { id: replaced.q.id }, data: { supersededById: newer.id } });
    state.sent = [];

    // Day 2: nothing yet.
    await runProposalChasers(new Date(sentAt.getTime() + 2 * DAY));
    expect(to(open.contact.email)).toHaveLength(0);

    // Day 3, but at 10pm: outside office hours, so it waits.
    await runProposalChasers(new Date(Date.UTC(2027, 0, 14, 22)));
    expect(to(open.contact.email)).toHaveLength(0);

    // Day 3 at noon: the first reminder, once however often the job runs.
    const day3 = new Date(Date.UTC(2027, 0, 14, 12));
    await runProposalChasers(day3);
    await runProposalChasers(new Date(day3.getTime() + 60_000));
    expect(to(open.contact.email)).toHaveLength(1);
    expect(to(open.contact.email)[0].subject).toBe(`Your proposal for ${open.q.title}`);
    expect(to(open.contact.email)[0].email.intro).toContain("just checking you've seen your proposal");
    // Answered or replaced proposals are left alone.
    expect(to(declined.contact.email)).toHaveLength(0);
    expect(to(replaced.contact.email)).toHaveLength(0);
    expect(await prisma.reminder.count({ where: { kind: "QUOTE_CHASE_3", recipient: `quote:${open.q.id}` } })).toBe(1);

    // Day 7: the second reminder, once.
    const day7 = new Date(Date.UTC(2027, 0, 18, 12));
    await runProposalChasers(day7);
    await runProposalChasers(new Date(day7.getTime() + 60_000));
    expect(to(open.contact.email)).toHaveLength(2);
    expect(to(open.contact.email)[1].subject).toBe(`A gentle reminder: your proposal for ${open.q.title}`);
    expect(to(declined.contact.email)).toHaveLength(0);
    expect(to(replaced.contact.email)).toHaveLength(0);

    // Still valid on its last day.
    await runProposalChasers(new Date(Date.UTC(2027, 0, 25, 12)));
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: open.q.id } })).status).toBe("SENT");

    // Day 15: past its valid-until date, so it's saved as Expired (no reminder), and a replaced one isn't touched.
    const r = await runProposalChasers(new Date(Date.UTC(2027, 0, 26, 1)));
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: open.q.id } })).status).toBe("EXPIRED");
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: declined.q.id } })).status).toBe("DECLINED");
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: replaced.q.id } })).status).toBe("SENT");
    expect(to(open.contact.email)).toHaveLength(2);
    expect(await prisma.activity.count({ where: { agencyId, entityId: open.q.id, action: { contains: "expired" } } })).toBe(1);
  });

  // ---------- Declined ----------

  it("thanks the customer warmly when they decline, and still tells the team", async () => {
    const { declineProposal, afterDeclined } = await import("@/lib/proposal-server");
    const { q, contact } = await makeProposal();
    state.sent = [];
    expect(await declineProposal(q.token!, { ...answer, name: "", note: "We found a DJ" })).toBe(true);
    await afterDeclined(q.id);
    const mine = to(contact.email);
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toBe("Thank you for considering Suave Test Music");
    expect(mine[0].email.title).toBe("Thank you for your interest");
    expect(JSON.stringify(mine[0])).not.toMatch(/sorry|apolog|—/i);
    expect(to(teamEmail).map((m) => m.subject)).toEqual([expect.stringMatching(/^Proposal declined: /)]);
  });

  // ---------- Accepted with a deposit: held until it's paid ----------

  it("holds a wedding accepted with a deposit, tells no act, asks for the deposit, then books it once on the deposit payment", async () => {
    const { q, contact, act } = await makeProposal({ depositMinor: 50_000 });
    state.sent = [];
    const done = await accept(q.token!, q.id);

    const bookings = await prisma.booking.findMany({ where: { eventId: done.eventId } });
    expect(bookings.map((b) => b.status)).toEqual(["HOLD"]);
    expect(bookings[0].customerToldAt).toBeNull();
    expect(to(act.email)).toHaveLength(0); // the act isn't told yet
    const couple = to(contact.email);
    expect(couple).toHaveLength(1);
    expect(couple[0].subject).toBe(`Thanks for accepting: ${q.title}`);
    expect(couple[0].email.intro).toContain("Your date is held for you");
    expect(couple[0].email.intro).toContain("£500.00");
    expect(JSON.stringify(couple[0])).not.toContain("1,100"); // never the act's fee
    expect(to(teamEmail)).toHaveLength(1);
    expect(to(teamEmail)[0].email.intro).toContain("on hold until the deposit");

    // Part of the deposit: still held.
    const { addPayment } = await import("@/actions/bookings");
    await addPayment(bookings[0].id, undefined as never, form({ direction: "IN", kind: "DEPOSIT", amount: "200", receipt: "on" }));
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookings[0].id } })).status).toBe("HOLD");
    expect(to(act.email)).toHaveLength(0);
    expect(to(contact.email).map((m) => m.subject)).toEqual([`Thanks for accepting: ${q.title}`, "Payment received: £200.00"]);

    // The rest of the deposit: booked. The act is told, and the couple get one "you're booked" email (no plain receipt).
    await addPayment(bookings[0].id, undefined as never, form({ direction: "IN", kind: "DEPOSIT", amount: "300", receipt: "on" }));
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: bookings[0].id } });
    expect(after.status).toBe("CONFIRMED");
    expect(after.customerToldAt).not.toBeNull();
    expect(to(act.email)).toHaveLength(1);
    const secured = to(contact.email).slice(2);
    expect(secured).toHaveLength(1);
    expect(secured[0].subject).toBe(`You're booked: ${q.title}`);
    expect(secured[0].email.title).toBe("Deposit received, you're booked");
    expect(secured[0].email.outro).toContain("The balance of £1,000.00 is due by");
    expect(secured[0].email.outro).toContain("three months before your wedding");
    expect(secured[0].email.outro).toContain("running order");
    expect(secured[0].email.rows).toContainEqual(["Balance", expect.stringMatching(/^£1,000.00, due by .*14 May 2030$/)]);
    expect(JSON.stringify(secured[0])).not.toMatch(/1,100|—/);

    // Called again, and twice at once: nothing more happens.
    const { secureEvent } = await import("@/lib/secure-event");
    const again = await Promise.all([secureEvent(done.eventId), secureEvent(done.eventId)]);
    expect(again.map((r) => r.secured)).toEqual([true, true]);
    expect(again.flatMap((r) => r.moved)).toEqual([]);
    expect(to(contact.email)).toHaveLength(3);
    expect(to(act.email)).toHaveLength(1);
    expect(await prisma.reminder.count({ where: { kind: "EV_SECURED", recipient: `event:${done.eventId}` } })).toBe(1);
  });

  it("books a held wedding once, even when two payments land at the same moment", async () => {
    const { q, contact, act } = await makeProposal({ depositMinor: 50_000 });
    const done = await accept(q.token!, q.id);
    const [b] = await prisma.booking.findMany({ where: { eventId: done.eventId } });
    await prisma.payment.create({ data: { bookingId: b.id, direction: "IN", kind: "DEPOSIT", amountMinor: 50_000, paidAt: new Date() } });
    state.sent = [];
    const { secureEvent } = await import("@/lib/secure-event");
    const runs = await Promise.all([secureEvent(done.eventId), secureEvent(done.eventId), secureEvent(done.eventId)]);
    expect(runs.flatMap((r) => r.moved)).toEqual([b.id]);
    expect(runs.filter((r) => r.told)).toHaveLength(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CONFIRMED");
    expect(to(contact.email)).toHaveLength(1);
    expect(to(act.email)).toHaveLength(1);
  });

  // ---------- No deposit: booked on acceptance ----------

  it("books a wedding with no deposit straight away: the act is told and the couple get one 'you're booked' email", async () => {
    const { q, contact, act } = await makeProposal({ depositMinor: 0 });
    state.sent = [];
    const done = await accept(q.token!, q.id);
    const bookings = await prisma.booking.findMany({ where: { eventId: done.eventId } });
    expect(bookings.map((b) => b.status)).toEqual(["CONFIRMED"]);
    expect(to(act.email)).toHaveLength(1);
    const couple = to(contact.email);
    expect(couple).toHaveLength(1);
    expect(couple[0].subject).toBe(`You're booked: ${q.title}`);
    expect(couple[0].email.title).toBe("Thank you, you're booked");
    expect(couple[0].email.outro).toContain("three months before your wedding");
    expect(await prisma.reminder.count({ where: { kind: "EV_SECURED", recipient: `event:${done.eventId}` } })).toBe(1);

    // A payment later doesn't send it again.
    const { secureEvent } = await import("@/lib/secure-event");
    await prisma.payment.create({ data: { bookingId: bookings[0].id, direction: "IN", kind: "BALANCE", amountMinor: 10_000, paidAt: new Date() } });
    expect((await secureEvent(done.eventId)).told).toBe(false);
    expect(to(contact.email)).toHaveLength(1);
  });

  it("leaves other events as they were: confirmed on acceptance with the usual 'you're booked' email", async () => {
    const { q, contact, act } = await makeProposal({ eventType: "CORPORATE", depositMinor: 50_000 });
    state.sent = [];
    const done = await accept(q.token!, q.id);
    expect((await prisma.booking.findMany({ where: { eventId: done.eventId } })).map((b) => b.status)).toEqual(["CONFIRMED"]);
    expect(to(act.email)).toHaveLength(1);
    expect(to(contact.email).map((m) => m.email.title)).toEqual(["Thank you, you're booked"]);
    expect(await prisma.reminder.count({ where: { kind: "EV_SECURED", recipient: `event:${done.eventId}` } })).toBe(0);
  });

  // ---------- The gate on a signed contract ----------

  const weddingWithContract = async (o: { status: string; depositMinor: number; paidMinor: number }) => {
    const i = ++n;
    const stamp = `${i}-${Date.now()}`;
    const customer = await prisma.contact.create({ data: { agencyId, name: "Jo Bloggs", email: `jo-${stamp}@stages.gigsaw.invalid`, type: "CLIENT" } });
    const act = await prisma.artist.create({ data: { agencyId, name: `Contract Band ${stamp}`, email: `cband-${stamp}@stages.gigsaw.invalid` } });
    const event = await prisma.event.create({ data: { agencyId, name: `Jo's wedding ${i}`, type: "WEDDING", date: "2030-09-04", customerId: customer.id } });
    const setStart = new Date(Date.UTC(2030, 8, 4, 18));
    const b = await prisma.booking.create({
      data: {
        agencyId,
        reference: `ST-${i}`,
        eventId: event.id,
        artistId: act.id,
        promoterId: customer.id,
        status: o.status,
        eventType: "WEDDING",
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd: new Date(setStart.getTime() + 3 * HOUR),
        feeMinor: 120_000,
        depositMinor: o.depositMinor,
      },
    });
    if (o.paidMinor) await prisma.payment.create({ data: { bookingId: b.id, direction: "IN", kind: "DEPOSIT", amountMinor: o.paidMinor, paidAt: new Date() } });
    return { customer, act, event, b };
  };

  const sign = async (eventId: string, email: string) => {
    const { sendContract, liveContractDoc } = await import("@/lib/contracts");
    const { contractHash } = await import("@/lib/contract-doc");
    const { signContract } = await import("@/actions/contracts");
    const { contract } = await sendContract(admin, { kind: "event", id: eventId }, { name: "Jo Bloggs", email });
    const live = await liveContractDoc(contract);
    return signContract(contract.token, contractHash(live!.doc), undefined as never, form({ signedName: "Jo Bloggs", signature: PNG, agree: "on" })).catch(
      (e: Error) => e.message,
    );
  };

  it("books a wedding when its contract is signed and the deposit is already in: Pending for the act's offer, and one email to the couple", async () => {
    const { customer, act, event, b } = await weddingWithContract({ status: "HOLD", depositMinor: 30_000, paidMinor: 30_000 });
    state.sent = [];
    expect(await sign(event.id, customer.email)).toMatch(/^REDIRECT \/c\//);
    // Signing books it, as before weddings had a gate: Pending until the act is offered it and confirms.
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PENDING");
    expect(to(act.email)).toHaveLength(0);
    // One email: "you're booked", thanking them for signing, with their signed copy. Not "approved" as well.
    const mails = to(customer.email).filter((m) => !m.subject.startsWith("Please sign"));
    expect(mails.map((m) => m.subject)).toEqual([`You're booked: ${event.name}`]);
    expect(mails[0].email.intro).toContain("thank you for signing your contract. Your deposit is in too, so");
    expect(mails[0].email.intro).not.toContain("proposal");
    expect(JSON.stringify(mails[0])).toContain("See your signed copy");
    expect(await prisma.reminder.count({ where: { kind: "EV_GATE", recipient: `event:${event.id}` } })).toBe(1);
  });

  it("holds a wedding whose contract is signed until the deposit is in, then books it", async () => {
    const { customer, act, event, b } = await weddingWithContract({ status: "HOLD", depositMinor: 30_000, paidMinor: 0 });
    state.sent = [];
    await sign(event.id, customer.email);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("HOLD");
    expect(to(act.email)).toHaveLength(0);
    // Signed, not booked: the deposit secures the date.
    const signed = to(customer.email).filter((m) => !m.subject.startsWith("Please sign"));
    expect(signed.map((m) => m.subject)).toEqual(["Signed: your contract with Suave Test Music"]);
    expect(signed[0].email.title).toBe("Thank you for signing");
    expect(signed[0].email.intro).toContain("your deposit secures it");
    expect(JSON.stringify(signed[0])).not.toMatch(/approved|booked with/i);

    const { recordEventPayment } = await import("@/actions/events");
    await recordEventPayment(event.id, undefined as never, form({ amount: "300", kind: "DEPOSIT", receipt: "on" }));
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PENDING");
    expect(to(act.email)).toHaveLength(0);
    expect(to(customer.email).filter((m) => m.subject === `You're booked: ${event.name}`)).toHaveLength(1);
    expect(to(customer.email).filter((m) => m.subject.startsWith("Payment received"))).toHaveLength(0);
  });

  // ---------- Only what the journey held ----------

  it("books only the gigs the journey held: a gig staff pencilled in later stays On hold, and a later payment sends nothing more", async () => {
    const { q, contact, act } = await makeProposal({ depositMinor: 50_000 });
    const done = await accept(q.token!, q.id);
    const [held] = await prisma.booking.findMany({ where: { eventId: done.eventId } });
    expect(await prisma.reminder.count({ where: { kind: "EV_HELD", recipient: `booking:${held.id}` } })).toBe(1);
    // Staff pencil in another act for the evening, On hold while they ask around.
    const pencil = await prisma.booking.create({
      data: {
        agencyId,
        reference: `PEN-${++n}`,
        eventId: done.eventId,
        artistId: act.id,
        status: "HOLD",
        arriveBy: held.arriveBy,
        setStart: held.setStart,
        setEnd: held.setEnd,
        feeMinor: 50_000,
      },
    });
    state.sent = [];
    const { addPayment } = await import("@/actions/bookings");
    await addPayment(held.id, undefined as never, form({ direction: "IN", kind: "DEPOSIT", amount: "500", receipt: "on" }));
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: held.id } })).status).toBe("CONFIRMED");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: pencil.id } })).status).toBe("HOLD");
    expect(to(act.email)).toHaveLength(1);
    expect(to(contact.email).map((m) => m.subject)).toEqual([`You're booked: ${q.title}`]);
    // The pencilled act isn't listed as booked.
    expect(to(contact.email)[0].email.rows!.filter(([k]) => k === act.name)).toHaveLength(1);
    expect(await prisma.reminder.count({ where: { kind: "EV_HELD", recipient: `booking:${held.id}` } })).toBe(0);

    // A later payment: still nothing for the pencilled gig, and no second "you're booked".
    state.sent = [];
    await addPayment(held.id, undefined as never, form({ direction: "IN", kind: "BALANCE", amount: "100", receipt: "on" }));
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: pencil.id } })).status).toBe("HOLD");
    expect(to(act.email)).toHaveLength(0);
    expect(to(contact.email).map((m) => m.subject)).toEqual(["Payment received: £100.00"]);
    expect(await prisma.reminder.count({ where: { kind: "EV_SECURED", recipient: `event:${done.eventId}` } })).toBe(1);
  });

  it("doesn't count money the couple paid straight to an act as the business's deposit", async () => {
    const { DIRECT_NOTE } = await import("@/lib/pay-plan");
    const { secureEvent } = await import("@/lib/secure-event");
    const { q, contact } = await makeProposal({ depositMinor: 50_000 });
    const done = await accept(q.token!, q.id);
    const [b] = await prisma.booking.findMany({ where: { eventId: done.eventId } });
    await prisma.payment.create({ data: { bookingId: b.id, direction: "IN", kind: "BALANCE", amountMinor: 110_000, paidAt: new Date(), note: DIRECT_NOTE } });
    state.sent = [];
    const r = await secureEvent(done.eventId);
    expect(r.secured).toBe(false);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("HOLD");
    expect(to(contact.email)).toHaveLength(0);
    expect(await prisma.reminder.count({ where: { kind: "EV_GATE", recipient: `event:${done.eventId}` } })).toBe(0);
    // The deposit itself, paid to the business: booked.
    await prisma.payment.create({ data: { bookingId: b.id, direction: "IN", kind: "DEPOSIT", amountMinor: 50_000, paidAt: new Date() } });
    expect((await secureEvent(done.eventId)).secured).toBe(true);
  });

  it("books the wedding when Stripe sends a card payment again after the first delivery stopped short", async () => {
    const { recordCardPayment } = await import("@/lib/card-payments");
    const { q, contact, act } = await makeProposal({ depositMinor: 50_000 });
    const done = await accept(q.token!, q.id);
    const [b] = await prisma.booking.findMany({ where: { eventId: done.eventId } });
    const accountId = `acct_test_${Date.now()}`;
    await prisma.agency.update({ where: { id: agencyId }, data: { stripeAccountId: accountId } });
    try {
      const link = await prisma.payLink.create({ data: { agencyId, eventId: done.eventId, kind: "DEPOSIT", token: randomBytes(18).toString("base64url") } });
      const session = {
        id: `cs_test_${Date.now()}`,
        payment_status: "paid",
        amount_total: 50_000,
        currency: "gbp",
        payment_intent: `pi_test_${Date.now()}`,
        customer_details: { email: contact.email },
        metadata: { gigsaw_link: link.id, gigsaw_kind: "DEPOSIT" },
      };
      // The first delivery logged the payment, then stopped before the gate (as if the server restarted).
      const card = await prisma.cardPayment.create({
        data: {
          agencyId,
          payLinkId: link.id,
          stripeSessionId: session.id,
          stripeAccountId: accountId,
          kind: "DEPOSIT",
          amountMinor: 50_000,
          currency: "GBP",
          paidAt: new Date(),
        },
      });
      await prisma.payment.create({
        data: { bookingId: b.id, direction: "IN", kind: "DEPOSIT", amountMinor: 50_000, paidAt: new Date(), note: "Paid by card", cardPaymentId: card.id },
      });
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("HOLD");
      state.sent = [];
      // Stripe tries again: already logged, so nothing is logged twice, but the wedding is booked.
      expect(await recordCardPayment(session, accountId)).toBe("duplicate");
      expect(await prisma.payment.count({ where: { bookingId: b.id } })).toBe(1);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CONFIRMED");
      expect(to(act.email)).toHaveLength(1);
      expect(to(contact.email).map((m) => m.subject)).toEqual([`You're booked: ${q.title}`]);
    } finally {
      await prisma.agency.update({ where: { id: agencyId }, data: { stripeAccountId: null } });
    }
  });
});
