import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// A wedding proposal's ways to pay, from the couple signing to the balance (src/lib/proposal-pay.ts):
//  - the couple must choose how to pay the balance when both are offered, and their choice is kept;
//  - a cash balance makes the wedding BALANCE_CASH, with VAT on the business's share only; a bank transfer balance
//    makes it FULL, with VAT on everything;
//  - either way each booking's deposit is its share plus VAT, the deposit link asks for exactly that, the secure
//    gate books the wedding when it's paid, and the couple's emails show the same deposit, balance and total.
// The business's example: price £1,500, the band's fee £1,100, 20% VAT. Deposit £480; balance £1,100 in cash,
// or £1,320 by bank transfer. Database tests: TEST_DATABASE_URL only.

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
// Card payments switched on, without a real Stripe key: only whether they're set up is asked.
vi.mock("@/lib/stripe", async (orig) => {
  const real = await orig<typeof import("@/lib/stripe")>();
  return { ...real, stripeConfigured: async () => true };
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
const CASH_ADDRESS = "63 Boverton Road\nLlantwit Major\nCF61 1YA";

describeDb("how the couple pay a wedding proposal (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let n = 0;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "paychoice", {
      agencyName: "Suave Weddings",
      agencyEmail: `team-${Date.now()}@paychoice.gigsaw.invalid`,
      defaultTimezone: "Europe/London",
      cashAddress: CASH_ADDRESS,
    });
    agencyId = t.agency.id;
    await prisma.agency.update({ where: { id: agencyId }, data: { stripeAccountId: `acct_paychoice_${Date.now()}`, stripeChargesEnabled: true } });
    state.user = { ...t.user, role: "ADMIN" };
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  const to = (email: string) => state.sent.filter((m) => m.to === email);

  /** A wedding proposal out with the couple, offering both ways to pay the balance. */
  const makeProposal = async () => {
    const i = ++n;
    const stamp = `${i}-${Date.now()}`;
    const contact = await prisma.contact.create({
      data: { agencyId, name: "Hannah Smith", email: `hannah-${stamp}@paychoice.gigsaw.invalid`, type: "CLIENT" },
    });
    const act = await prisma.artist.create({ data: { agencyId, name: `Pay Band ${stamp}`, email: `band-${stamp}@paychoice.gigsaw.invalid` } });
    const q = await prisma.quote.create({
      data: {
        agencyId,
        number: `QP-${i}`,
        contactId: contact.id,
        title: `Hannah & Sam's wedding ${i}`,
        eventType: "WEDDING",
        status: "SENT",
        sentAt: new Date(),
        sentTo: contact.email,
        token: randomBytes(24).toString("base64url"),
        tokenExpiresAt: new Date("2031-01-01T00:00:00Z"),
        validUntil: "2030-12-31",
        terms: "1. The deposit secures your date.",
        payOptions: ["CASH", "TRANSFER"],
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
              vatPct: 20,
            },
          ],
        },
      },
    });
    return { q, contact, act };
  };

  const fullEvent = async (eventId: string) => {
    const { eventInclude } = await import("@/lib/events");
    return prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: eventInclude });
  };

  /** Sign with a choice, then what the server does afterwards (the deposit link, then the emails). */
  const sign = async (token: string, id: string, payPlan: string) => {
    const { acceptProposal, afterAccepted, depositLinkFor } = await import("@/lib/proposal-server");
    const done = await acceptProposal(token, { ...answer, payPlan });
    expect(done).not.toBeNull();
    const link = await depositLinkFor(id);
    await afterAccepted(id);
    return { done: done!, link };
  };

  it("won't accept without a choice when both are offered, and won't take one that isn't offered", async () => {
    const { acceptProposal } = await import("@/lib/proposal-server");
    const { q } = await makeProposal();
    await expect(acceptProposal(q.token!, answer)).rejects.toThrow("Choose how you'd like to pay the balance");
    await expect(acceptProposal(q.token!, { ...answer, payPlan: "DEPOSIT_TRANSFER" })).rejects.toThrow("Choose how you'd like to pay the balance");
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("SENT");
  });

  it("cash balance: £480 deposit books the wedding, then £1,100 in cash to the business with no VAT", async () => {
    const { q, contact, act } = await makeProposal();
    state.sent = [];
    const { done, link } = await sign(q.token!, q.id, "CASH");

    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).payPlan).toBe("CASH");
    const event = await prisma.event.findUniqueOrThrow({ where: { id: done.eventId } });
    expect(event.payPlan).toBe("BALANCE_CASH");
    const [b] = await prisma.booking.findMany({ where: { eventId: done.eventId } });
    expect(b).toMatchObject({ status: "HOLD", vatOnShare: true, depositMinor: 48_000, feeMinor: 150_000, artistFeeMinor: 110_000, vatPct: 20 });

    // The wedding's money agrees with the proposal: £1,580 in all, £80 VAT.
    const { eventTotals, owedToUs } = await import("@/lib/events");
    expect(eventTotals([{ ...b, payments: [] }])).toMatchObject({ total: 158_000, vat: 8_000 });

    // The deposit link asks for £480.
    const { loadPayLink } = await import("@/lib/card-payments");
    expect(link).not.toBeNull();
    expect((await loadPayLink({ token: link!.token }))!).toMatchObject({ kind: "DEPOSIT", dueMinor: 48_000, totalMinor: 158_000 });

    // The couple are thanked and asked for £480, with the cash balance and where to bring it.
    const held = to(contact.email);
    expect(held).toHaveLength(1);
    expect(held[0].email.intro).toContain("£480.00");
    expect(held[0].email.rows).toContainEqual(["Your deposit, including VAT", "£480.00"]);
    expect(held[0].email.rows).toContainEqual([
      "Pay the balance in cash, no VAT",
      expect.stringMatching(/^£1,100\.00, due by .*\nDelivered to 63 Boverton Road, Llantwit Major, CF61 1YA\nTotal £1,580\.00$/),
    ]);
    expect(to(act.email)).toHaveLength(0);

    // The deposit in: booked, once, with the cash balance in the "you're booked" email.
    const { recordEventPayment } = await import("@/actions/events");
    await recordEventPayment(done.eventId, undefined as never, form({ amount: "480", kind: "DEPOSIT" }));
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CONFIRMED");
    expect(to(act.email)).toHaveLength(1);
    const booked = to(contact.email).filter((m) => m.subject.startsWith("You're booked"));
    expect(booked).toHaveLength(1);
    expect(booked[0].email.rows).toContainEqual(["Total", "£1,580.00"]);
    expect(booked[0].email.rows).toContainEqual([
      "Balance",
      expect.stringMatching(/^£1,100\.00, due by .*\nIn cash, with no VAT, brought to 63 Boverton Road, Llantwit Major, CF61 1YA$/),
    ]);
    expect(booked[0].email.outro).toContain("The balance of £1,100.00 is due by");

    // The balance: £1,100 owed to the business (not to the band), asked for in cash.
    const e = await fullEvent(done.eventId);
    expect(owedToUs(e)).toBe(110_000);
    const { sendEventStep } = await import("@/lib/events");
    state.sent = [];
    expect((await sendEventStep(e, "BALANCE_REMINDER")).sent).toBe(1);
    const reminder = to(contact.email)[0];
    expect(reminder.subject).toContain("balance of £1,100.00");
    expect(reminder.email.rows).toContainEqual(["Total", "£1,580.00"]);
    expect(reminder.email.rows).toContainEqual(["Left to pay", "£1,100.00"]);
    expect(reminder.email.rows).toContainEqual(["How to pay", "In cash, with no VAT, brought to 63 Boverton Road, Llantwit Major, CF61 1YA"]);
    expect(reminder.email.outro).not.toContain("bank details");
    // The couple's page money (the planner email carries the same summary).
    state.sent = [];
    const { sendPlannerEmail } = await import("@/lib/events");
    await sendPlannerEmail(e, "request", { money: true });
    const planner = to(contact.email)[0];
    expect(planner.email.rows).toContainEqual(["Left to pay", "£1,100.00"]);
    expect(planner.email.rows).toContainEqual(["How to pay the balance", "In cash, with no VAT, brought to 63 Boverton Road, Llantwit Major, CF61 1YA"]);
    // Nothing tells the couple to pay the band, or shows its fee as a fee or its bank details.
    for (const m of [...held, ...booked, reminder, planner]) expect(JSON.stringify(m)).not.toMatch(/pay the band|straight to|Act's fee|Sort code|—/i);

    // Staff record the cash as an ordinary payment in: all paid.
    await recordEventPayment(done.eventId, undefined as never, form({ amount: "1100", kind: "BALANCE" }));
    const paid = await prisma.payment.findMany({ where: { bookingId: b.id, direction: "IN" } });
    expect(paid.every((p) => p.note !== "Paid by the customer straight to the act")).toBe(true);
    expect(owedToUs(await fullEvent(done.eventId))).toBe(0);
  });

  it("bank transfer balance: the same £480 deposit, then £1,320 with VAT, all to the business", async () => {
    const { q, contact } = await makeProposal();
    state.sent = [];
    const { done, link } = await sign(q.token!, q.id, "TRANSFER");

    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).payPlan).toBe("TRANSFER");
    expect((await prisma.event.findUniqueOrThrow({ where: { id: done.eventId } })).payPlan).toBe("FULL");
    const [b] = await prisma.booking.findMany({ where: { eventId: done.eventId } });
    expect(b).toMatchObject({ status: "HOLD", vatOnShare: false, depositMinor: 48_000 });
    const { loadPayLink } = await import("@/lib/card-payments");
    expect((await loadPayLink({ token: link!.token }))!).toMatchObject({ dueMinor: 48_000, totalMinor: 180_000, vatMinor: 30_000 });
    expect(to(contact.email)[0].email.rows).toContainEqual([
      "Pay the balance by bank transfer, plus 20% VAT",
      expect.stringMatching(/^£1,320\.00, due by .*\nTotal £1,800\.00$/),
    ]);

    // Paid by card on the deposit link: the gate books it on £480.
    const { recordCardPayment } = await import("@/lib/card-payments");
    const agency = await prisma.agency.findUniqueOrThrow({ where: { id: agencyId } });
    const r = await recordCardPayment(
      {
        id: `cs_test_${Date.now()}`,
        payment_status: "paid",
        amount_total: 48_000,
        currency: "gbp",
        payment_intent: `pi_test_${Date.now()}`,
        customer_details: { email: contact.email },
        metadata: { gigsaw_link: link!.id, gigsaw_kind: "DEPOSIT" },
      },
      agency.stripeAccountId!,
    );
    expect(r).toBe("recorded");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CONFIRMED");

    const e = await fullEvent(done.eventId);
    const { owedToUs, sendEventStep } = await import("@/lib/events");
    expect(owedToUs(e)).toBe(132_000);
    state.sent = [];
    await sendEventStep(e, "BALANCE_REMINDER");
    const reminder = to(contact.email)[0];
    expect(reminder.email.rows).toContainEqual(["Total", "£1,800.00"]);
    expect(reminder.email.rows).toContainEqual(["Left to pay", "£1,320.00"]);
    expect(JSON.stringify(reminder)).not.toMatch(/in cash/i);
  });

  it("keeps the bookings' VAT in step when staff change how the couple pay", async () => {
    const { q } = await makeProposal();
    const { done } = await sign(q.token!, q.id, "CASH");
    const { setPayPlan } = await import("@/actions/pay-plan");
    await setPayPlan(done.eventId, undefined as never, form({ payPlan: "FULL" }));
    expect((await prisma.booking.findFirstOrThrow({ where: { eventId: done.eventId } })).vatOnShare).toBe(false);
    await setPayPlan(done.eventId, undefined as never, form({ payPlan: "BALANCE_CASH" }));
    expect((await prisma.booking.findFirstOrThrow({ where: { eventId: done.eventId } })).vatOnShare).toBe(true);
  });

  it("won't send a proposal offering a cash balance until there's an address for cash, or one missing an act's fee", async () => {
    const { readyToSend, proposalInclude } = await import("@/lib/proposal-server");
    const { q } = await makeProposal();
    const full = await prisma.quote.findUniqueOrThrow({ where: { id: q.id }, include: proposalInclude });
    expect(readyToSend(full, "2027-01-01")).toBeNull();
    expect(readyToSend({ ...full, agency: { ...full.agency, settings: { ...full.agency.settings!, cashAddress: "" } } }, "2027-01-01")).toMatch(
      /address for cash payments/,
    );
    expect(
      readyToSend({ ...full, payOptions: ["TRANSFER"], agency: { ...full.agency, settings: { ...full.agency.settings!, cashAddress: "" } } }, "2027-01-01"),
    ).toBeNull();
    expect(readyToSend({ ...full, lines: full.lines.map((l) => ({ ...l, costMinor: null })) }, "2027-01-01")).toMatch(/^Put in the act's fee/);
  });

  it("offers both ways on a new wedding proposal, and on a new version of one sent before couples chose", async () => {
    const { createDraftProposal, newProposalVersion } = await import("@/lib/proposal-server");
    const user = { id: (state.user as { id: string }).id, agencyId };
    const contact = await prisma.contact.create({ data: { agencyId, name: "Ada Jones", email: `ada-${Date.now()}@paychoice.gigsaw.invalid`, type: "CLIENT" } });
    const draft = await createDraftProposal(user, { contactId: contact.id });
    expect(draft.payOptions).toEqual(["CASH", "TRANSFER"]);
    const { q } = await makeProposal();
    await prisma.quote.update({ where: { id: q.id }, data: { payOptions: [] } });
    const next = await newProposalVersion(user, q.id);
    expect(next.payOptions).toEqual(["CASH", "TRANSFER"]);
  });
});
