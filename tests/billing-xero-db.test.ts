import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Monthly billing with Xero (src/actions/monthly-billing.ts sendBillToXero, src/lib/monthly-billing-server.ts
// checkXeroPayments). Xero itself is stood in for: what goes to it (one line per gig, ex VAT, the PO as the
// reference, the payer as the contact, never an act's fee) and what comes back (number, total, paid) are checked.

const staff = vi.hoisted(() => ({ user: null as unknown }));
const fake = vi.hoisted(() => ({
  sent: [] as unknown[],
  statuses: new Map<string, { status: string; state: string; fullyPaidOn: string | null }>(),
  connected: true,
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireStaff: async () => staff.user,
  requireAdmin: async () => staff.user,
  requireUser: async () => staff.user,
}));
vi.mock("@/actions/xero", () => ({
  sendInvoiceToXero: async (input: unknown) => {
    fake.sent.push(input);
    return {
      ok: true,
      invoiceId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      invoiceNumber: "INV-0042",
      status: "DRAFT",
      url: "https://go.xero.com/x",
      subTotalMinor: 60_000,
      taxMinor: 12_000,
      totalMinor: 72_000,
    };
  },
}));
vi.mock("@/lib/xero", async (original) => ({
  ...(await original<typeof import("@/lib/xero")>()),
  xeroConnectionFor: async () => (fake.connected ? { id: "conn", needsReconnect: false } : null),
  getInvoiceStatuses: async (_conn: unknown, ids: string[]) => {
    const out = new Map<string, { status: string; state: string; fullyPaidOn: string | null }>();
    for (const id of ids) {
      const s = fake.statuses.get(id);
      if (s) out.set(id.toLowerCase(), s);
    }
    return out;
  },
}));

type Db = typeof import("@/lib/db");
const HOUR = 3_600_000;
const MONTH = "2031-07";

describeDb("monthly billing with Xero (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let billId = "";
  let venueId = "";
  let n = 0;

  const gig = async (day: number, promoterId: string, actId: string) => {
    const setStart = new Date(Date.UTC(2031, 6, day, 19));
    await prisma.booking.create({
      data: {
        agencyId,
        venueId,
        promoterId,
        artistId: actId,
        reference: `BX-${++n}-${Date.now()}`,
        status: "CONFIRMED",
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd: new Date(setStart.getTime() + 3 * HOUR),
        dealType: "BUY_SELL",
        feeMinor: 30_000,
        artistFeeMinor: 12_345,
        vatPct: 20,
        currency: "GBP",
        timezone: "Europe/London",
      },
    });
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "billxero", { agencyName: "Xero Test Agency", defaultTimezone: "Europe/London" });
    agencyId = t.agency.id;
    staff.user = t.user;
    venueId = (await prisma.venue.create({ data: { agencyId, name: "The Crown", timezone: "Europe/London" } })).id;
    const act = await prisma.artist.create({ data: { agencyId, name: "The Velvets" } });
    const payer = await prisma.contact.create({ data: { agencyId, name: "Accounts", company: "Crown Inns Ltd", email: "ap@crown.test" } });
    await gig(4, payer.id, act.id);
    await gig(11, payer.id, act.id);
    const { monthlyBills } = await import("@/lib/monthly-billing-server");
    const [bill] = await monthlyBills(agencyId, MONTH);
    billId = bill.id;
    await prisma.monthlyBill.update({ where: { id: billId }, data: { poNumber: "PO-7781" } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  it("sends the bill to Xero as a draft: one line per gig, ex VAT, the PO as reference, to the payer; then it's invoiced", async () => {
    const { sendBillToXero } = await import("@/actions/monthly-billing");
    const r = await sendBillToXero(billId, {});
    expect(r).toMatchObject({ ok: expect.stringContaining("INV-0042") });
    expect(fake.sent).toHaveLength(1);
    const input = fake.sent[0] as {
      contactName: string;
      contactEmail: string;
      poNumber: string;
      monthLabel: string;
      lines: { description: string; unitAmountMinor: number }[];
    };
    expect(input).toMatchObject({
      contactName: "Crown Inns Ltd",
      contactEmail: "ap@crown.test",
      poNumber: "PO-7781",
      monthLabel: "July 2031",
      currency: "GBP",
    });
    expect(input.lines).toEqual([
      { description: "4 Jul, The Crown: The Velvets, 8pm to 11pm", unitAmountMinor: 30_000 },
      { description: "11 Jul, The Crown: The Velvets, 8pm to 11pm", unitAmountMinor: 30_000 },
    ]);
    // The act's fee never goes to the client's invoice.
    expect(JSON.stringify(input)).not.toMatch(/12345|123\.45/);
    const bill = await prisma.monthlyBill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill).toMatchObject({ invoiceNumber: "INV-0042", invoicedTotalMinor: 72_000, xeroStatus: "DRAFT", xeroUrl: "https://go.xero.com/x", paidAt: null });
    expect(bill.invoicedAt).not.toBeNull();
  });

  it("marks it paid when Xero says it's paid, on Xero's date; an approved one just updates its status", async () => {
    const { checkXeroPayments } = await import("@/lib/monthly-billing-server");
    const xeroId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    fake.statuses.set(xeroId, { status: "AUTHORISED", state: "awaiting_payment", fullyPaidOn: null });
    expect(await checkXeroPayments(agencyId, MONTH)).toEqual({ checked: 1, paid: 0 });
    expect((await prisma.monthlyBill.findUniqueOrThrow({ where: { id: billId } })).xeroStatus).toBe("AUTHORISED");

    fake.statuses.set(xeroId, { status: "PAID", state: "paid", fullyPaidOn: "2031-08-14" });
    expect(await checkXeroPayments(agencyId, MONTH)).toEqual({ checked: 1, paid: 1 });
    const bill = await prisma.monthlyBill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill.xeroStatus).toBe("PAID");
    expect(bill.paidAt?.toISOString().slice(0, 10)).toBe("2031-08-14");
    // Paid bills aren't asked about again.
    expect(await checkXeroPayments(agencyId, MONTH)).toEqual({ checked: 0, paid: 0 });
  });

  it("says so when Xero isn't connected", async () => {
    fake.connected = false;
    const { checkXeroNow } = await import("@/actions/monthly-billing");
    expect(await checkXeroNow(MONTH, {})).toMatchObject({ error: expect.stringContaining("isn't connected") });
    fake.connected = true;
  });
});
