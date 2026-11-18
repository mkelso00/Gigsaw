import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// "Payment received" to customers, and "details updated" to acts when a wedding's plan changes.
// Database tests: TEST_DATABASE_URL only.

type Sent = { to: string; subject: string; email: { rows?: [string, string][]; intro?: string; highlight?: { label: string } } };
const state = vi.hoisted(() => ({ user: null as unknown, sent: [] as Sent[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/calendar-sync/queue", () => ({ queueCalendarSync: () => {} }));
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
const HOUR = 3_600_000;
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

describeDb("receipts and plan updates (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  const stamp = Date.now().toString(36);
  let n = 0;
  let act = "";
  const singerEmail = `sing-${stamp}@receipts.gigsaw.invalid`;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "receipts", { agencyName: "Receipt Test Music" });
    agencyId = t.agency.id;
    state.user = { ...t.admin, agencyId, role: "ADMIN", name: "Admin" };
    act = (await prisma.artist.create({ data: { agencyId, name: "Receipt Singer" } })).id;
    const person = await prisma.person.create({ data: { agencyId, firstName: "Rae", surname: "Singer", email: singerEmail } });
    await prisma.personAct.create({ data: { personId: person.id, artistId: act } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  const gig = async (data: Record<string, unknown> = {}) => {
    const setStart = new Date(Date.now() + 30 * 24 * HOUR + ++n * HOUR);
    return prisma.booking.create({
      data: {
        agencyId,
        reference: `RC-${n}-${stamp}`,
        artistId: act,
        status: "CONFIRMED",
        dealType: "BUY_SELL",
        feeMinor: 100_000,
        artistFeeMinor: 60_000,
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd: new Date(setStart.getTime() + 2 * HOUR),
        ...data,
      },
    });
  };

  it("tells a private customer their payment arrived, with what's left; never a venue; not when unticked", async () => {
    const { addPayment } = await import("@/actions/bookings");
    const client = await prisma.contact.create({ data: { agencyId, name: "Pat Jones", email: `pat-${stamp}@receipts.gigsaw.invalid`, type: "CLIENT" } });
    const venue = await prisma.contact.create({ data: { agencyId, name: "The Crown", email: `crown-${stamp}@receipts.gigsaw.invalid`, type: "PROMOTER" } });
    const mine = await gig({ promoterId: client.id });
    const bar = await gig({ promoterId: venue.id });
    state.sent = [];
    await addPayment(mine.id, undefined, form({ direction: "IN", kind: "DEPOSIT", amount: "250", receipt: "on" }));
    await addPayment(bar.id, undefined, form({ direction: "IN", kind: "BALANCE", amount: "1000", receipt: "on" }));
    await addPayment(mine.id, undefined, form({ direction: "IN", kind: "BALANCE", amount: "100" })); // box unticked
    expect(state.sent.map((m) => m.to)).toEqual([client.email]);
    expect(state.sent[0].subject).toBe("Payment received: £250.00");
    expect(state.sent[0].email.rows).toEqual(
      expect.arrayContaining([
        ["Paid so far", "£250.00"],
        ["Left to pay", "£750.00"],
      ]),
    );
  });

  it("sends a wedding's couple one receipt for a payment shared across the acts, and notes a payment straight to the band", async () => {
    const { recordEventPayment } = await import("@/actions/events");
    const { setPayPlan, markPaidDirect } = await import("@/actions/pay-plan");
    const couple = await prisma.contact.create({ data: { agencyId, name: "Hannah Smith", email: `hannah-${stamp}@receipts.gigsaw.invalid`, type: "CLIENT" } });
    const e = await prisma.event.create({ data: { agencyId, name: "Hannah & Sam's wedding", date: "2027-08-14", customerId: couple.id } });
    const b = await gig({ eventId: e.id, promoterId: couple.id, depositMinor: 40_000 });
    state.sent = [];
    await recordEventPayment(e.id, undefined, form({ amount: "400", kind: "DEPOSIT", receipt: "on" }));
    expect(state.sent.map((m) => m.to)).toEqual([couple.email]);
    expect(state.sent[0].email.rows).toEqual(expect.arrayContaining([["Left to pay", "£600.00"]]));
    await setPayPlan(e.id, undefined, form({ payPlan: "DEPOSIT_TRANSFER" }));
    state.sent = [];
    await markPaidDirect(b.id, undefined);
    expect(state.sent[0].to).toBe(couple.email);
    expect(state.sent[0].email.highlight?.label).toBe("Paid to Receipt Singer");
    expect(state.sent[0].email.rows).toEqual(expect.arrayContaining([["Left to pay", "Nothing: all paid"]]));
  });

  it("tells the acts what changed in the plan once the edits stop, and only once", async () => {
    const { runPlanUpdates, PLAN_QUIET_MS } = await import("@/lib/events");
    const e = await prisma.event.create({
      data: { agencyId, name: "Jo & Lee's wedding", date: "2027-09-04", dressCode: "Black tie", planToldActs: [["Dress code", "Black tie"]] },
    });
    await gig({ eventId: e.id });
    // The couple changes the dress code and adds a first dance: still within the quiet time, nothing yet.
    const now = new Date();
    await prisma.event.update({ where: { id: e.id }, data: { dressCode: "Smart casual", songRequests: "First dance: Golden Hour", planChangedAt: now } });
    state.sent = [];
    expect(await runPlanUpdates(now)).toBe(0);
    // After the quiet time: one email to the act, listing just what changed.
    const later = new Date(now.getTime() + PLAN_QUIET_MS + 1000);
    expect(await runPlanUpdates(later)).toBe(1);
    const mail = state.sent.filter((m) => m.to === singerEmail);
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe("Jo & Lee's wedding: details updated");
    expect(mail[0].email.rows?.map(([k]) => k).sort()).toEqual(["Dress code", "Song requests"]);
    expect(mail[0].email.rows).toEqual(expect.arrayContaining([["Dress code", "Smart casual"]]));
    // Nothing more until it changes again.
    expect(await runPlanUpdates(new Date(later.getTime() + PLAN_QUIET_MS * 2))).toBe(0);
  });
});
