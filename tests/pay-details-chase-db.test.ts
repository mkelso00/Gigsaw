import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// The weekly reminder to acts to add their pay details, or agree to self-billing (src/lib/pay-details-chase.ts):
// only payees whose details are missing (or whose agreement isn't current) and who have a gig to be paid for, once a
// week in office hours, and "Remind now" from Pay acts. Runs only against the test database (tests/helpers/db.ts).

const staff = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireStaff: async () => staff.user,
}));

const { inChaseHours } = await import("@/lib/pay-details-chase");

describe("office hours", () => {
  it("are weekdays, 9am to 5pm in the business's time zone", () => {
    expect(inChaseHours(new Date("2026-11-23T09:00:00Z"), "Europe/London")).toBe(true); // Monday 9am
    expect(inChaseHours(new Date("2026-11-23T08:59:00Z"), "Europe/London")).toBe(false);
    expect(inChaseHours(new Date("2026-11-27T16:59:00Z"), "Europe/London")).toBe(true); // Friday
    expect(inChaseHours(new Date("2026-11-27T17:00:00Z"), "Europe/London")).toBe(false);
    expect(inChaseHours(new Date("2026-11-28T10:00:00Z"), "Europe/London")).toBe(false); // Saturday
    // British Summer Time: 9am in London is 8am UTC.
    expect(inChaseHours(new Date("2026-06-01T08:00:00Z"), "Europe/London")).toBe(true);
  });
});

