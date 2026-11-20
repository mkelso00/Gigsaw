import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Making act invoices when the week is signed off (Settings.actInvoiceMode SIGN_OFF, the default): nothing is made
// when a gig ends or the act checks out; signing off the week in the pay run makes the played gigs' invoices,
// leaves out unticked ones with their reason logged, and picks up gigs waiting for details or confirmation later.
// Gigs added or edited after sign-off wait to be signed off too. Automatic mode carries on as before.
//   TEST_DATABASE_URL=postgresql://…/gigsaw_test npx vitest run tests/pay-run-signoff-db.test.ts

const staff = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireStaff: async () => staff.user,
  requireAdmin: async () => staff.user,
  requireUser: async () => staff.user,
}));
vi.mock("@/lib/calendar-sync/queue", () => ({ queueCalendarSync: () => {} }));

const WEEK = "2026-06-15";
const at = (iso: string) => new Date(iso);
const HOUR = 3_600_000;

describeDb("signing off the week (database)", () => {
  let prisma: (typeof import("@/lib/db"))["prisma"];
  let lib: typeof import("@/lib/act-invoices");
  let server: typeof import("@/lib/pay-run-server");
  let actions: typeof import("@/actions/pay-run");
  let agencyId = "";
  let autoAgencyId = "";
  let ref = 0;
  const empty = undefined as never;
  const tz = "Europe/London";
  const details = { address: "1 High St", bankAccountName: "PAYEE", bankSortCode: "12-34-56", bankAccountNumber: "12345678", detailsCompletedAt: new Date() };
  const makeAct = (name: string, over: Record<string, unknown> = {}, agency = agencyId) =>
    prisma.artist.create({ data: { agencyId: agency, name, ...details, ...over } });
  const makeGig = (artistId: string, setStart: Date, over: Record<string, unknown> = {}, agency = agencyId) =>
    prisma.booking.create({
      data: {
        agencyId: agency,
        reference: `SO-${++ref}`,
        artistId,
        status: "CONFIRMED",
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd: new Date(setStart.getTime() + 2 * HOUR),
        feeMinor: 50_000,
        artistFeeMinor: 30_000,
        ...over,
      },
    });
  const live = (bookingId: string) => prisma.actInvoice.findUnique({ where: { liveBookingId: bookingId } });
  const form = (fields: Record<string, string | string[]>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
    return f;
  };
  const week = (w = WEEK) => server.payRunWeek(agencyId, w, { timeZone: tz, business: "Suave Agency" });
  const gig = async (id: string) => (await week()).gigs.find((g) => g.id === id)!;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    lib = await import("@/lib/act-invoices");
    server = await import("@/lib/pay-run-server");
    actions = await import("@/actions/pay-run");
    // No mode given: a new business signs off its weeks.
    const a = await createTestAgency(prisma, "signoff", { agencyName: "Suave Agency", agencyEmail: "" });
    agencyId = a.agency.id;
    staff.user = { ...a.user, name: "Lucy" };
    autoAgencyId = (await createTestAgency(prisma, "signoff-auto", { actInvoiceMode: "AUTO" })).agency.id;
  });

  afterAll(async () => {
    await removeTestAgency(prisma, agencyId);
    await removeTestAgency(prisma, autoAgencyId);
    await prisma.$disconnect();
  });

  it("makes nothing when a gig ends or the act checks out", async () => {
    expect((await prisma.settings.findUniqueOrThrow({ where: { agencyId } })).actInvoiceMode).toBe("SIGN_OFF");
    const act = await makeAct("Recent Act");
    const b = await makeGig(act.id, new Date(Date.now() - 4 * HOUR));
    await prisma.checkIn.create({ data: { bookingId: b.id, artistId: act.id, kind: "DEPARTED" } });
    await lib.runActInvoices();
    expect(await lib.issueActInvoice(b.id, { auto: true })).toEqual({ skipped: lib.NOT_SIGNED_OFF });
    expect(await live(b.id)).toBeNull();
    // Pay acts says why.
    expect((await lib.uninvoicedGigs(agencyId)).find((r) => r.booking.id === b.id)).toMatchObject({ reason: lib.NOT_SIGNED_OFF, canMake: false });
  });

  it("automatic mode still makes it as soon as the gig is over", async () => {
    const act = await makeAct("Auto Act", {}, autoAgencyId);
    const b = await makeGig(act.id, new Date(Date.now() - 4 * HOUR), {}, autoAgencyId);
    expect(await lib.issueActInvoice(b.id, { auto: true })).toHaveProperty("number");
    const later = await makeGig(act.id, new Date(Date.now() - 5 * HOUR), {}, autoAgencyId);
    await lib.runActInvoices();
    expect(await live(later.id)).not.toBeNull();
  });

  let played = "";
  let noShow = "";
  let waiting = "";
  let pending = "";

  it("lists the week's gigs with what may need a look, all to sign off", async () => {
    const a = await makeAct("Played Act");
    const b = await makeAct("No Show Act");
    const c = await makeAct("Details Act", { detailsCompletedAt: null, bankAccountNumber: "" });
    const d = await makeAct("Pending Act");
    const dep = await prisma.person.create({ data: { agencyId, firstName: "Sam", surname: "Dep" } });
    played = (await makeGig(a.id, at("2026-06-15T19:00:00Z"), { lineup: { create: { personId: dep.id, change: "IN" } } })).id;
    noShow = (await makeGig(b.id, at("2026-06-16T19:00:00Z"))).id;
    waiting = (await makeGig(c.id, at("2026-06-17T19:00:00Z"))).id;
    pending = (await makeGig(d.id, at("2026-06-18T19:00:00Z"), { status: "PENDING" })).id;
    const cancelled = (await makeGig(a.id, at("2026-06-19T19:00:00Z"), { status: "CANCELLED" })).id;

    const v = await week();
    expect(v.mode).toBe("SIGN_OFF");
    expect(v.invoices).toHaveLength(0);
    const states = Object.fromEntries(v.gigs.map((g) => [g.id, g.state]));
    expect(states).toEqual({ [played]: "TO_SIGN_OFF", [noShow]: "TO_SIGN_OFF", [waiting]: "TO_SIGN_OFF", [pending]: "TO_SIGN_OFF", [cancelled]: "CANCELLED" });
    expect((await gig(played)).flags.join(" ")).toContain("Sam Dep standing in");
    expect((await gig(waiting)).flags.join(" ")).toContain("Waiting for the act's details: the invoice is made as soon as they're in");
    expect((await gig(pending)).flags.join(" ")).toContain("Still pending");
  });

  it("needs a reason for a gig left out", async () => {
    const r = await actions.signOffGigs(WEEK, empty, form({ gig: [played, noShow, waiting, pending], played: [played, waiting, pending] }));
    expect(r?.error).toMatch(/^Say why No Show Act on .* is left out\.$/);
    expect(await live(played)).toBeNull();
  });

  it("signing off makes the played gigs' invoices, leaves the no-show out with its reason, and records who", async () => {
    const r = await actions.signOffGigs(
      WEEK,
      empty,
      form({ gig: [played, noShow, waiting, pending], played: [played, waiting, pending], [`reason_${noShow}`]: "Didn't turn up" }),
    );
    expect(r?.ok).toMatch(/^Signed off: 3 gigs played, 1 left out\. 1 invoice made\. 2 more as soon as they can be/);
    expect(await live(played)).not.toBeNull();
    expect(await live(noShow)).toBeNull();
    expect(await live(waiting)).toBeNull();
    expect(await live(pending)).toBeNull();
    const run = await prisma.payRun.findUniqueOrThrow({ where: { agencyId_weekStart: { agencyId, weekStart: WEEK } } });
    expect(run).toMatchObject({ signedOffByName: "Lucy" });
    expect(run.signedOffAt).toBeInstanceOf(Date);
    expect([...run.signedOffBookingIds].sort()).toEqual([played, waiting, pending].sort());
    expect(run.leftOut).toEqual([expect.objectContaining({ bookingId: noShow, reason: "Didn't turn up", byName: "Lucy" })]);
    const logged = await prisma.activity.findFirstOrThrow({ where: { entityId: noShow, action: "left out of the pay run" } });
    expect(logged.detail).toBe("Didn't turn up");
    const v = await week();
    expect((await gig(noShow)).state).toBe("LEFT_OUT");
    expect(v.invoices.map((i) => i.bookingId)).toEqual([played]);
    // The no-show stays out, even for the scheduler.
    await lib.runActInvoices();
    expect(await live(noShow)).toBeNull();
  });

  it("makes the waiting ones as soon as they can be", async () => {
    const c = await prisma.booking.findUniqueOrThrow({ where: { id: waiting } });
    await prisma.artist.update({ where: { id: c.artistId! }, data: details });
    await prisma.booking.update({ where: { id: pending }, data: { status: "CONFIRMED" } });
    await lib.runActInvoices();
    expect(await live(waiting)).not.toBeNull();
    expect(await live(pending)).not.toBeNull();
    expect((await week()).invoices).toHaveLength(3);
  });

  it("gigs added or invoiced by hand after sign-off aren't paid until they're signed off too", async () => {
    const act = await makeAct("Late Act");
    const late = await makeGig(act.id, at("2026-06-20T19:00:00Z"));
    const byHand = await makeGig(act.id, at("2026-06-21T12:00:00Z"));
    await lib.issueActInvoice(byHand.id, { byHand: true });
    const v = await week();
    expect((await gig(late.id)).flags).toContain("Not signed off yet");
    expect((await gig(byHand.id)).state).toBe("TO_SIGN_OFF");
    expect(v.invoices.map((i) => i.bookingId)).not.toContain(byHand.id);
    expect(v.payees.map((p) => p.name)).not.toContain("Late Act");

    const r = await actions.signOffGigs(WEEK, empty, form({ gig: [late.id, byHand.id], played: [late.id, byHand.id] }));
    expect(r?.ok).toMatch(/^Signed off: 2 gigs played\. 1 invoice made\./);
    const after = await week();
    expect(after.payees.find((p) => p.name === "Late Act")?.invoices).toHaveLength(2);
    expect(after.signOffs.map((s) => s.bookingIds.length)).toEqual([3, 2]);
  });

  it("a left-out gig that's been fixed since can be signed off", async () => {
    await new Promise((r) => setTimeout(r, 10));
    await prisma.booking.update({ where: { id: noShow }, data: { notes: "They did play, a late start" } });
    const g = await gig(noShow);
    expect(g.state).toBe("TO_SIGN_OFF");
    expect(g.flags).toContain("Edited since it was left out: not signed off yet");
    await actions.signOffGigs(WEEK, empty, form({ gig: [noShow], played: [noShow] }));
    expect(await live(noShow)).not.toBeNull();
    const run = await prisma.payRun.findUniqueOrThrow({ where: { agencyId_weekStart: { agencyId, weekStart: WEEK } } });
    expect(run.leftOut).toEqual([]);
  });

  it("only admins of the business, and only gigs of the week", async () => {
    const other = await makeAct("Other Week Act");
    const nextWeek = await makeGig(other.id, at("2026-06-23T19:00:00Z"));
    expect((await actions.signOffGigs(WEEK, empty, form({ gig: [nextWeek.id], played: [nextWeek.id] })))?.error).toBe(
      "Nothing here is waiting to be signed off.",
    );
    expect(await live(nextWeek.id)).toBeNull();
  });

  it("on Monday morning: last week's gigs are ready to sign off", async () => {
    const act = await makeAct("Reminder Act");
    const act2 = await makeAct("Reminder Act Two");
    for (const [a, d] of [
      [act, "2026-07-06"],
      [act, "2026-07-08"],
      [act2, "2026-07-10"],
    ] as const)
      await makeGig(a.id, at(`${d}T19:00:00Z`));
    const subject = { startsWith: "Last week's gigs are ready to sign off" };
    await server.runPayRunReminders(at("2026-07-13T09:00:00Z")); // Monday 10:00 BST
    await server.runPayRunReminders(at("2026-07-13T09:01:00Z"));
    const msgs = await prisma.message.findMany({ where: { agencyId, kind: "PAY_RUN", subject } });
    expect(msgs.map((m) => m.subject)).toEqual(["Last week's gigs are ready to sign off: 3 gigs, 2 acts"]);
    expect(msgs[0].body).toContain("/payments/run?week=2026-07-06");
  });
});
