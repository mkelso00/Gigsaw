import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { nextWeekday, slotRunsOn } from "@/lib/rota";
import { addDaysToKey } from "@/lib/time";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Weekly slots at venues (the Rota): they start on their own start date, several days can be set
// up in one go, and a slot can be stopped from a date or deleted when nothing was booked from it.
// Slots made before start and last dates existed have neither and run every week, as before.

describe("slotRunsOn", () => {
  it("runs every week with no dates", () => {
    expect(slotRunsOn({}, "2026-01-01")).toBe(true);
    expect(slotRunsOn({ startsOn: null, endsOn: null }, "2030-01-01")).toBe(true);
  });
  it("runs from its start date up to and including its last date", () => {
    const s = { startsOn: "2027-01-01", endsOn: "2027-03-31" };
    expect(slotRunsOn(s, "2026-12-31")).toBe(false);
    expect(slotRunsOn(s, "2027-01-01")).toBe(true);
    expect(slotRunsOn(s, "2027-03-31")).toBe(true);
    expect(slotRunsOn(s, "2027-04-01")).toBe(false);
  });
});

describe("nextWeekday", () => {
  it("finds the first of a weekday on or after a date", () => {
    // 1 January 2027 is a Friday.
    expect(nextWeekday("2027-01-01", 5)).toBe("2027-01-01");
    expect(nextWeekday("2027-01-01", 1)).toBe("2027-01-04");
    expect(nextWeekday("2027-01-01", 4)).toBe("2027-01-07");
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

describeDb("weekly slots at venues (database)", () => {
  type Db = (typeof import("@/lib/db"))["prisma"];
  let prisma: Db;
  let agencyId = "";
  let venueId = "";
  let artistId = "";
  let today = "";
  const empty = undefined as never;
  const form = (fields: Record<string, string | string[]>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
    return f;
  };
  const slotForm = (more: Record<string, string | string[]> = {}) => form({ startTime: "19:00", endTime: "21:00", fee: "150", label: "Solo", ...more });

  beforeAll(async () => {
    prisma = (await import("@/lib/db")).prisma;
    const t = await createTestAgency(prisma, "rota");
    agencyId = t.agency.id;
    staff.user = t.user;
    // Demo venue and act: nothing is sent.
    venueId = (await prisma.venue.create({ data: { agencyId, name: "Rota Bar", timezone: "Europe/London", demo: true } })).id;
    artistId = (await prisma.artist.create({ data: { agencyId, name: "Rota Singer", demo: true } })).id;
    const { localDateKey } = await import("@/lib/time");
    today = localDateKey(new Date(), "Europe/London");
  });

  afterAll(async () => {
    await removeTestAgency(prisma, agencyId);
  });

  const slotsOf = (where: object = {}) => prisma.venueSlot.findMany({ where: { agencyId, ...where }, orderBy: { weekday: "asc" } });

  it("sets up several days in one go from a start date, and none of them shows before it", async () => {
    const { createSlots } = await import("@/actions/slots");
    const { unfilledSlots } = await import("@/lib/unfilled");
    const start = addDaysToKey(today, 14);
    const res = await createSlots(venueId, empty, slotForm({ weekday: ["1", "3", "5"], startsOn: start, label: "Starts later" }));
    expect(res?.ok).toMatch(/^Added: every Mon, Wed, Fri from /);
    const made = await slotsOf({ label: "Starts later" });
    expect(made.map((s) => [s.weekday, s.startsOn, s.endsOn])).toEqual([
      [1, start, null],
      [3, start, null],
      [5, start, null],
    ]);
    const ids = new Set(made.map((s) => s.id));
    const needs = (await unfilledSlots(agencyId, "Europe/London", 28)).filter((n) => ids.has(n.slot.id));
    expect(needs.length).toBeGreaterThan(0);
    // Nothing asks for an act before the start date: this is what "it starts from this week" was.
    expect(needs.every((n) => n.date >= start)).toBe(true);
  });

  it("puts a new weekly slot's gigs in the calendar straight away, as Pending, from its start date", async () => {
    const { createSlots } = await import("@/actions/slots");
    const start = addDaysToKey(today, 10);
    const res = await createSlots(venueId, empty, slotForm({ weekday: ["2", "4"], startsOn: start, label: "In the calendar", fillCalendar: "on", fillWeeks: "6" }));
    expect(res?.ok).toMatch(/12 gigs are in the calendar now/);
    const made = await slotsOf({ label: "In the calendar" });
    const gigs = await prisma.booking.findMany({ where: { agencyId, slotId: { in: made.map((s) => s.id) } } });
    expect(gigs).toHaveLength(12);
    expect(gigs.every((g) => g.status === "PENDING" && !g.artistId)).toBe(true);
    const { localDateKey } = await import("@/lib/time");
    expect(gigs.every((g) => localDateKey(g.setStart, "Europe/London") >= start)).toBe(true);
    // Without the tick, nothing goes in the calendar.
    const none = await createSlots(venueId, empty, slotForm({ weekday: ["6"], startsOn: start, label: "Rota only" }));
    expect(none?.ok).not.toMatch(/in the calendar/);
    const rotaOnly = await slotsOf({ label: "Rota only" });
    expect(await prisma.booking.count({ where: { slotId: rotaOnly[0].id } })).toBe(0);
  });

  it("still runs every week for a slot with no dates (made before they existed)", async () => {
    const old = await prisma.venueSlot.create({
      data: { agencyId, venueId, weekday: 2, arriveTime: "18:30", startTime: "19:00", endTime: "21:00", label: "Old" },
    });
    const { unfilledSlots } = await import("@/lib/unfilled");
    const needs = (await unfilledSlots(agencyId, "Europe/London", 28)).filter((n) => n.slot.id === old.id);
    expect(needs.length).toBeGreaterThanOrEqual(4);
  });

  it("puts weekly slots in the calendar from the date chosen, never before a slot's start", async () => {
    const { bookRegulars } = await import("@/actions/slots");
    const res = await bookRegulars(empty, form({ from: today, weeks: "4", mode: "pending" }));
    expect(res?.ok).toMatch(/^Added \d+ bookings? to the calendar over 4 weeks from /);
    const later = await slotsOf({ label: "Starts later" });
    const gigs = await prisma.booking.findMany({ where: { slotId: { in: later.map((s) => s.id) } } });
    const { localDateKey } = await import("@/lib/time");
    expect(gigs.every((g) => localDateKey(g.arriveBy, g.timezone) >= later[0].startsOn!)).toBe(true);
  });

  it("refuses to book a slot on a date before it starts", async () => {
    const { assignSlot } = await import("@/actions/slots");
    const [s] = await slotsOf({ label: "Starts later" });
    const before = addDaysToKey(s.startsOn!, -7);
    expect(await assignSlot(s.id, before, empty, form({ artistId, mode: "confirm" }))).toEqual({ error: "This weekly slot isn't running on that date" });
  });

  it("starts a weekly slot from the rota on the chosen date and days, booking the first of each", async () => {
    const { addRotaGig } = await import("@/actions/slots");
    const { localDateKey } = await import("@/lib/time");
    // 1 January 2027 is a Friday; Monday and Thursday are ticked.
    const res = await addRotaGig(
      empty,
      form({
        venueId,
        date: "2027-01-01",
        repeat: "on",
        weekday: ["1", "4"],
        endsOn: "2027-06-30",
        startTime: "20:00",
        endTime: "22:00",
        label: "New year",
        artistId,
        mode: "confirm",
      }),
    );
    expect(res?.ok).toBe(
      "Weekly at Rota Bar: every Monday, Thursday from 1 Jan 2027 to 30 Jun 2027, 20:00–22:00. Booked Rota Singer for the first 2. The next 22 are in the calendar too, Pending (yellow) until an act is booked.",
    );
    const made = await slotsOf({ label: "New year" });
    expect(made.map((s) => [s.weekday, s.startsOn, s.endsOn, s.artistId])).toEqual([
      [1, "2027-01-01", "2027-06-30", artistId],
      [4, "2027-01-01", "2027-06-30", artistId],
    ]);
    const gigs = await prisma.booking.findMany({ where: { slotId: { in: made.map((s) => s.id) } }, orderBy: { arriveBy: "asc" } });
    // The first of each day is booked with the act; the next 11 weeks of each are in the calendar as Pending.
    const firsts = gigs.filter((g) => g.artistId);
    expect(firsts.map((g) => localDateKey(g.arriveBy, g.timezone))).toEqual(["2027-01-04", "2027-01-07"]);
    expect(firsts.every((g) => g.status === "CONFIRMED" && g.artistId === artistId)).toBe(true);
    const later = gigs.filter((g) => !g.artistId);
    expect(later).toHaveLength(22);
    expect(later.every((g) => g.status === "PENDING")).toBe(true);
  });

  it("stops a slot from a date: empty bookings after it archived, ones with an act kept", async () => {
    const { stopSlot } = await import("@/actions/slots");
    const { buildSchedule } = await import("@/lib/schedule");
    const { createBookingWithReference } = await import("@/lib/bookings");
    const slot = await prisma.venueSlot.create({
      data: { agencyId, venueId, weekday: 6, arriveTime: "18:30", startTime: "19:00", endTime: "21:00", label: "To stop" },
    });
    const gig = (date: string, withAct: boolean) =>
      createBookingWithReference(agencyId, {
        ...buildSchedule(date, { arrive: "18:30", setStart: "19:00", setEnd: "21:00" }, "Europe/London"),
        slotId: slot.id,
        venueId,
        artistId: withAct ? artistId : null,
        status: withAct ? "CONFIRMED" : "PENDING",
        timezone: "Europe/London",
        demo: true,
      });
    // Saturdays: 6, 13, 20 and 27 March 2027.
    const kept = await gig("2027-03-06", false);
    const emptyAfter = await gig("2027-03-13", false);
    const withAct = await gig("2027-03-20", true);
    const emptyLater = await gig("2027-03-27", false);

    const res = await stopSlot(slot.id, empty, form({ endsOn: "2027-03-06", archiveEmpty: "on" }));
    expect(res?.ok).toBe(
      "Stopped: the last one is 6 Mar 2027. 2 empty bookings after that archived. 1 booking after that is still in the calendar: cancel it on its page if it's off too.",
    );
    expect((await prisma.venueSlot.findUniqueOrThrow({ where: { id: slot.id } })).endsOn).toBe("2027-03-06");
    const state = async (id: string) => (await prisma.booking.findFirst({ where: { id, archivedAt: undefined } }))?.archivedAt ?? null;
    expect(await state(kept.id)).toBeNull();
    expect(await state(withAct.id)).toBeNull();
    expect(await state(emptyAfter.id)).not.toBeNull();
    expect(await state(emptyLater.id)).not.toBeNull();

    // It can't be deleted (a gig with an act was booked from it), only stopped. Empty Pending gigs don't count.
    const { deleteSlot } = await import("@/actions/slots");
    expect((await deleteSlot(slot.id, empty))?.error).toMatch(/^It has 1 booking made from it, so stop it from a date instead\.$/);
  });

  it("deletes a slot nothing was booked from, like one the old Every week made by mistake", async () => {
    const { deleteSlot } = await import("@/actions/slots");
    const slot = await prisma.venueSlot.create({ data: { agencyId, venueId, weekday: 7, arriveTime: "12:30", startTime: "13:00", endTime: "15:00" } });
    expect(await deleteSlot(slot.id, empty)).toEqual({ ok: "Deleted." });
    expect(await prisma.venueSlot.count({ where: { id: slot.id } })).toBe(0);
  });

  it("deletes a slot whose only gigs are the empty Pending ones it put in the calendar, and those go too", async () => {
    const { createSlots, deleteSlot } = await import("@/actions/slots");
    await createSlots(venueId, empty, slotForm({ weekday: ["7"], label: "Placeholders", fillCalendar: "on", fillWeeks: "4" }));
    const [slot] = await slotsOf({ label: "Placeholders" });
    expect(await prisma.booking.count({ where: { slotId: slot.id } })).toBe(4);
    expect(await deleteSlot(slot.id, empty)).toEqual({ ok: "Deleted." });
    expect(await prisma.booking.count({ where: { slotId: slot.id } })).toBe(0);
  });

  it("keeps a slot's dates when a form without date boxes saves it, and checks them when it has them", async () => {
    const { updateSlot } = await import("@/actions/slots");
    const [s] = await slotsOf({ label: "New year" });
    expect((await updateSlot(s.id, empty, slotForm({ label: "New year" })))?.ok).toMatch(/^Slot saved/);
    expect((await prisma.venueSlot.findUniqueOrThrow({ where: { id: s.id } })).startsOn).toBe("2027-01-01");
    expect((await updateSlot(s.id, empty, slotForm({ label: "New year", startsOn: "2027-02-01", endsOn: "2027-01-15" })))?.error).toBe(
      "The last date is before the start date",
    );
  });
});