describeDb("the pay details chase (database)", () => {
  let prisma: (typeof import("@/lib/db"))["prisma"];
  let chase: typeof import("@/lib/pay-details-chase");
  let agencyId = "";
  let stamp = "";
  let ref = 0;
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  // Monday 23 November 2026, 10am in London (GMT).
  const MONDAY = new Date("2026-11-23T10:00:00Z");
  const done = {
    address: "1 High St\nLeeds",
    bankAccountName: "A Person",
    bankSortCode: "12-34-56",
    bankAccountNumber: "12345678",
    detailsCompletedAt: new Date(),
  };
  const agreed = { selfBillingAgreedAt: new Date(MONDAY.getTime() - 30 * DAY), selfBillingAgreedText: "Agreed." };
  const email = (tag: string) => `${tag}-${stamp}@chase.gigsaw.invalid`;

  const act = (name: string, over: Record<string, unknown> = {}) =>
    prisma.artist.create({ data: { agencyId, name, email: email(name.replace(/\W/g, "").toLowerCase()), ...over } });
  /** A confirmed gig starting `hoursFromMonday` after (negative: before) Monday 10am, £400 to the act. */
  const gig = (artistId: string, hoursFromMonday: number, over: Record<string, unknown> = {}) => {
    const setStart = new Date(MONDAY.getTime() + hoursFromMonday * HOUR);
    return prisma.booking.create({
      data: {
        agencyId,
        reference: `CH-${stamp}-${++ref}`,
        artistId,
        status: "CONFIRMED",
        dealType: "BUY_SELL",
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd: new Date(setStart.getTime() + 2 * HOUR),
        feeMinor: 60_000,
        artistFeeMinor: 40_000,
        ...over,
      },
    });
  };
  const sent = (to: string) => prisma.message.findMany({ where: { agencyId, kind: "PAY_DETAILS", to }, orderBy: { createdAt: "asc" } });

  let ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    chase = await import("@/lib/pay-details-chase");
    const a = await createTestAgency(prisma, "chase", { agencyName: "Chase Music", agencyEmail: "office@chase.gigsaw.invalid" });
    agencyId = a.agency.id;
    stamp = a.stamp;
    staff.user = a.user;

    // 1. No details, a gig next week: chased.
    const upcoming = await act("Missing Upcoming");
    await gig(upcoming.id, 7 * 24);
    await prisma.user.create({
      data: { email: email("login1"), name: "Missing Upcoming", passwordHash: "x", role: "ARTIST", agencyId, artistId: upcoming.id },
    });
    // 2. No details and no gigs: never chased.
    const noGigs = await act("Missing No Gigs");
    // 3. Details in and agreed, a gig coming up: nothing to chase.
    const fine = await act("All Done", { ...done, ...agreed });
    await gig(fine.id, 48);
    // 4. No details, but the only gig was last month and has been paid in full: nothing to pay, so not chased.
    const paid = await act("Missing Paid Up");
    await gig(paid.id, -30 * 24, { payments: { create: { direction: "OUT", kind: "SETTLEMENT", amountMinor: 40_000, paidAt: new Date() } } });
    // 5. A band whose lead has no details, with a finished gig still unpaid: the lead is chased, not the band.
    const band = await act("Missing Band");
    const lead = await prisma.person.create({ data: { agencyId, firstName: "Lena", surname: "Lead", email: email("lena") } });
    const mate = await prisma.person.create({ data: { agencyId, firstName: "Max", surname: "Mate", email: email("max"), ...done, ...agreed } });
    await prisma.personAct.createMany({ data: [lead, mate].map((p) => ({ personId: p.id, artistId: band.id })) });
    await prisma.artist.update({ where: { id: band.id }, data: { leadPersonId: lead.id } });
    await gig(band.id, -5 * 24);
    // 6. Details in, but agreed to self-billing more than 12 months ago, a gig coming up: asked to agree again.
    const lapsed = await act("Lapsed Agreement", { ...done, selfBillingAgreedAt: new Date(MONDAY.getTime() - 400 * DAY), selfBillingAgreedText: "Old." });
    await gig(lapsed.id, 72);
    // 7. A band with nobody chosen for its invoices: staff must choose first, so nobody is chased.
    const leaderless = await act("Leaderless Band");
    const p1 = await prisma.person.create({ data: { agencyId, firstName: "Pat", surname: "One", email: email("pat") } });
    const p2 = await prisma.person.create({ data: { agencyId, firstName: "Sam", surname: "Two", email: email("sam") } });
    await prisma.personAct.createMany({ data: [p1, p2].map((p) => ({ personId: p.id, artistId: leaderless.id })) });
    await gig(leaderless.id, 24);
    // 8. Cancelled gig only: not chased.
    const cancelled = await act("Missing Cancelled");
    await gig(cancelled.id, 24, { status: "CANCELLED" });
    ids = {
      upcoming: upcoming.id,
      noGigs: noGigs.id,
      fine: fine.id,
      paid: paid.id,
      band: band.id,
      lead: lead.id,
      lapsed: lapsed.id,
      leaderless: leaderless.id,
    };
  });

  afterAll(async () => {
    await removeTestAgency(prisma, agencyId);
  });

  it("only chases payees with gigs to be paid for and details or agreement missing, by email with a link to their details", async () => {
    expect(await chase.runPayDetailsChase(new Date(MONDAY.getTime() - 2 * HOUR), { agencyIds: [agencyId] })).toEqual({ chased: 0 }); // 8am: too early
    expect(await chase.runPayDetailsChase(MONDAY, { agencyIds: [agencyId] })).toEqual({ chased: 3 });

    const msgs = await prisma.message.findMany({ where: { agencyId, kind: "PAY_DETAILS" } });
    expect(msgs.map((m) => m.to).sort()).toEqual([email("lapsedagreement"), email("lena"), email("missingupcoming")].sort());
    const [upcoming] = await sent(email("missingupcoming"));
    expect(upcoming.subject).toBe("Add your bank and address so Chase Music can pay you");
    expect(upcoming.body).toContain("/app/details");
    expect(upcoming.body).toMatch(/bank details and address/);
    // Never money.
    expect(upcoming.body).not.toMatch(/£|400/);
    const [lena] = await sent(email("lena"));
    expect(lena.subject).toBe("Add your bank and address so Chase Music can pay you");
    expect(lena.body).toContain("Hi Lena");
    expect(lena.body).toContain("Missing Band");
    const [lapsed] = await sent(email("lapsedagreement"));
    expect(lapsed.subject).toBe("Please confirm self-billing with Chase Music");
    expect(lapsed.body).toMatch(/a year since you agreed/);
    for (const m of msgs) expect(`${m.subject} ${m.body}`).not.toMatch(/[—–]|sorry|apolog/i);
  });

  it("sends each payee one a week, and again the next week if still missing", async () => {
    expect(await chase.runPayDetailsChase(new Date(MONDAY.getTime() + 3 * HOUR), { agencyIds: [agencyId] })).toEqual({ chased: 0 });
    expect(await chase.runPayDetailsChase(new Date(MONDAY.getTime() + 2 * DAY), { agencyIds: [agencyId] })).toEqual({ chased: 0 });
    expect(await sent(email("missingupcoming"))).toHaveLength(1);
    // The next Monday, still missing and the gig still to come.
    await prisma.booking.updateMany({ where: { artistId: ids.upcoming }, data: { setStart: new Date(MONDAY.getTime() + 10 * DAY) } });
    // The lead adds their details and agrees in the meantime: they aren't chased again.
    await prisma.person.update({ where: { id: ids.lead }, data: { ...done, ...agreed } });
    const next = new Date(MONDAY.getTime() + 7 * DAY);
    expect(await chase.runPayDetailsChase(next, { agencyIds: [agencyId] })).toEqual({ chased: 2 });
    expect(await sent(email("missingupcoming"))).toHaveLength(2);
    expect(await sent(email("lena"))).toHaveLength(1);
  });

  it("Remind now sends one straight away, once a day, and says when there's nothing to ask for", async () => {
    const { remindPayDetailsNow } = await import("@/actions/pay-details-chase");
    const before = (await sent(email("missingupcoming"))).length;
    expect(await remindPayDetailsNow(ids.upcoming, undefined)).toEqual({ ok: "Reminder sent to Missing Upcoming." });
    expect(await sent(email("missingupcoming"))).toHaveLength(before + 1);
    expect(await remindPayDetailsNow(ids.upcoming, undefined)).toEqual({ error: "Missing Upcoming has already been reminded today." });
    expect((await remindPayDetailsNow(ids.fine, undefined))?.error).toMatch(/all in/);
    expect((await remindPayDetailsNow(ids.leaderless, undefined))?.error).toMatch(/nobody is chosen/);
    expect(await prisma.activity.count({ where: { entityId: ids.upcoming, action: "reminded them to add their pay details" } })).toBe(1);
    // Another business's act can't be reminded from here.
    const other = await createTestAgency(prisma, "chase-other");
    try {
      const theirs = await prisma.artist.create({ data: { agencyId: other.agency.id, name: "Theirs", email: email("theirs") } });
      expect(await remindPayDetailsNow(theirs.id, undefined)).toEqual({ error: "Act not found" });
    } finally {
      await removeTestAgency(prisma, other.agency.id);
    }
  });

  it("isn't sent when the business switches the reminder off", async () => {
    await prisma.settings.update({ where: { agencyId }, data: { messageTemplates: { PAY_DETAILS: { off: true }, SELF_BILLING: { off: true } } } });
    try {
      expect(await chase.runPayDetailsChase(new Date(MONDAY.getTime() + 14 * DAY), { agencyIds: [agencyId] })).toEqual({ chased: 0 });
    } finally {
      await prisma.settings.update({ where: { agencyId }, data: { messageTemplates: {} } });
    }
  });
});
