import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Acts' self-billing invoices in the database (src/lib/act-invoices.ts): made once per finished gig,
// never before, never without the act's details; numbered per agency; VAT only for VAT-registered
// acts; a copy of the act's details kept; paid through the same payments as the rest of Gigsaw; and
// an act only ever sees its own invoices, never the sale figures. Runs only against the test database:
//   TEST_DATABASE_URL=postgresql://…/gigsaw_test npx vitest run tests/act-invoices-db.test.ts

const staff = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireStaff: async () => staff.user,
  requireUser: async () => staff.user,
}));
vi.mock("@/lib/calendar-sync/queue", () => ({ queueCalendarSync: () => {} }));

type Db = typeof import("@/lib/db");
type Lib = typeof import("@/lib/act-invoices");

describeDb("act invoices (database)", () => {
  let prisma: Db["prisma"];
  let lib: Lib;
  let agencyId = "";
  let otherAgencyId = "";
  let ref = 0;
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const empty = undefined as never;

  const details = (over: Record<string, unknown> = {}) => ({
    address: "1 High Street\nLeeds LS1 1AA",
    bankAccountName: "E Rose",
    bankSortCode: "12-34-56",
    bankAccountNumber: "12345678",
    detailsCompletedAt: new Date(),
    ...over,
  });
  const makeAct = (name: string, over: Record<string, unknown> = {}, agency = agencyId) =>
    prisma.artist.create({ data: { agencyId: agency, name, ...details(), ...over } });
  /** A gig that ended `endedHoursAgo` hours ago (negative: still to come). Buy/sell: £900 sale, £600 to the act. */
  const makeGig = (artistId: string, endedHoursAgo = 2, over: Record<string, unknown> = {}, agency = agencyId) => {
    const setEnd = new Date(Date.now() - endedHoursAgo * HOUR);
    const setStart = new Date(setEnd.getTime() - 2 * HOUR);
    return prisma.booking.create({
      data: {
        agencyId: agency,
        reference: `AI-${++ref}`,
        artistId,
        status: "CONFIRMED",
        dealType: "BUY_SELL",
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd,
        feeMinor: 90_000,
        artistFeeMinor: 60_000,
        bookingFeeMinor: 4_321,
        vatPct: 20,
        ...over,
      },
    });
  };
  const form = (fields: Record<string, string | string[]>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
    return f;
  };
  const live = (bookingId: string) => prisma.actInvoice.findUnique({ where: { liveBookingId: bookingId } });

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    lib = await import("@/lib/act-invoices");
    const a = await createTestAgency(prisma, "invoices", { agencyName: "Test Agency Ltd", agencyAddress: "2 Office Row", actInvoiceMode: "AUTO" });
    agencyId = a.agency.id;
    staff.user = a.user;
    otherAgencyId = (await createTestAgency(prisma, "invoices-other", { actInvoiceMode: "AUTO" })).agency.id;
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { agencyId: { in: [agencyId, otherAgencyId] }, archivedAt: undefined } });
    await removeTestAgency(prisma, agencyId);
    await removeTestAgency(prisma, otherAgencyId);
    await prisma.$disconnect();
  });

  it("makes one invoice per finished gig, however many times it's asked at once", async () => {
    const act = await makeAct("Once Act");
    const b = await makeGig(act.id);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => lib.issueActInvoice(b.id)));
    expect(results.filter((r) => "number" in r)).toHaveLength(1);
    await lib.runActInvoices();
    const all = await prisma.actInvoice.findMany({ where: { bookingId: b.id } });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: "ISSUED", netMinor: 60_000, vatMinor: 0, totalMinor: 60_000, artistId: act.id, bookingRef: b.reference });
  });

  it("not before the gig is over, then as soon as the act checks out", async () => {
    const act = await makeAct("Checkout Act");
    const b = await makeGig(act.id, -2);
    expect(await lib.issueActInvoice(b.id)).toEqual({ skipped: "The gig hasn't finished yet" });
    await lib.runActInvoices();
    expect(await live(b.id)).toBeNull();
    await prisma.checkIn.create({ data: { bookingId: b.id, artistId: act.id, kind: "DEPARTED" } });
    expect(await lib.issueActInvoice(b.id)).toHaveProperty("number");
  });

  it("waits for the act's details, and shows staff the gig meanwhile", async () => {
    const act = await makeAct("No Details Act", { detailsCompletedAt: null });
    const b = await makeGig(act.id);
    expect(await lib.issueActInvoice(b.id)).toEqual({ skipped: "Waiting for the act's details" });
    await lib.runActInvoices();
    expect(await live(b.id)).toBeNull();
    const waiting = (await lib.uninvoicedGigs(agencyId)).find((r) => r.booking.id === b.id);
    expect(waiting).toMatchObject({ reason: "Waiting for the act's details", canMake: false, owedMinor: 60_000 });
    // Details in: made on the next run.
    await prisma.artist.update({ where: { id: act.id }, data: { detailsCompletedAt: new Date() } });
    await lib.runActInvoices();
    expect(await live(b.id)).not.toBeNull();
  });

  it("not for cancelled, demo or old gigs by itself, nor for acts paid already", async () => {
    const act = await makeAct("Skipped Act");
    const cancelled = await makeGig(act.id, 2, { status: "CANCELLED" });
    const demo = await makeGig(act.id, 2, { demo: true });
    const old = await makeGig(act.id, 40 * 24);
    const paid = await makeGig(act.id, 2, { payments: { create: { direction: "OUT", kind: "SETTLEMENT", amountMinor: 60_000, paidAt: new Date() } } });
    await lib.runActInvoices();
    for (const b of [cancelled, demo, old, paid]) expect(await live(b.id)).toBeNull();
    // Older gigs can be made by hand from Pay acts.
    expect((await lib.uninvoicedGigs(agencyId)).find((r) => r.booking.id === old.id)?.canMake).toBe(true);
    expect(await lib.issueActInvoice(old.id, { byHand: true })).toHaveProperty("number");
  });

  it("numbers invoices one after another, separately for each agency", async () => {
    const before = await prisma.actInvoice.count({ where: { agencyId } });
    const act = await makeAct("Numbered Act");
    const [b1, b2] = [await makeGig(act.id), await makeGig(act.id)];
    const n1 = await lib.issueActInvoice(b1.id);
    const n2 = await lib.issueActInvoice(b2.id);
    expect(n1).toEqual({ number: `SB-${String(before + 1).padStart(4, "0")}` });
    expect(n2).toEqual({ number: `SB-${String(before + 2).padStart(4, "0")}` });
    const otherAct = await makeAct("Other Agency Act", {}, otherAgencyId);
    expect(await lib.issueActInvoice((await makeGig(otherAct.id, 2, {}, otherAgencyId)).id)).toEqual({ number: "SB-0001" });
  });

  it("adds VAT only for a VAT-registered act, with their VAT number on it", async () => {
    const vatAct = await makeAct("VAT Act", { vatRegistered: true, vatNumber: "GB123456789" });
    const plainAct = await makeAct("Plain Act", { vatNumber: "GB999" });
    const v = await makeGig(vatAct.id);
    const p = await makeGig(plainAct.id);
    await lib.issueActInvoice(v.id);
    await lib.issueActInvoice(p.id);
    expect(await live(v.id)).toMatchObject({ vatPct: 20, vatMinor: 12_000, totalMinor: 72_000, actVatNumber: "GB123456789" });
    expect(await live(p.id)).toMatchObject({ vatPct: 0, vatMinor: 0, totalMinor: 60_000, actVatNumber: "" });
  });

  it("keeps a copy of the act's details; a paid invoice never changes", async () => {
    const act = await makeAct("Snapshot Act");
    const b = await makeGig(act.id);
    await lib.issueActInvoice(b.id);
    const inv = (await live(b.id))!;
    expect(inv).toMatchObject({ actName: "Snapshot Act", actAddress: "1 High Street\nLeeds LS1 1AA", bankSortCode: "12-34-56", bankAccountNumber: "12345678" });
    const { markActInvoicesPaid } = await import("@/actions/act-invoices");
    await markActInvoicesPaid(empty, form({ one: inv.id }));
    await prisma.artist.update({ where: { id: act.id }, data: { name: "Renamed Act", bankAccountNumber: "99999999", address: "Elsewhere" } });
    await prisma.booking.update({ where: { id: b.id }, data: { artistFeeMinor: 70_000 } });
    await lib.runActInvoices();
    const after = await prisma.actInvoice.findMany({ where: { bookingId: b.id } });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ status: "PAID", actName: "Snapshot Act", bankAccountNumber: "12345678", netMinor: 60_000 });
  });

  it("voids and replaces an unpaid invoice when the fee or bank details change, and voids it if the gig is cancelled", async () => {
    const act = await makeAct("Changing Act");
    const b = await makeGig(act.id);
    await lib.issueActInvoice(b.id);
    const first = (await live(b.id))!;
    await prisma.booking.update({ where: { id: b.id }, data: { artistFeeMinor: 65_000 } });
    expect(await lib.reconcileActInvoice(first.id)).toBe("reissued");
    const second = (await live(b.id))!;
    expect(second.number).not.toBe(first.number);
    expect(second).toMatchObject({ netMinor: 65_000, note: `Replaces ${first.number}: the fee changed` });
    expect(await prisma.actInvoice.findUnique({ where: { id: first.id } })).toMatchObject({ status: "VOID", liveBookingId: null, note: "The fee changed" });

    await prisma.artist.update({ where: { id: act.id }, data: { bankAccountNumber: "11112222" } });
    await lib.runActInvoices();
    expect((await live(b.id))!).toMatchObject({ bankAccountNumber: "11112222" });

    await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED" } });
    await lib.runActInvoices();
    expect(await live(b.id)).toBeNull();
    const all = await prisma.actInvoice.findMany({ where: { bookingId: b.id } });
    expect(all.map((i) => i.status)).toEqual(["VOID", "VOID", "VOID"]);
  });

  it("marking paid logs one payment out to the act (VAT included), settles the gig, and a double tap pays nothing more", async () => {
    const { markActInvoicesPaid } = await import("@/actions/act-invoices");
    const act = await makeAct("Paid Act", { vatRegistered: true, vatNumber: "GB1" });
    // The customer has paid in full already, so paying the act settles it.
    const b = await makeGig(act.id, 2, { payments: { create: { direction: "IN", kind: "BALANCE", amountMinor: 113_185, paidAt: new Date() } } });
    await lib.issueActInvoice(b.id);
    const inv = (await live(b.id))!;
    const f = form({ id: [inv.id] });
    await Promise.all([1, 2, 3].map(() => markActInvoicesPaid(empty, f)));
    const out = await prisma.payment.findMany({ where: { bookingId: b.id, direction: "OUT" } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ amountMinor: 72_000, kind: "SETTLEMENT", note: `Invoice ${inv.number}` });
    expect(await live(b.id)).toMatchObject({ status: "PAID" });
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.status).toBe("SETTLED");
  });

  it("stays in step with payments made anywhere: Payments' mark paid, and taking a payment off", async () => {
    const { markPaid } = await import("@/actions/payments");
    const { deletePayment } = await import("@/actions/bookings");
    const act = await makeAct("Elsewhere Act", { vatRegistered: true, vatNumber: "GB2" });
    const b = await makeGig(act.id);
    await lib.issueActInvoice(b.id);
    await markPaid(empty, form({ direction: "OUT", id: b.id }));
    const out = await prisma.payment.findFirstOrThrow({ where: { bookingId: b.id, direction: "OUT" } });
    // What the invoice says, VAT and all, not just the fee.
    expect(out.amountMinor).toBe(72_000);
    expect(await live(b.id)).toMatchObject({ status: "PAID" });
    await deletePayment(out.id);
    expect(await live(b.id)).toMatchObject({ status: "ISSUED", paidAt: null });
  });

  it("an act sees only its own invoices, and none of the sale figures", async () => {
    const mine = await makeAct("Mine Act");
    const theirs = await makeAct("Theirs Act");
    const bm = await makeGig(mine.id);
    const bt = await makeGig(theirs.id);
    await lib.issueActInvoice(bm.id);
    await lib.issueActInvoice(bt.id);
    const login = { role: "ARTIST", agencyId, artistId: mine.id, personId: null };
    const list = await lib.invoicesForActLogin(login);
    expect(list.map((i) => i.bookingRef)).toEqual([bm.reference]);
    const theirsInvoice = (await live(bt.id))!;
    expect(await lib.invoiceForViewer(login, theirsInvoice.id)).toBeNull();
    expect(await lib.invoiceForViewer(login, list[0].id)).not.toBeNull();
    // Staff of another agency can't open it either.
    expect(await lib.invoiceForViewer({ role: "ADMIN", agencyId: otherAgencyId, artistId: null, personId: null }, list[0].id)).toBeNull();
    // Nothing about what the venue or customer pays: not the £900 sale, the booking fee or their VAT.
    const seen = JSON.stringify(list);
    for (const figure of ["90000", "4321", "108000", "feeMinor", "bookingFee"]) expect(seen).not.toContain(figure);
    expect(Object.keys(list[0])).not.toContain("booking");
  });
});
