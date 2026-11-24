import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Editing one booking and copying the changes to the venue's other upcoming bookings (lib/venue-change.ts).
// Makes and removes its own businesses, so it only runs against the test database:
//   TEST_DATABASE_URL=postgresql://…/gigsaw_test npx vitest run tests/venue-change-db.test.ts

vi.mock("server-only", () => ({}));
// Messages are counted rather than sent, and calendar syncs are counted rather than run.
const sent = vi.hoisted(() => ({ emails: [] as { bookingId?: string; to: string }[], syncs: [] as string[] }));
vi.mock("@/lib/messaging", async (load) => ({
  ...(await load<typeof import("@/lib/messaging")>()),
  sendEmail: async (m: { bookingId?: string; to: string }) => {
    sent.emails.push({ bookingId: m.bookingId, to: m.to });
  },
  sendSms: async () => {},
  sendPush: async () => {},
}));
vi.mock("@/lib/calendar-sync/queue", () => ({
  queueCalendarSync: (ids: string | string[]) => {
    sent.syncs.push(...(typeof ids === "string" ? [ids] : ids));
  },
}));

const DAY = 86_400_000;
const TZ = "Europe/London";

/** "YYYY-MM-DD" for a UTC date. */
const key = (d: Date) => d.toISOString().slice(0, 10);

/** Next year's spring clock change (last Sunday in March, GMT to BST), so the dates are always ahead. */
function springForward() {
  const year = new Date().getUTCFullYear() + 1;
  const d = new Date(Date.UTC(year, 2, 31));
  d.setUTCDate(31 - d.getUTCDay());
  return d;
}

