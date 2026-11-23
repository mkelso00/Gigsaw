import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Deleting test weddings for good (src/actions/events.ts deleteEvents / deleteEventFully): the wedding, its gigs
// (with their payments) and its proposals go; other weddings and other businesses' are untouched.

const staff = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireStaff: async () => staff.user,
  requireAdmin: async () => staff.user,
  requireUser: async () => staff.user,
}));

type Db = typeof import("@/lib/db");

describeDb("deleting weddings for good (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let otherAgencyId = "";
  let n = 0;

  const wedding = async (agency: string, name: string) => {
    const e = await prisma.event.create({ data: { agencyId: agency, name, type: "WEDDING", date: "2031-06-14", timezone: "Europe/London" } });
    const start = new Date(Date.UTC(2031, 5, 14, 19));
    const b = await prisma.booking.create({
      data: { agencyId: agency, eventId: e.id, reference: `DE-${++n}-${Date.now()}`, status: "CONFIRMED", arriveBy: start, setStart: start, feeMinor: 100_000 },
    });
    await prisma.payment.create({ data: { bookingId: b.id, direction: "IN", kind: "DEPOSIT", amountMinor: 20_000, paidAt: new Date() } });
    await prisma.quote.create({
      data: { agencyId: agency, number: `Q-${n}-${Date.now()}`, eventId: e.id, title: name, timezone: "Europe/London", currency: "GBP" },
    });
    return { event: e.id, booking: b.id };
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "delevents");
    agencyId = t.agency.id;
    staff.user = { ...t.user, role: "ADMIN" };
    otherAgencyId = (await createTestAgency(prisma, "delevents-other")).agency.id;
  });
  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await removeTestAgency(prisma, otherAgencyId);
    await prisma.$disconnect();
  });

  it("deletes the ticked weddings with their gigs, payments and proposals, and nothing else", async () => {
    const { deleteEvents } = await import("@/actions/events");
    const a = await wedding(agencyId, "Test wedding A");
    const b = await wedding(agencyId, "Test wedding B");
    const keep = await wedding(agencyId, "Real wedding");
    const theirs = await wedding(otherAgencyId, "Another business's wedding");
    const form = new FormData();
    for (const id of [a.event, b.event, theirs.event]) form.append("ids", id);
    await deleteEvents(form);

    expect(await prisma.event.count({ where: { id: { in: [a.event, b.event] } } })).toBe(0);
    expect(await prisma.booking.count({ where: { id: { in: [a.booking, b.booking] } } })).toBe(0);
    expect(await prisma.payment.count({ where: { bookingId: { in: [a.booking, b.booking] } } })).toBe(0);
    expect(await prisma.quote.count({ where: { eventId: { in: [a.event, b.event] } } })).toBe(0);
    // Untouched: the one not ticked, and another business's even when its id is sent.
    expect(await prisma.event.count({ where: { id: { in: [keep.event, theirs.event] } } })).toBe(2);
    expect(await prisma.booking.count({ where: { id: { in: [keep.booking, theirs.booking] } } })).toBe(2);
  });

  it("deletes one from its page the same way", async () => {
    const { deleteEventFully } = await import("@/actions/events");
    const w = await wedding(agencyId, "Test wedding C");
    await deleteEventFully(w.event);
    expect(await prisma.event.count({ where: { id: w.event } })).toBe(0);
    expect(await prisma.booking.count({ where: { id: w.booking } })).toBe(0);
  });
});
