import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// The weekly pay run in the database (src/lib/pay-run-server.ts, src/actions/pay-run.ts): the week's invoices by
// gig date in the business's time zone, one payee per person across their acts, marking payees paid (one, ticked,
// all) through the same payments as the rest of Gigsaw and undoing it, what was sent for the records and what's
// changed since, and the Monday "ready to check" email, sent once. Runs only against the test database:
//   TEST_DATABASE_URL=postgresql://…/gigsaw_test npx vitest run tests/pay-run-db.test.ts

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

type Db = typeof import("@/lib/db");
type Server = typeof import("@/lib/pay-run-server");
type Actions = typeof import("@/actions/pay-run");
type Invoices = typeof import("@/lib/act-invoices");

// A week in summer (BST), well in the past so the scheduler's own invoices never touch it.
const WEEK = "2026-06-01";
const NEXT = "2026-06-08";
const at = (iso: string) => new Date(iso);

describeDb("weekly pay run (database)", () => {
  let prisma: Db["prisma"];
  let server: Server;
  let actions: Actions;
  let invoices: Invoices;
  let agencyId = "";
  let adminEmail = "";
  let ref = 0;
  const empty = undefined as never;
  const tz = "Europe/London";

  const details = {
    address: "1 High Street\nLeeds LS1 1AA",
    bankAccountName: "J BLOGGS",
    bankSortCode: "12-34-56",
    bankAccountNumber: "12345678",
    detailsCompletedAt: new Date(),
  };
  const makeAct = (name: string, over: Record<string, unknown> = {}) => prisma.artist.create({ data: { agencyId, name, ...details, ...over } });
  /** A finished gig starting at `setStart` (UTC), £600 to the act unless said otherwise, and its invoice made by hand. */
  const gigWithInvoice = async (artistId: string, setStart: Date, over: Record<string, unknown> = {}) => {
    const b = await prisma.booking.create({
      data: {
        agencyId,
        reference: `PR-${++ref}`,
        artistId,
        status: "CONFIRMED",
        dealType: "BUY_SELL",
        arriveBy: new Date(setStart.getTime() - 3_600_000),
        setStart,
        setEnd: new Date(setStart.getTime() + 2 * 3_600_000),
        feeMinor: 90_000,
        artistFeeMinor: 60_000,
        ...over,
      },
    });
    const r = await invoices.issueActInvoice(b.id, { byHand: true });
    expect(r).toHaveProperty("number");
    return { booking: b, invoice: await prisma.actInvoice.findUniqueOrThrow({ where: { liveBookingId: b.id } }) };
  };
  const form = (fields: Record<string, string | string[]>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
    return f;
  };
  const week = (w = WEEK) => server.payRunWeek(agencyId, w, { timeZone: tz, business: "Suave Agency" });
  /** The form fields the page posts for a payee's row. */
  const rowFields = (p: Awaited<ReturnType<typeof week>>["payees"][number]) => ({
    [`ids_${p.key}`]: p.invoices.filter((i) => i.owedMinor > 0).map((i) => i.id),
    [`paid_${p.key}`]: p.invoices.filter((i) => i.status === "PAID").map((i) => i.id),
    [`name_${p.key}`]: p.name,
  });

  // Jo leads The Band and plays as Jo Solo: one payee. Sam's act has nobody on file: the act is paid.
  let jo = { id: "" };
  let band = { id: "" };
  let solo = { id: "" };
  let samAct = { id: "" };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    server = await import("@/lib/pay-run-server");
    actions = await import("@/actions/pay-run");
    invoices = await import("@/lib/act-invoices");
    const a = await createTestAgency(prisma, "payrun", { agencyName: "Suave Agency", agencyAddress: "2 Office Row", agencyEmail: "" });
    agencyId = a.agency.id;
    adminEmail = a.admin.email;
    staff.user = { ...a.user, name: "Lucy" };
    jo = await prisma.person.create({ data: { agencyId, firstName: "Jo", surname: "Bloggs", ...details } });
    const kit = await prisma.person.create({ data: { agencyId, firstName: "Kit", surname: "Drum" } });
    band = await makeAct("The Band", { leadPersonId: jo.id, members: { create: [{ personId: jo.id }, { personId: kit.id }] } });
    solo = await makeAct("Jo Solo", { members: { create: [{ personId: jo.id }] } });
    samAct = await makeAct("Sam Act", { bankAccountName: "SAM ACT", bankAccountNumber: "87654321" });
  });

  afterAll(async () => {
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  it("takes the week's gigs by date in the business's time zone: a Sunday night gig stays in its week", async () => {
    // 23:30 BST on Sunday 7 June, and 00:30 BST on Monday 8 June (still Sunday in UTC).
    const sunday = await gigWithInvoice(samAct.id, at("2026-06-07T22:30:00Z"));
    const monday = await gigWithInvoice(samAct.id, at("2026-06-07T23:30:00Z"));
    const ids = (await week()).invoices.map((i) => i.id);
    expect(ids).toContain(sunday.invoice.id);
    expect(ids).not.toContain(monday.invoice.id);
    expect((await week(NEXT)).invoices.map((i) => i.id)).toContain(monday.invoice.id);
  });

  it("one payee per person across their acts, totalled, with gigs still to invoice listed", async () => {
    await gigWithInvoice(band.id, at("2026-06-05T19:00:00Z"));
    await gigWithInvoice(solo.id, at("2026-06-06T12:00:00Z"), { artistFeeMinor: 25_000 });
    // A gig in the week that isn't confirmed, and one by an act whose payee hasn't given details.
    await prisma.booking.create({
      data: {
        agencyId,
        reference: `PR-${++ref}`,
        artistId: samAct.id,
        status: "HOLD",
        arriveBy: at("2026-06-03T18:00:00Z"),
        setStart: at("2026-06-03T19:00:00Z"),
        artistFeeMinor: 10_000,
        feeMinor: 20_000,
      },
    });
    const noDetails = await makeAct("New Act", { detailsCompletedAt: null, bankAccountNumber: "" });
    await prisma.booking.create({
      data: {
        agencyId,
        reference: `PR-${++ref}`,
        artistId: noDetails.id,
        status: "CONFIRMED",
        arriveBy: at("2026-06-04T18:00:00Z"),
        setStart: at("2026-06-04T19:00:00Z"),
        artistFeeMinor: 10_000,
        feeMinor: 20_000,
      },
    });

    const v = await week();
    const joRow = v.payees.find((p) => p.name === "Jo Bloggs")!;
    expect(joRow).toMatchObject({ totalMinor: 85_000, owedMinor: 85_000, acts: ["The Band", "Jo Solo"] });
    expect(joRow.reference).toMatch(/^Suave SB-\d{4}\/\d{4}$/);
    expect(v.payees.find((p) => p.name === "Sam Act")).toMatchObject({ totalMinor: 60_000, bank: { accountNumber: "87654321" } });
    expect(v.progress).toMatchObject({ payees: 2, paidPayees: 0, totalMinor: 145_000, owedMinor: 145_000 });
    expect(v.gaps.map((g) => [g.booking.artist?.name, g.kind])).toEqual([
      ["Sam Act", "UNCONFIRMED"],
      ["New Act", "WAITING"],
    ]);
  });

  it("flags gigs with stand-ins as maybe needing a check", async () => {
    const v0 = await week();
    const bandInv = v0.invoices.find((i) => i.actName === "The Band")!;
    const dep = await prisma.person.create({ data: { agencyId, firstName: "Dee", surname: "Pputy" } });
    await prisma.bookingLineup.create({ data: { bookingId: bandInv.bookingId!, personId: dep.id, change: "IN" } });
    const v = await week();
    expect(v.lineupChanged).toBe(1);
    expect(v.notes.get(bandInv.id)?.join(" ")).toContain("Dee Pputy standing in");
  });

  it("sends the week for the records once, then only what's changed", async () => {
    const r = await actions.sendPayRun(WEEK, "ALL", empty, form({}));
    expect(r?.error).toBeUndefined();
    const run = await prisma.payRun.findUniqueOrThrow({ where: { agencyId_weekStart: { agencyId, weekStart: WEEK } } });
    const v = await week();
    expect(run).toMatchObject({ sentByName: "Lucy", sentTotalMinor: v.progress.totalMinor });
    expect(run.sentAt).toBeInstanceOf(Date);
    expect([...run.sentInvoiceIds].sort()).toEqual(v.invoices.map((i) => i.id).sort());
    expect(v.changes).toMatchObject({ sent: true, changed: false });
    // No business email set: it goes to whoever pressed Send, with the CSV and the PDF.
    const msg = await prisma.message.findFirstOrThrow({ where: { agencyId, kind: "PAY_RUN" }, orderBy: { createdAt: "desc" } });
    expect(msg.to).toBe(adminEmail);
    expect(msg.body).toContain("Jo Bloggs");
    expect(msg.body).toMatch(/Attached: act-invoices-w-c-2026-06-01\.csv \(\d+ KB\), act-invoices-w-c-2026-06-01\.pdf \(\d+ KB\)/);
    expect(msg.body).not.toContain("12345678"); // never a whole account number

    // Nothing changed: nothing to send.
    expect((await actions.sendPayRun(WEEK, "CHANGES", empty, form({})))?.error).toBe("Nothing has changed since it was sent.");

    // Sam's fee changes over the weekend: the invoice is voided and reissued.
    const sam = v.invoices.find((i) => i.actName === "Sam Act")!;
    await prisma.booking.update({ where: { id: sam.bookingId! }, data: { artistFeeMinor: 65_000 } });
    expect(await invoices.reconcileActInvoice(sam.id)).toBe("reissued");
    const after = await week();
    expect(after.changes.changed).toBe(true);
    expect(after.changes.removed).toEqual([{ id: sam.id, number: sam.number, reason: "The fee changed" }]);
    expect(after.changes.added).toHaveLength(1);
    const reissued = after.invoices.find((i) => i.id === after.changes.added[0].id)!;
    expect(after.notes.get(reissued.id)?.[0]).toBe("Reissued since sent");

    await prisma.settings.update({ where: { agencyId }, data: { agencyEmail: "office@suave.invalid", accountsEmail: "accounts@suave.invalid" } });
    expect((await actions.sendPayRun(WEEK, "CHANGES", empty, form({})))?.ok).toContain("Changes sent to accounts@suave.invalid");
    const changes = await prisma.message.findFirstOrThrow({ where: { agencyId, kind: "PAY_RUN", to: "accounts@suave.invalid" } });
    expect(changes.body).toContain(reissued.number);
    expect(changes.body).toContain(`${sam.number} voided`);
    expect(changes.body).not.toContain("Jo Bloggs"); // only the changes
    const done = await week();
    expect(done.changes.changed).toBe(false);
    expect(done.sends.map((s) => s.kind)).toEqual(["ALL", "CHANGES"]);
    // Paying isn't a change.
    expect(done.run?.sentAt?.getTime()).toBe(run.sentAt?.getTime());
  });

  it("marks one payee paid in one go, through the usual payments, and undoes it", async () => {
    const v = await week();
    const joRow = v.payees.find((p) => p.name === "Jo Bloggs")!;
    const r = await actions.payPayees(WEEK, empty, form({ payee: joRow.key, ...rowFields(joRow) }));
    expect(r?.ok).toBe("Paid: Jo Bloggs, £850.00 (2 invoices).");
    const paidRow = (await week()).payees.find((p) => p.name === "Jo Bloggs")!;
    expect(paidRow.paid).toBe(true);
    for (const i of joRow.invoices) {
      const pays = await prisma.payment.findMany({ where: { bookingId: i.bookingId!, direction: "OUT" } });
      expect(pays.map((p) => [p.amountMinor, p.note])).toEqual([[i.totalMinor, `Invoice ${i.number}`]]);
    }
    // Pressed twice: nothing more is paid.
    expect((await actions.payPayees(WEEK, empty, form({ payee: joRow.key, ...rowFields(joRow) })))?.ok).toBe("Already paid.");

    // Undo: payments off, invoices back to unpaid, the gig back to Confirmed if it had been settled.
    const undo = await actions.payPayees(WEEK, empty, form({ undo: paidRow.key, ...rowFields(paidRow) }));
    expect(undo?.ok).toBe("Jo Bloggs back to unpaid (£850.00).");
    const back = (await week()).payees.find((p) => p.name === "Jo Bloggs")!;
    expect(back).toMatchObject({ paid: false, owedMinor: 85_000 });
    for (const i of joRow.invoices) {
      expect(await prisma.payment.count({ where: { bookingId: i.bookingId!, direction: "OUT" } })).toBe(0);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: i.bookingId! } })).status).toBe("CONFIRMED");
    }
  });

  it("settles a gig paid both ways, and undo puts it back", async () => {
    const act = await makeAct("Settle Act", { bankAccountName: "SETTLE" });
    const { booking } = await gigWithInvoice(act.id, at("2026-06-02T19:00:00Z"), {
      payments: { create: { direction: "IN", kind: "BALANCE", amountMinor: 90_000, paidAt: at("2026-06-02T12:00:00Z") } },
    });
    const row = (await week()).payees.find((p) => p.name === "Settle Act")!;
    await actions.payPayees(WEEK, empty, form({ payee: row.key, ...rowFields(row) }));
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("SETTLED");
    const paid = (await week()).payees.find((p) => p.name === "Settle Act")!;
    await actions.payPayees(WEEK, empty, form({ undo: paid.key, ...rowFields(paid) }));
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("CONFIRMED");
  });

  it("won't undo a payment logged on the booking some other way", async () => {
    const act = await makeAct("Other Way Act");
    const { booking } = await gigWithInvoice(act.id, at("2026-06-02T20:00:00Z"));
    await prisma.payment.create({
      data: { bookingId: booking.id, direction: "OUT", kind: "SETTLEMENT", amountMinor: 60_000, paidAt: new Date(), note: "Bank transfer" },
    });
    await invoices.syncActInvoicePaid([booking.id]);
    const row = (await week()).payees.find((p) => p.name === "Other Way Act")!;
    expect(row.paid).toBe(true);
    const r = await actions.payPayees(WEEK, empty, form({ undo: row.key, ...rowFields(row) }));
    expect(r?.error).toMatch(/paid on the booking itself/);
    expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(1);
  });

  it("marks the ticked payees paid, never another week's or another business's invoice", async () => {
    const v = await week();
    const open = v.payees.filter((p) => !p.paid);
    const [first, second] = open;
    const other = await createTestAgency(prisma, "payrun-other");
    try {
      const otherAct = await prisma.artist.create({ data: { agencyId: other.agency.id, name: "Elsewhere", ...details } });
      const ob = await prisma.booking.create({
        data: {
          agencyId: other.agency.id,
          reference: "OTHER-1",
          artistId: otherAct.id,
          status: "CONFIRMED",
          arriveBy: at("2026-06-03T18:00:00Z"),
          setStart: at("2026-06-03T19:00:00Z"),
          artistFeeMinor: 10_000,
          feeMinor: 20_000,
        },
      });
      await invoices.issueActInvoice(ob.id, { byHand: true });
      const theirs = await prisma.actInvoice.findUniqueOrThrow({ where: { liveBookingId: ob.id } });
      const nextWeek = (await week(NEXT)).invoices[0];
      const r = await actions.payPayees(
        WEEK,
        empty,
        form({
          tick: [first.key, second.key],
          ...rowFields(first),
          ...rowFields(second),
          [`ids_${first.key}`]: [...(rowFields(first)[`ids_${first.key}`] as string[]), theirs.id, nextWeek.id],
        }),
      );
      expect(r?.ok).toMatch(/^Paid: 2 payees/);
      expect((await prisma.actInvoice.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe("ISSUED");
      expect((await prisma.actInvoice.findUniqueOrThrow({ where: { id: nextWeek.id } })).status).toBe("ISSUED");
      const after = await week();
      for (const p of [first, second]) expect(after.payees.find((x) => x.key === p.key)?.paid).toBe(true);
    } finally {
      await removeTestAgency(prisma, other.agency.id);
    }
  });

  it("marks all paid after a confirm, and the week shows as paid", async () => {
    const v = await week();
    const ids = v.payees.flatMap((p) => p.invoices.filter((i) => i.owedMinor > 0).map((i) => i.id));
    expect(ids.length).toBeGreaterThan(0);
    const ask = await actions.payWholeWeek(WEEK, empty, form({ id: ids }));
    expect(ask?.confirm?.title).toMatch(/^Mark all \d+ payees? paid\?$/);
    expect((await week()).progress.done).toBe(false);
    const r = await actions.payWholeWeek(WEEK, empty, form({ id: ids, confirmed: "yes" }));
    expect(r?.ok).toMatch(/^All paid:/);
    const done = await week();
    expect(done.progress).toMatchObject({ done: true, owedMinor: 0 });
    expect(done.progress.paidPayees).toBe(done.progress.payees);
    expect((await actions.payWholeWeek(WEEK, empty, form({ id: ids })))?.ok).toBe("Everyone's paid already.");
  });

  it("emails 'ready to check' once on Monday morning in office hours, to the accounts email", async () => {
    const count = () => prisma.message.count({ where: { agencyId, kind: "PAY_RUN", subject: { startsWith: "Last week's pay run" } } });
    // Sunday evening, and Monday 08:30 BST: not yet.
    await server.runPayRunReminders(at("2026-06-07T18:00:00Z"));
    await server.runPayRunReminders(at("2026-06-08T07:30:00Z"));
    expect(await count()).toBe(0);
    // Monday 10:00 BST: sent, once, however often the scheduler runs.
    await server.runPayRunReminders(at("2026-06-08T09:00:00Z"));
    await server.runPayRunReminders(at("2026-06-08T09:01:00Z"));
    await server.runPayRunReminders(at("2026-06-09T09:00:00Z"));
    expect(await count()).toBe(1);
    const v = await week();
    const msg = await prisma.message.findFirstOrThrow({ where: { agencyId, kind: "PAY_RUN", subject: { startsWith: "Last week's pay run" } } });
    expect(msg.to).toBe("accounts@suave.invalid");
    expect(msg.subject).toBe(
      `Last week's pay run is ready to check: ${v.invoices.length} invoices, £${(v.progress.totalMinor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
    );
    expect(msg.body).toContain(`/payments/run?week=${WEEK}`);
  });

  it("with no accounts email the reminder goes to each admin, on the first weekday it can", async () => {
    await prisma.settings.update({ where: { agencyId }, data: { accountsEmail: "" } });
    // The week after: its gig (the Monday 00:30 one) is in it. Monday is a bank holiday-ish miss: sent on Tuesday.
    const count = () => prisma.message.count({ where: { agencyId, kind: "PAY_RUN", subject: { startsWith: "Last week's pay run" }, to: adminEmail } });
    await server.runPayRunReminders(at("2026-06-20T10:00:00Z")); // Saturday
    expect(await count()).toBe(0);
    await server.runPayRunReminders(at("2026-06-16T10:00:00Z")); // Tuesday 11:00 BST
    expect(await count()).toBe(1);
  });

  it("lays the payment list out for the business's bank, and leaves out bad bank details to fix first", async () => {
    // Saved from the pay run page: their own layout, semicolons, no header row.
    const saved = await actions.saveBankFile(
      empty,
      form({
        preset: "CUSTOM",
        col_field_0: "sort_code_dashes",
        col_field_1: "account_number",
        col_header_1: "Acc",
        col_field_2: "amount_pence",
        col_field_3: "",
        col_field_4: "reference",
        separator: ";",
        dateFormat: "YYYY-MM-DD",
        referenceMax: "18",
        nameMax: "18",
      }),
    );
    expect(saved?.ok).toBe("Bank file saved: Custom.");
    const settings = await prisma.settings.findUniqueOrThrow({ where: { agencyId } });
    expect(settings.bankFile).toMatchObject({
      preset: "CUSTOM",
      custom: {
        header: false,
        separator: ";",
        columns: [
          { field: "sort_code_dashes", header: "Sort code" },
          { field: "account_number", header: "Acc" },
          { field: "amount_pence" },
          { field: "reference" },
        ],
      },
    });
    expect((await actions.saveBankFile(empty, form({ preset: "CUSTOM", separator: "," })))?.error).toBe("Choose at least one column for your own layout");

    const badSort = await makeAct("Bad Sort Act", { bankSortCode: "12-34" });
    await gigWithInvoice(badSort.id, at("2026-06-02T21:00:00Z"));
    const short = await makeAct("Short Account Act", { bankAccountNumber: "1234567" });
    await gigWithInvoice(short.id, at("2026-06-02T22:00:00Z"));
    const v = await server.payRunWeek(agencyId, WEEK, { timeZone: tz, business: "Suave Agency", bankFile: settings.bankFile });
    expect(v.bank.problems).toEqual([
      { key: `a_${badSort.id}`, payeeName: "Bad Sort Act", artistId: badSort.id, problems: ["Sort code 12-34 isn't 6 digits"] },
    ]);
    expect(v.bank.rows).toEqual([["12-34-56", "01234567", "60000", expect.stringMatching(/^Suave SB-\d{4}$/)]]);
    expect(v.bank.text).not.toContain("Sort code"); // no header row
  });
});