describeDb("copying a booking's changes to the venue's other bookings (database)", () => {
  let prisma: (typeof import("@/lib/db"))["prisma"];
  let vc: typeof import("@/lib/venue-change");
  let parseBookingForm: (typeof import("@/lib/bookings"))["parseBookingForm"];
  let buildSchedule: (typeof import("@/lib/schedule"))["buildSchedule"];
  let localTime: (typeof import("@/lib/time"))["localTime"];
  let localDateKey: (typeof import("@/lib/time"))["localDateKey"];
  let t: Awaited<ReturnType<typeof createTestAgency>>;
  let other: Awaited<ReturnType<typeof createTestAgency>>;
  let venueId = "";
  let elsewhere = "";
  let actA = "";
  let actB = "";
  let ref = 0;

  // Wednesdays either side of the clock change, and a Thursday.
  const sunday = springForward();
  const wedGmt = key(new Date(sunday.getTime() - 4 * DAY));
  const wedBst = key(new Date(sunday.getTime() + 3 * DAY));
  const wedBst2 = key(new Date(sunday.getTime() + 10 * DAY));
  const thuBst = key(new Date(sunday.getTime() + 4 * DAY));

  /** A gig on a local date with local times, like one saved from the form. */
  const gig = async (date: string, over: Record<string, unknown> = {}, times = { arrive: "19:30", setStart: "20:00", setEnd: "22:00" }) =>
    prisma.booking.create({
      data: {
        agencyId: t.agency.id,
        reference: `VC-${++ref}`,
        artistId: actA,
        venueId,
        status: "CONFIRMED",
        timezone: TZ,
        ...buildSchedule(date, times, TZ),
        feeMinor: 20000,
        artistFeeMinor: 15000,
        travel: "Train to Leeds",
        accommodation: `Hotel ${ref}`,
        ...over,
      },
      include: { venue: { select: { name: true } } },
    });

  /** The edit form as the browser sends it for a booking, with some fields changed. */
  const formFor = (b: Awaited<ReturnType<typeof gig>>, changes: Record<string, string>) => {
    const f = new FormData();
    const fields: Record<string, string> = {
      artistId: b.artistId ?? "",
      venueId: b.venueId ?? "",
      status: b.status,
      eventType: b.eventType,
      date: localDateKey(b.arriveBy, TZ),
      arriveTime: localTime(b.arriveBy, TZ),
      setStartTime: localTime(b.setStart, TZ),
      setEndTime: b.setEnd ? localTime(b.setEnd, TZ) : "",
      soundcheckTime: "",
      dealType: "BUY_SELL",
      currency: b.currency,
      fee: (b.feeMinor / 100).toFixed(2),
      artistFee: b.artistFeeMinor === null ? "" : (b.artistFeeMinor / 100).toFixed(2),
      vatPct: String(b.vatPct),
      commissionPct: String(b.commissionPct),
      // A browser sends a textarea's new lines as \r\n.
      travel: b.travel.replace(/\n/g, "\r\n"),
      accommodation: b.accommodation,
      dayContact: b.dayContact,
      hospitality: b.hospitality,
      notes: b.notes,
      dealNotes: b.dealNotes,
      tags: b.tags,
      ...changes,
    };
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  /** What updateBooking does: save this booking, then copy the change to the others. */
  const save = async (
    b: Awaited<ReturnType<typeof gig>>,
    changes: Record<string, string>,
    scope: "ALL" | "WEEKDAY" | "SLOT" | "WEEKDAY_SLOT",
    notify = true,
  ) => {
    const settings = await prisma.settings.findUniqueOrThrow({ where: { agencyId: t.agency.id } });
    const data = await parseBookingForm(formFor(b, changes), settings, t.agency.id);
    const plan = await vc.planVenueChange(b, data, scope);
    // The start time before this save: which slot "the same time" means.
    await prisma.booking.update({ where: { id: b.id }, data });
    const opts = { scope, venueName: "The Swan", weekday: vc.weekdayName(b), startTime: localTime(b.setStart, TZ), notify };
    const res = await vc.applyVenuePlan(t.user as never, b.id, plan, opts);
    return { plan, res, confirm: vc.venueConfirm(plan, opts) };
  };

  const reload = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } });
  const clock = (d: Date | null) => (d ? localTime(d, TZ) : null);

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    vc = await import("@/lib/venue-change");
    ({ parseBookingForm } = await import("@/lib/bookings"));
    ({ buildSchedule } = await import("@/lib/schedule"));
    ({ localTime, localDateKey } = await import("@/lib/time"));
    t = await createTestAgency(prisma, "venuechange");
    other = await createTestAgency(prisma, "venuechange-other");
    const agencyId = t.agency.id;
    actA = (await prisma.artist.create({ data: { agencyId, name: "Act A", email: "act-a@gigsaw.invalid" } })).id;
    actB = (await prisma.artist.create({ data: { agencyId, name: "Act B", email: "act-b@gigsaw.invalid" } })).id;
    venueId = (await prisma.venue.create({ data: { agencyId, name: "The Swan", timezone: TZ } })).id;
    elsewhere = (await prisma.venue.create({ data: { agencyId, name: "The Crown", timezone: TZ } })).id;
  });

  beforeEach(async () => {
    // Each test starts with the venue empty.
    await prisma.booking.deleteMany({ where: { agencyId: { in: [t.agency.id, other.agency.id] } } });
    await prisma.activity.deleteMany({ where: { agencyId: t.agency.id } });
    sent.emails = [];
    sent.syncs = [];
  });

  afterAll(async () => {
    await removeTestAgency(prisma, t?.agency.id);
    await removeTestAgency(prisma, other?.agency.id);
    await prisma.$disconnect();
  });

  it("copies only the fields that changed, and not the act, date or status", async () => {
    const source = await gig(wedGmt, { dayContact: "Sam 0700" });
    const target = await gig(wedBst, { artistId: actB, status: "AWAITING", dayContact: "Jo 0711", hospitality: "Two drinks" });
    const settings = await prisma.settings.findUniqueOrThrow({ where: { agencyId: t.agency.id } });
    const data = await parseBookingForm(formFor(source, { setStartTime: "21:00", travel: "Park round the back" }), settings, t.agency.id);
    expect(vc.changedForVenue(source, data).labels).toEqual(["start time", "travel"]);

    const { confirm, res } = await save(source, { setStartTime: "21:00", travel: "Park round the back" }, "ALL");
    expect(confirm.title).toBe("Change start time and travel on 1 other upcoming booking at The Swan?");
    expect(confirm.button).toBe("Change 2 bookings");
    expect(res.updated).toBe(1);

    const after = await reload(target.id);
    expect(after.travel).toBe("Park round the back");
    expect(clock(after.setStart)).toBe("21:00");
    // Its own arrive by, finish, contacts, act, status and date stay.
    expect(clock(after.arriveBy)).toBe("19:30");
    expect(clock(after.setEnd)).toBe("22:00");
    expect(after.dayContact).toBe("Jo 0711");
    expect(after.hospitality).toBe("Two drinks");
    expect(after.accommodation).toBe(target.accommodation);
    expect(after.artistId).toBe(actB);
    expect(after.status).toBe("AWAITING");
    expect(localDateKey(after.arriveBy, TZ)).toBe(wedBst);
    expect(after.feeMinor).toBe(20000);
    expect(after.artistFeeMinor).toBe(15000);
  });

  it("finds nothing to copy when only the status or name changed, and doesn't count an untouched textarea as changed", async () => {
    const source = await gig(wedGmt, { travel: "Line one\nLine two" });
    const settings = await prisma.settings.findUniqueOrThrow({ where: { agencyId: t.agency.id } });
    const data = await parseBookingForm(formFor(source, { status: "HOLD", eventName: "Spring" }), settings, t.agency.id);
    expect(vc.changedForVenue(source, data).labels).toEqual([]);
  });

  it("with two sets a night (5 till 7 and 9 till 11), changing the 5pm gig's times reaches only the 5pm gigs", async () => {
    const early = { arrive: "16:30", setStart: "17:00", setEnd: "19:00" };
    const late = { arrive: "20:30", setStart: "21:00", setEnd: "23:00" };
    const source = await gig(wedBst, {}, early);
    const sameNightLate = await gig(wedBst, {}, late);
    const nextWedEarly = await gig(wedBst2, {}, early);
    const nextWedLate = await gig(wedBst2, {}, late);
    const thuEarly = await gig(thuBst, {}, early);

    expect(await vc.venueScopeCounts(source)).toMatchObject({ all: 4, weekday: 3, slot: 2, weekdaySlot: 1, startTime: "17:00" });
    expect((await vc.venueTargets(source, "SLOT")).map((b) => b.id).sort()).toEqual([nextWedEarly.id, thuEarly.id].sort());
    expect((await vc.venueTargets(source, "WEEKDAY_SLOT")).map((b) => b.id)).toEqual([nextWedEarly.id]);

    const { confirm } = await save(source, { setStartTime: "17:30", setEndTime: "19:30" }, "SLOT");
    expect(confirm.title).toBe("Change start time and finish time on 2 other upcoming 17:00 gigs at The Swan?");
    for (const b of [nextWedEarly, thuEarly]) {
      const after = await reload(b.id);
      expect([clock(after.setStart), clock(after.setEnd)]).toEqual(["17:30", "19:30"]);
    }
    // The 9pm sets are left exactly as they were.
    for (const b of [sameNightLate, nextWedLate]) {
      const after = await reload(b.id);
      expect([clock(after.setStart), clock(after.setEnd)]).toEqual(["21:00", "23:00"]);
    }
  });

  it("reaches all upcoming bookings or only the same weekday, skipping past, cancelled, settled, archived, other venues and other agencies", async () => {
    const source = await gig(wedGmt);
    const wed = await gig(wedBst);
    const wed2 = await gig(wedBst2);
    const thu = await gig(thuBst);
    const skipped = await Promise.all([
      gig(key(new Date(Date.now() - 7 * DAY))),
      gig(wedBst, { status: "CANCELLED" }),
      gig(wedBst, { status: "SETTLED" }),
      gig(wedBst, { archivedAt: new Date() }),
      gig(wedBst, { venueId: elsewhere }),
      // Another business's booking pointing at this venue must never be touched.
      prisma.booking.create({
        data: { agencyId: other.agency.id, reference: "VC-OTHER", venueId, timezone: TZ, ...buildSchedule(wedBst, { arrive: "19:30", setStart: "20:00" }, TZ) },
        include: { venue: { select: { name: true } } },
      }),
    ]);

    expect(await vc.venueScopeCounts(source)).toEqual({ all: 3, weekday: 2, slot: 3, weekdaySlot: 2, weekdayName: "Wednesday", startTime: "20:00" });
    expect((await vc.venueTargets(source, "ALL")).map((b) => b.id).sort()).toEqual([wed.id, wed2.id, thu.id].sort());
    expect((await vc.venueTargets(source, "WEEKDAY")).map((b) => b.id).sort()).toEqual([wed.id, wed2.id].sort());

    const { confirm } = await save(source, { notes: "New door code 4321" }, "WEEKDAY");
    expect(confirm.title).toBe("Change internal notes on 2 other upcoming Wednesdays at The Swan?");
    expect((await reload(wed.id)).notes).toBe("New door code 4321");
    expect((await reload(wed2.id)).notes).toBe("New door code 4321");
    expect((await reload(thu.id)).notes).toBe("");
    for (const s of skipped) {
      const now = await reload(s.id);
      expect(now.notes).toBe("");
      expect(now.updatedAt.getTime()).toBe(s.updatedAt.getTime());
    }
    // Calendars follow for each changed booking, and only those.
    expect(sent.syncs.sort()).toEqual([wed.id, wed2.id].sort());
  });

  it("sets times as clock times on each booking's own date, across the change to British Summer Time", async () => {
    const source = await gig(wedGmt);
    const target = await gig(wedBst, {}, { arrive: "18:00", setStart: "19:00", setEnd: "21:00" });
    await save(source, { setStartTime: "21:00", setEndTime: "23:30", soundcheckTime: "20:00" }, "WEEKDAY");
    const after = await reload(target.id);
    expect([clock(after.arriveBy), clock(after.soundcheckAt), clock(after.setStart), clock(after.setEnd)]).toEqual(["18:00", "20:00", "21:00", "23:30"]);
    // 21:00 in summer time is 20:00 UTC; in winter (the source) it's 21:00 UTC.
    expect(after.setStart.toISOString()).toBe(`${wedBst}T20:00:00.000Z`);
    expect((await reload(source.id)).setStart.toISOString()).toBe(`${wedGmt}T21:00:00.000Z`);
  });

  it("keeps a booking's times when the new start would push it into the next day", async () => {
    const source = await gig(wedGmt, {}, { arrive: "17:00", setStart: "20:00", setEnd: "22:00" });
    const late = await gig(wedBst, {}, { arrive: "19:00", setStart: "20:00", setEnd: "22:00" });
    // 18:00 is fine for the source (arrives 17:00) but before the other booking's own 19:00 arrival.
    const { plan, confirm } = await save(source, { setStartTime: "18:00" }, "ALL");
    expect(plan.timesKept).toEqual([late.reference]);
    expect(confirm.items.join(" ")).toContain(`${late.reference} keep their times`);
    expect(clock((await reload(late.id)).setStart)).toBe("20:00");
  });

  it("tells each act once per changed booking, and only about time changes", async () => {
    const source = await gig(wedGmt);
    const a = await gig(wedBst);
    const b = await gig(wedBst2, { artistId: actB });
    const { res } = await save(source, { setStartTime: "20:30" }, "ALL");
    expect(res.notified).toBe(2);
    // The booking being edited is told by the edit itself (updateBooking), never by the copy.
    expect(sent.emails.map((e) => e.bookingId).sort()).toEqual([a.id, b.id].sort());
    expect(sent.emails.filter((e) => e.to === "act-a@gigsaw.invalid")).toHaveLength(1);

    sent.emails = [];
    const fresh = await reload(source.id);
    await save({ ...fresh, venue: { name: "The Swan" } }, { hospitality: "Rider in the green room" }, "ALL");
    expect(sent.emails).toEqual([]);

    sent.emails = [];
    await save({ ...(await reload(source.id)), venue: { name: "The Swan" } }, { setStartTime: "21:00" }, "ALL", false);
    expect(sent.emails).toEqual([]);
  });

  it("copies sale and cost only to bookings in the same currency with no payments logged", async () => {
    const source = await gig(wedGmt);
    const plain = await gig(wedBst, { dealType: "STANDARD_COMMISSION", artistFeeMinor: null });
    const paid = await gig(wedBst);
    await prisma.payment.create({ data: { bookingId: paid.id, direction: "IN", kind: "DEPOSIT", amountMinor: 5000, paidAt: new Date() } });
    const euros = await gig(wedBst, { currency: "EUR" });
    const { plan, confirm } = await save(source, { fee: "250.00", artistFee: "180.00" }, "ALL");
    expect(plan.change.labels).toEqual(["sale", "cost"]);
    expect(plan.moneyKept).toBe(2);
    expect(confirm.items.join(" ")).toContain("Sale and cost stay as they are on 2 bookings");
    const p = await reload(plain.id);
    expect([p.feeMinor, p.artistFeeMinor, p.dealType]).toEqual([25000, 18000, "BUY_SELL"]);
    for (const id of [paid.id, euros.id]) {
      const kept = await reload(id);
      expect([kept.feeMinor, kept.artistFeeMinor]).toEqual([20000, 15000]);
    }
  });

  it("logs one activity entry for the batch, on the booking that was edited", async () => {
    const source = await gig(wedGmt);
    const others = await Promise.all([gig(wedBst), gig(wedBst2), gig(thuBst)]);
    await save(source, { travel: "Parking: use the yard" }, "ALL");
    const entries = await prisma.activity.findMany({ where: { agencyId: t.agency.id, action: "changed other bookings too" } });
    expect(entries).toHaveLength(1);
    expect(entries[0].entityId).toBe(source.id);
    expect(entries[0].detail).toBe("travel on 3 upcoming bookings at The Swan");
    expect(await prisma.activity.count({ where: { entityId: { in: others.map((o) => o.id) } } })).toBe(0);
  });
});
