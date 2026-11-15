import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { weeklyDates } from "@/lib/rota";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// "Repeat every week" on the quick New booking form makes real bookings on the same day every
// week from the chosen date (not a weekly slot at the venue).

describe("weeklyDates", () => {
  it("counts weeks from the first date", () => {
    expect(weeklyDates("2027-01-01", { weeks: 3, max: 300 })).toEqual({ dates: ["2027-01-01", "2027-01-08", "2027-01-15"], more: false });
  });
  it("stops at the last date, which counts when it falls on the day", () => {
    expect(weeklyDates("2027-01-01", { until: "2027-01-15", max: 300 }).dates).toEqual(["2027-01-01", "2027-01-08", "2027-01-15"]);
    expect(weeklyDates("2027-01-01", { until: "2027-01-14", max: 300 }).dates).toEqual(["2027-01-01", "2027-01-08"]);
    // Both: whichever comes first.
    expect(weeklyDates("2027-01-01", { weeks: 2, until: "2027-03-01", max: 300 }).dates).toHaveLength(2);
  });
  it("says when the limit cut it short", () => {
    expect(weeklyDates("2027-01-01", { until: "2040-01-01", max: 300 })).toMatchObject({ more: true });
    expect(weeklyDates("2027-01-01", { until: "2040-01-01", max: 300 }).dates).toHaveLength(300);
    expect(weeklyDates("2027-01-01", { weeks: 300, max: 300 }).more).toBe(false);
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

describeDb("Repeat every week on a quick booking (database)", () => {
  type Db = (typeof import("@/lib/db"))["prisma"];
  let prisma: Db;
  let agencyId = "";
  let venueId = "";
  let artistId = "";
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    return f;
  };
  const quick = async (fields: Record<string, string>) => {
    const { addRotaGig } = await import("@/actions/slots");
    return addRotaGig(undefined, form({ venueId, startTime: "19:00", endTime: "21:00", fee: "200", cost: "150", currency: "GBP", weekly: "on", ...fields }));
  };

  beforeAll(async () => {
    prisma = (await import("@/lib/db")).prisma;
    const t = await createTestAgency(prisma, "weekly", { defaultVatPct: 20 });
    agencyId = t.agency.id;
    staff.user = t.user;
    // Demo act and venue, so nothing is sent.
    venueId = (await prisma.venue.create({ data: { agencyId, name: "Weekly Tavern", timezone: "Europe/London", demo: true } })).id;
    artistId = (await prisma.artist.create({ data: { agencyId, name: "Every Saturday Duo", demo: true } })).id;
  });

  afterAll(async () => {
    await removeTestAgency(prisma, agencyId);
  });

  it("makes a booking every week from the chosen date, at the same clock time across the clocks going forward", async () => {
    const { localDateKey, localTime } = await import("@/lib/time");
    // Clocks go forward in the UK on 28 March 2027.
    const res = await quick({ date: "2027-03-13", weeks: "4", artistId, mode: "confirm" });
    expect(res?.ok).toMatch(/^Booked Every Saturday Duo at Weekly Tavern, 4 bookings, every Saturday from 13 Mar 2027 to 3 Apr 2027 \(GS-\d+ to GS-\d+\)\.$/);
    const made = await prisma.booking.findMany({ where: { agencyId, artistId }, orderBy: { arriveBy: "asc" } });
    expect(made.map((b) => localDateKey(b.arriveBy, b.timezone))).toEqual(["2027-03-13", "2027-03-20", "2027-03-27", "2027-04-03"]);
    expect(made.map((b) => `${localTime(b.setStart, b.timezone)}–${localTime(b.setEnd!, b.timezone)}`)).toEqual(Array(4).fill("19:00–21:00"));
    expect(made.map((b) => b.arriveBy.toISOString())).toEqual([
      "2027-03-13T18:30:00.000Z",
      "2027-03-20T18:30:00.000Z",
      "2027-03-27T18:30:00.000Z",
      // British Summer Time: 18:30 in London is 17:30 UTC.
      "2027-04-03T17:30:00.000Z",
    ]);
    for (const b of made) {
      expect(b).toMatchObject({ status: "CONFIRMED", venueId, feeMinor: 20000, artistFeeMinor: 15000, dealType: "BUY_SELL", vatPct: 20, slotId: null });
    }
    // Not a weekly slot at the venue: nothing will ask about it every week.
    expect(await prisma.venueSlot.count({ where: { agencyId } })).toBe(0);
  });

  it("runs until a last date instead, and with no act they're Pending", async () => {
    const res = await quick({ date: "2027-06-02", until: "2027-06-30", weeks: "" });
    expect(res?.ok).toMatch(/^Added 5 bookings at Weekly Tavern, every Wednesday from 2 Jun 2027 to 30 Jun 2027 .*: Pending, each needs an act\.$/);
    const made = await prisma.booking.findMany({ where: { agencyId, artistId: null, arriveBy: { gte: new Date("2027-06-01") } } });
    expect(made).toHaveLength(5);
    expect(made.every((b) => b.status === "PENDING")).toBe(true);
  });

  it("defaults to 12 weeks, refuses more than 300, and a last date before the first", async () => {
    const before = await prisma.booking.count({ where: { agencyId } });
    expect((await quick({ date: "2028-01-05" }))?.ok).toMatch(/^Added 12 bookings/);
    expect(await prisma.booking.count({ where: { agencyId } })).toBe(before + 12);
    expect((await quick({ date: "2028-01-05", weeks: "301" }))?.error).toMatch(/more than 300 weeks/);
    expect((await quick({ date: "2028-01-05", until: "2040-01-01", weeks: "" }))?.error).toMatch(/more than 300 weeks/);
    expect((await quick({ date: "2028-01-05", until: "2027-12-01" }))?.error).toBe("The last date is before the first one");
    expect(await prisma.booking.count({ where: { agencyId } })).toBe(before + 12);
  });

  it("asks first when the act is already booked on some of the dates, listing them", async () => {
    // Already booked on 13 and 20 Mar 2027 by the first test.
    const res = await quick({ date: "2027-03-06", weeks: "3", artistId, mode: "confirm" });
    expect(res?.confirm?.title).toBe("Hold on: Every Saturday Duo may not be free on 2 of the 3 dates");
    expect(res?.confirm?.items).toEqual(["Sat, 13 Mar 2027", "Sat, 20 Mar 2027"]);
    const anyway = await quick({ date: "2027-03-06", weeks: "3", artistId, mode: "confirm", confirmed: "yes" });
    expect(anyway?.ok).toMatch(/3 bookings/);
  });

  it("without Repeat every week, still one booking", async () => {
    const before = await prisma.booking.count({ where: { agencyId } });
    const { addRotaGig } = await import("@/actions/slots");
    const res = await addRotaGig(undefined, form({ venueId, date: "2029-05-05", startTime: "19:00", endTime: "21:00", weeks: "12", until: "2029-08-01" }));
    expect(res?.ok).toMatch(/^Added at Weekly Tavern/);
    expect(await prisma.booking.count({ where: { agencyId } })).toBe(before + 1);
  });
});
