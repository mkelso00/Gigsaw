import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// A wedding or event with several acts is one booking to the customer: they hear once, when every act in it
// is confirmed, not once per act. Database tests: TEST_DATABASE_URL only.

const state = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; email: { rows?: [string, string][] } }[] }));
vi.mock("server-only", () => ({}));
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

describeDb("telling the customer their booking is confirmed (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let n = 0;
  const email = `couple-${Date.now()}@confirm.gigsaw.invalid`;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    agencyId = (await createTestAgency(prisma, "confirm", { agencyName: "Confirm Test Music" })).agency.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  const toCustomer = () => state.sent.filter((m) => m.to === email);
  const gig = async (data: Record<string, unknown>) => {
    const act = await prisma.artist.create({ data: { agencyId, name: `Singer ${++n}` } });
    const setStart = new Date(Date.now() + 60 * 24 * HOUR + n * HOUR);
    return prisma.booking.create({
      data: {
        agencyId,
        reference: `CF-${n}-${Date.now()}`,
        artistId: act.id,
        status: "PENDING",
        eventType: "WEDDING",
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd: new Date(setStart.getTime() + HOUR),
        ...data,
      },
    });
  };
  const confirm = async (id: string) => {
    await prisma.booking.update({ where: { id }, data: { status: "CONFIRMED" } });
    const { onConfirmed } = await import("@/lib/confirmations");
    await onConfirmed(id);
  };

  it("sends one email for the whole wedding once every act is confirmed, listing them all", async () => {
    const customer = await prisma.contact.create({ data: { agencyId, name: "Hannah Smith", email, type: "CLIENT" } });
    const event = await prisma.event.create({ data: { agencyId, name: "Hannah & Sam's wedding", date: "2027-08-14", customerId: customer.id } });
    const a = await gig({ eventId: event.id, promoterId: customer.id });
    const b = await gig({ eventId: event.id, promoterId: customer.id });
    state.sent = [];

    await confirm(a.id);
    expect(toCustomer()).toHaveLength(0); // still waiting on the second singer

    await confirm(b.id);
    expect(toCustomer()).toHaveLength(1);
    const m = toCustomer()[0];
    expect(m.subject).toBe("Everyone's confirmed for Hannah & Sam's wedding");
    const names = (m.email.rows ?? []).map(([k]) => k);
    expect(names).toEqual(expect.arrayContaining(["Singer " + (n - 1), "Singer " + n]));

    // Confirmed again (e.g. a change and back): nothing more.
    await confirm(a.id);
    expect(toCustomer()).toHaveLength(1);
  });

  it("never tells the couple an act has arrived, even with arrival messages switched on", async () => {
    await prisma.settings.update({ where: { agencyId }, data: { clientArrivalMessages: true } });
    const couple = `arrive-${Date.now()}@confirm.gigsaw.invalid`;
    const customer = await prisma.contact.create({ data: { agencyId, name: "Jo Bloggs", email: couple, type: "CLIENT" } });
    const event = await prisma.event.create({ data: { agencyId, name: "Jo's wedding", date: "2027-09-04", customerId: customer.id } });
    const inWedding = await gig({ eventId: event.id, promoterId: customer.id, status: "CONFIRMED", notifyClientOnArrival: true });
    const weddingType = await gig({ promoterId: customer.id, status: "CONFIRMED", notifyClientOnArrival: true });
    const { notifyClientOfArrival } = await import("@/lib/alerts");
    state.sent = [];
    expect(await notifyClientOfArrival(inWedding.id)).toBe(false);
    expect(await notifyClientOfArrival(weddingType.id)).toBe(false);
    expect(state.sent.filter((m) => m.to === couple)).toHaveLength(0);
  });

  it("still tells a customer about a single booking that isn't part of a wedding or event", async () => {
    const solo = `solo-${Date.now()}@confirm.gigsaw.invalid`;
    const customer = await prisma.contact.create({ data: { agencyId, name: "Pat Jones", email: solo, type: "CLIENT" } });
    const g = await gig({ promoterId: customer.id });
    state.sent = [];
    await confirm(g.id);
    const mine = state.sent.filter((m) => m.to === solo);
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toMatch(/^Confirmed: Singer \d+ for your wedding$/);
  });
});
