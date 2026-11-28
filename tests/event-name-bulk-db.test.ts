import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Naming several bookings at once (Solo, Duo, Trio, Band) from Change selected bookings (src/lib/bulk.ts),
// and clearing it again. Database tests: TEST_DATABASE_URL only.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/calendar-sync/queue", () => ({ queueCalendarSync: () => {} }));
vi.mock("@/lib/messaging", async (load) => ({
  ...(await load<typeof import("@/lib/messaging")>()),
  sendEmail: async () => "SENT",
  sendSms: async () => "SENT",
  sendPush: async () => 0,
}));

type Db = typeof import("@/lib/db");
const HOUR = 3_600_000;

describeDb("event names on several bookings at once (database)", () => {
  let prisma: Db["prisma"];
  let t: Awaited<ReturnType<typeof createTestAgency>>;
  let n = 0;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    t = await createTestAgency(prisma, "eventname", { defaultTimezone: "Europe/London" });
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, t.agency.id);
    await prisma.$disconnect();
  });

  const gig = (eventName = "") => {
    const setStart = new Date(Date.now() + (10 + ++n) * 24 * HOUR);
    return prisma.booking.create({
      data: {
        agencyId: t.agency.id,
        reference: `EN-${n}-${Date.now()}`,
        status: "CONFIRMED",
        eventName,
        timezone: "Europe/London",
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd: new Date(setStart.getTime() + 2 * HOUR),
        feeMinor: 20_000,
      },
    });
  };
  const nameOf = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id } })).eventName;

  it("sets the event name on every ticked booking and leaves their times and money alone", async () => {
    const { applyBulkChange } = await import("@/lib/bulk");
    const a = await gig();
    const b = await gig("Old name");
    const res = await applyBulkChange(t.user as never, [a.id, b.id], { eventName: " Duo ", notifyArtists: false });
    expect(res.updated).toBe(2);
    expect(await nameOf(a.id)).toBe("Duo");
    expect(await nameOf(b.id)).toBe("Duo");
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.setStart.getTime()).toBe(a.setStart.getTime());
    expect(after.feeMinor).toBe(20_000);
    expect(await prisma.activity.count({ where: { entityId: a.id, detail: "event name" } })).toBe(1);
  });

  it("clears it when asked, and still says when there's nothing to change", async () => {
    const { applyBulkChange } = await import("@/lib/bulk");
    const a = await gig("Band");
    await applyBulkChange(t.user as never, [a.id], { eventName: "", notifyArtists: false });
    expect(await nameOf(a.id)).toBe("");
    await expect(applyBulkChange(t.user as never, [a.id], { notifyArtists: false })).rejects.toThrow(/Nothing to change/);
  });
});
