import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Monthly billing in the database (src/lib/monthly-billing-server.ts and src/actions/monthly-billing.ts): the
// month's bills are made once, by payer (one for a company billed for all its venues, one per venue for a
// company billed per venue, the venue's own when nobody pays); the PO flow; a bill changed after it was
// invoiced is flagged; a bill whose gigs have gone stays until marked nothing to bill; and the office
// reminders on the 1st and 5th go once. Runs only against the test database:
//   TEST_DATABASE_URL=postgresql://…/gigsaw_test npx vitest run tests/monthly-billing-db.test.ts

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
type Server = typeof import("@/lib/monthly-billing-server");
type Actions = typeof import("@/actions/monthly-billing");
const HOUR = 3_600_000;
const MONTH = "2031-05";

describeDb("monthly billing (database)", () => {
  let prisma: Db["prisma"];
  let server: Server;
  let actions: Actions;
  let agencyId = "";
  const ids: Record<string, string> = {};
  let n = 0;

  const gig = async (venue: string, day: number, opts: { promoterId?: string; status?: string; feeMinor?: number; eventId?: string } = {}) => {
    const setStart = new Date(Date.UTC(2031, 4, day, 19));
    const b = await prisma.booking.create({
      data: {
        agencyId,
        venueId: ids[venue],
        promoterId: opts.promoterId ?? null,
        eventId: opts.eventId ?? null,
        artistId: ids.act,
        reference: `MB-${++n}-${Date.now()}`,
        status: opts.status ?? "CONFIRMED",
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd: new Date(setStart.getTime() + 2 * HOUR),
        dealType: "BUY_SELL",
        feeMinor: opts.feeMinor ?? 30_000,
        // The act's fee: never in anything the client sees.
        artistFeeMinor: 12_345,
        vatPct: 20,
        currency: "GBP",
      },
    });
    return b.id;
  };
  const bills = () => server.monthlyBills(agencyId, MONTH);
  const byKey = async (key: string) => (await bills()).find((b) => b.key === key)!;
  const form = (o: Record<string, string> = {}) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    server = await import("@/lib/monthly-billing-server");
    actions = await import("@/actions/monthly-billing");
    const t = await createTestAgency(prisma, "billing", { agencyName: "Billing Test Agency", agencyEmail: `office-${Date.now()}@billing.test` });
    agencyId = t.agency.id;
    staff.user = t.user;
    for (const v of ["Pryzm", "Atik", "Popworld", "Stadium bar", "Arena bar", "The Crown"]) {
      ids[v] = (await prisma.venue.create({ data: { agencyId, name: v } })).id;
    }
    ids.act = (await prisma.artist.create({ data: { agencyId, name: "Billing Act" } })).id;
    ids.rekom = (await prisma.contact.create({ data: { agencyId, name: "Rekom accounts", company: "Rekom", email: "ap@rekom.test" } })).id;
    ids.levy = (await prisma.contact.create({ data: { agencyId, name: "Levy UK", email: "levy@levy.test", billing: "PER_VENUE" } })).id;
    const couple = await prisma.contact.create({ data: { agencyId, type: "CLIENT", name: "Sam and Alex" } });
    // Popworld's weekly slot is paid by Rekom, so its gigs with no promoter go on Rekom's bill.
    await prisma.venueSlot.create({
      data: { agencyId, venueId: ids.Popworld, weekday: 5, arriveTime: "19:00", startTime: "20:00", endTime: "22:00", promoterId: ids.rekom },
    });
    ids.pryzm1 = await gig("Pryzm", 2, { promoterId: ids.rekom });
    ids.atik1 = await gig("Atik", 9, { promoterId: ids.rekom, status: "HOLD" });
    ids.pop1 = await gig("Popworld", 16);
    await gig("Stadium bar", 3, { promoterId: ids.levy });
    await gig("Arena bar", 4, { promoterId: ids.levy });
    ids.crown1 = await gig("The Crown", 5);
    // Never billed: cancelled, a private customer's, a wedding's, and next month's.
    await gig("Pryzm", 20, { promoterId: ids.rekom, status: "CANCELLED" });
    await gig("The Crown", 21, { promoterId: couple.id });
    const wedding = await prisma.event.create({ data: { agencyId, name: "A wedding", date: "2031-05-22", timezone: "Europe/London" } });
    await gig("The Crown", 22, { eventId: wedding.id });
    const june = new Date(Date.UTC(2031, 5, 3, 19));
    await prisma.booking.create({
      data: { agencyId, venueId: ids.Pryzm, promoterId: ids.rekom, reference: `MB-june-${Date.now()}`, status: "CONFIRMED", arriveBy: june, setStart: june },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  it("makes one bill per payer, once", async () => {
    const list = await bills();
    expect(list.map((b) => b.key).sort()).toEqual(
      [`c:${ids.rekom}`, `cv:${ids.levy}:${ids["Arena bar"]}`, `cv:${ids.levy}:${ids["Stadium bar"]}`, `v:${ids["The Crown"]}`].sort(),
    );
    const rekom = list.find((b) => b.key === `c:${ids.rekom}`)!;
    expect(rekom.name).toBe("Rekom: 3 venues");
    expect(rekom.group!.totals).toEqual({ gigs: 3, exVat: 90_000, vat: 18_000, total: 108_000 });
    expect(rekom.warnings.unconfirmed).toBe(1);
    expect(rekom.step).toBe("ASK_PO");
    expect(rekom.bill).toMatchObject({ contactId: ids.rekom, venueId: null });
    const arena = list.find((b) => b.key === `cv:${ids.levy}:${ids["Arena bar"]}`)!;
    expect(arena.bill).toMatchObject({ contactId: ids.levy, venueId: ids["Arena bar"] });
    // Listing again makes nothing new.
    await bills();
    expect(await prisma.monthlyBill.count({ where: { agencyId, month: MONTH } })).toBe(4);
  });

  it("asks for a PO by email, takes the PO and marks it invoiced", async () => {
    const rekom = await byKey(`c:${ids.rekom}`);
    const asked = await actions.askForPo(rekom.id, undefined, form({ mode: "send" }));
    expect(asked?.error).toBeUndefined();
    const sent = await prisma.message.findFirst({ where: { agencyId, kind: "BILLING", to: "ap@rekom.test" } });
    expect(sent).toBeTruthy();
    expect(sent!.subject).toContain("Rekom");
    expect(sent!.body).toContain("Pryzm");
    expect(sent!.body).toContain("Popworld");
    expect(sent!.body).toContain("£1,080.00");
    // Never the act's fee.
    expect(sent!.body).not.toContain("123.45");
    expect((await byKey(`c:${ids.rekom}`)).step).toBe("WAITING_PO");

    // "Mark as asked" works without an email.
    const crown = await byKey(`v:${ids["The Crown"]}`);
    await actions.askForPo(crown.id, undefined, form({ mode: "mark" }));
    expect((await byKey(`v:${ids["The Crown"]}`)).step).toBe("WAITING_PO");
    expect(await prisma.message.count({ where: { agencyId, kind: "BILLING" } })).toBe(1);

    expect((await actions.savePo(rekom.id, undefined, form({ poNumber: "" })))?.error).toBeTruthy();
    await actions.savePo(rekom.id, undefined, form({ poNumber: "PO-7781" }));
    const withPo = await byKey(`c:${ids.rekom}`);
    expect(withPo.step).toBe("TO_INVOICE");
    expect(withPo.bill.poNumber).toBe("PO-7781");
    expect(withPo.bill.poReceivedAt).toBeTruthy();

    await actions.markInvoiced(rekom.id, undefined, form({ invoiceNumber: "INV-1001" }));
    const invoiced = await byKey(`c:${ids.rekom}`);
    expect(invoiced.step).toBe("INVOICED");
    expect(invoiced.bill).toMatchObject({ invoiceNumber: "INV-1001", invoicedTotalMinor: 108_000 });
    expect(invoiced.warnings.totalChanged).toBeNull();

    // The printed venue statement finds the bill a venue's gigs are on.
    const forVenue = await server.billForVenueMonth(agencyId, ids.Atik, MONTH);
    expect(forVenue?.poNumber).toBe("PO-7781");

    await actions.markPaid(rekom.id, undefined);
    expect((await byKey(`c:${ids.rekom}`)).step).toBe("PAID");
    await actions.undoBillStep(rekom.id, "PAID", undefined);
    expect((await byKey(`c:${ids.rekom}`)).step).toBe("INVOICED");
  });

  it("flags a bill whose gigs changed or were cancelled after it was invoiced", async () => {
    // Saved a moment after invoicing, as an edit would be.
    await new Promise((r) => setTimeout(r, 20));
    await prisma.booking.update({ where: { id: ids.pryzm1 }, data: { feeMinor: 40_000 } });
    await prisma.booking.update({ where: { id: ids.atik1 }, data: { status: "CANCELLED" } });
    const b = await byKey(`c:${ids.rekom}`);
    // Atik's £300 is gone (cancelled) and Pryzm's went up by £100: £900 + VAT then, £700 + VAT now.
    expect(b.warnings.totalChanged).toEqual({ invoiced: 108_000, now: 84_000 });
    expect(b.warnings.changedGigs.map((g) => g.id)).toEqual([ids.pryzm1]);
    expect(b.warnings.cancelledSince.map((g) => g.id)).toEqual([ids.atik1]);
    // A new invoice for the new total clears the warning.
    await actions.markInvoiced(b.id, undefined, form({ invoiceNumber: "INV-1002" }));
    expect((await byKey(`c:${ids.rekom}`)).warnings.totalChanged).toBeNull();
  });

  it("keeps a bill whose gigs have gone until it's marked nothing to bill", async () => {
    await prisma.booking.update({ where: { id: ids.crown1 }, data: { status: "CANCELLED" } });
    const gone = await byKey(`v:${ids["The Crown"]}`);
    expect(gone.group).toBeNull();
    expect(gone.warnings.noGigs).toBe(true);
    expect(gone.name).toBe("The Crown");
    await actions.markNothingToBill(gone.id, undefined);
    const nothing = await byKey(`v:${ids["The Crown"]}`);
    expect(nothing.step).toBe("NOTHING");
    expect(nothing.warnings.noGigs).toBe(false);
  });

  it("emails the office on the 1st and lists what's still to do on the 5th, each once", async () => {
    const office = (await prisma.settings.findUnique({ where: { agencyId } }))!.agencyEmail;
    const sentTo = (subject: string) => prisma.message.count({ where: { agencyId, to: office, subject: { contains: subject } } });
    // Monday 2 June 2031, 11am in London.
    await server.runBillingReminders(new Date("2031-06-02T10:00:00Z"));
    await server.runBillingReminders(new Date("2031-06-02T10:30:00Z"));
    expect(await sentTo("Monthly billing for May 2031: 3 to bill")).toBe(1);
    // Not before 9am, or at the weekend.
    await server.runBillingReminders(new Date("2031-06-05T06:00:00Z"));
    expect(await sentTo("still to do")).toBe(0);
    await server.runBillingReminders(new Date("2031-06-05T10:00:00Z"));
    await server.runBillingReminders(new Date("2031-06-06T10:00:00Z"));
    // The two Levy bills still need a PO; Rekom is invoiced and The Crown has nothing to bill.
    expect(await sentTo("Monthly billing for May 2031: 2 still to do")).toBe(1);
    const chase = await prisma.message.findFirst({ where: { agencyId, to: office, subject: { contains: "still to do" } } });
    expect(chase!.body).toContain("Levy UK: Arena bar");
    expect(chase!.body).toContain("/billing?month=2031-05");
  });
});
