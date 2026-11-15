import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Copying a booking to up to 300 dates: one transaction, numbers taken together and safely when
// someone else books at the same moment, times kept as clock times, calendars queued once.

describe("cleanDates", () => {
  it("keeps real days, once each, in order", async () => {
    vi.doMock("server-only", () => ({}));
    const { cleanDates } = await import("@/lib/copy-booking");
    expect(cleanDates(["2027-02-03", "2027-01-01", "2027-02-03", "nonsense", "2027-13-45"])).toEqual(["2027-01-01", "2027-02-03"]);
  });
});

const staff = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireStaff: async () => staff.user,
  requireAdmin: async () => staff.user,
}));

describeDb("copying a booking (database)", () => {
  type Db = (typeof import("@/lib/db"))["prisma"];
  let prisma: Db;
  let agencyId = "";
  let original = "";
  const DAY = 86_400_000;
  const dayKey = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

  beforeAll(async () => {
    prisma = (await import("@/lib/db")).prisma;
    const t = await createTestAgency(prisma, "copy");
    agencyId = t.agency.id;
    staff.user = t.user;
    // Demo act and venue: nothing is ever sent.
    const artist = await prisma.artist.create({ data: { agencyId, name: "Copy Cat", demo: true } });
    const venue = await prisma.venue.create({ data: { agencyId, name: "Copy Rooms", demo: true, timezone: "Europe/London" } });
    const { createBookingWithReference } = await import("@/lib/bookings");
    const { buildSchedule } = await import("@/lib/schedule");
    const b = await createBookingWithReference(agencyId, {
      ...buildSchedule(dayKey(3), { arrive: "18:30", setStart: "19:00", setEnd: "21:00" }, "Europe/London"),
      artistId: artist.id,
      venueId: venue.id,
      status: "CONFIRMED",
      timezone: "Europe/London",
      feeMinor: 25000,
      artistFeeMinor: 18000,
      vatPct: 20,
      notes: "Bring the small PA",
      demo: true,
    });
    original = b.id;
  });

  afterAll(async () => {
    await removeTestAgency(prisma, agencyId);
  });

  it("copies to 300 dates in one go, with numbers in date order and the clock times kept", async () => {
    const { copyBooking } = await import("@/actions/bookings");
    const { localTime, localDateKey } = await import("@/lib/time");
    const dates = Array.from({ length: 300 }, (_, i) => dayKey(7 * (i + 1)));
    const before = await prisma.booking.count({ where: { agencyId } });
    const started = Date.now();
    const res = await copyBooking(original, dates, "CONFIRMED", true);
    const took = Date.now() - started;
    expect(res.ok).toBe(true);
    expect(res.ids).toHaveLength(300);
    expect(res.message).toMatch(/^Copied to 300 dates as Confirmed\./);
    expect(await prisma.booking.count({ where: { agencyId } })).toBe(before + 300);
    // Batched: well within a few seconds, not one round trip after another per gig.
    expect(took).toBeLessThan(20_000);

    const copies = await prisma.booking.findMany({ where: { id: { in: res.ids } }, orderBy: { arriveBy: "asc" } });
    expect(copies.map((c) => localDateKey(c.arriveBy, c.timezone))).toEqual(dates);
    // Across every clock change in six years, still 18:30 / 19:00 / 21:00 in London.
    expect(new Set(copies.map((c) => `${localTime(c.arriveBy, c.timezone)} ${localTime(c.setStart, c.timezone)} ${localTime(c.setEnd!, c.timezone)}`))).toEqual(
      new Set(["18:30 19:00 21:00"]),
    );
    // Numbers follow on from each other, in date order.
    const nums = copies.map((c) => Number(c.reference.replace(/\D/g, "")));
    expect(nums).toEqual(nums.map((_, i) => nums[0] + i));
    expect(copies[0]).toMatchObject({ status: "CONFIRMED", feeMinor: 25000, artistFeeMinor: 18000, vatPct: 20, notes: "Bring the small PA", slotId: null });
  }, 60_000);

  it("refuses more than 300 dates, and nothing is made", async () => {
    const { copyBooking } = await import("@/actions/bookings");
    const before = await prisma.booking.count({ where: { agencyId } });
    const res = await copyBooking(
      original,
      Array.from({ length: 301 }, (_, i) => dayKey(4000 + i)),
      "PENDING",
      true,
    );
    expect(res).toMatchObject({ ok: false, message: "That's a lot of dates: copy up to 300 at once." });
    expect(await prisma.booking.count({ where: { agencyId } })).toBe(before);
  });

  it("takes numbers safely while other bookings are being made at the same moment", async () => {
    const { copyBooking } = await import("@/actions/bookings");
    const { createBookingWithReference } = await import("@/lib/bookings");
    const { buildSchedule } = await import("@/lib/schedule");
    const one = () =>
      createBookingWithReference(agencyId, {
        ...buildSchedule(dayKey(5), { arrive: "12:00", setStart: "12:00" }, "Europe/London"),
        status: "PENDING",
        timezone: "Europe/London",
        demo: true,
      });
    const [a, b, ...singles] = await Promise.all([
      copyBooking(
        original,
        Array.from({ length: 40 }, (_, i) => dayKey(3000 + i)),
        "PENDING",
        false,
      ),
      copyBooking(
        original,
        Array.from({ length: 40 }, (_, i) => dayKey(3100 + i)),
        "PENDING",
        false,
      ),
      one(),
      one(),
      one(),
    ]);
    expect(a.ids).toHaveLength(40);
    expect(b.ids).toHaveLength(40);
    expect(singles).toHaveLength(3);
    const refs = await prisma.booking.findMany({ where: { agencyId }, select: { reference: true } });
    expect(new Set(refs.map((r) => r.reference)).size).toBe(refs.length);
  }, 60_000);

  it("queues each new booking's calendars once", async () => {
    vi.resetModules();
    const queued: string[] = [];
    vi.doMock("@/lib/calendar-sync/queue", () => ({
      queueCalendarSync: (ids: string | string[]) => queued.push(...[ids].flat()),
      calendarQueueIdle: async () => {},
    }));
    const { copyBooking } = await import("@/actions/bookings");
    const res = await copyBooking(original, [dayKey(5000), dayKey(5007), dayKey(5014)], "PENDING", false);
    expect(queued.sort()).toEqual([...res.ids].sort());
    vi.doUnmock("@/lib/calendar-sync/queue");
  });
});
