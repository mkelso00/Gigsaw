import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Acts' self-billing invoices in Xero as bills (src/lib/xero.ts: findOrCreateXeroSupplier, createBill,
// recordBillPayment, setBillStatus; src/lib/act-invoices-xero.ts). Xero is stood in for by a fake fetch, as in
// tests/xero.test.ts: its Accounting API answers from `routes` below. The database tests run only against the test
// database (tests/helpers/db.ts).

vi.mock("server-only", () => ({}));

const xero = await import("@/lib/xero");
const { parseEnv } = await import("@/server/env");
const { sealToken } = await import("@/server/token-box");

const API = "https://xero.test/api";
const KEY = randomBytes(32);
const env = parseEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://x/y",
  XERO_CLIENT_ID: "x-client",
  XERO_CLIENT_SECRET: "x-secret",
  XERO_TOKEN_KEY: KEY.toString("base64"),
  XERO_LOGIN_BASE: "https://xero.test/login",
  XERO_IDENTITY_BASE: "https://xero.test/identity",
  XERO_API_BASE: API,
}).env;
const opts = { env, sleep: async () => {} };
const TENANT = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const billId = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`;

type Reply = { status?: number; body: unknown };
type Call = { method: string; url: string; body: string; headers: Headers };
let routes: Record<string, (call: Call) => Reply> = {};
let calls: Call[] = [];
const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const call = { method, url, body: typeof init?.body === "string" ? init.body : "", headers: new Headers(init?.headers) };
  calls.push(call);
  const key = Object.keys(routes)
    .sort((a, b) => b.length - a.length)
    .find((k) => {
      const [m, prefix] = k.split(" ");
      return m === method && url.startsWith(prefix);
    });
  const reply = key ? routes[key](call) : { status: 404, body: { Title: "Not found" } };
  return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "Content-Type": "application/json" } });
});
beforeEach(() => {
  vi.stubGlobal("fetch", fakeFetch);
  calls = [];
  routes = {};
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const json = (c: Call) => JSON.parse(c.body);
const api = (path: string) => `${API}/api.xro/2.0/${path}`;

describe("the bill Gigsaw sends", () => {
  const settings = { actFeesAccountCode: "310", billStatus: "DRAFT" };
  const input = {
    invoiceNumber: "SB-0012",
    supplierName: "Ellie Hart",
    description: "Live performance by Ellie Hart at The Crown, Leeds on Sat, 12 Dec 2026",
    netMinor: 40_000,
    vatMinor: 0,
    currency: "gbp",
    date: "2026-12-13",
  };

  it("is a bill from the act, with Gigsaw's number, one line for the fee to the act fees account, and No VAT", () => {
    expect(xero.billPayload(settings, CONTACT_ID, input)).toEqual({
      Invoices: [
        {
          Type: "ACCPAY",
          Contact: { ContactID: CONTACT_ID },
          Date: "2026-12-13",
          DueDate: "2026-12-20",
          InvoiceNumber: "SB-0012",
          Status: "DRAFT",
          LineAmountTypes: "Exclusive",
          CurrencyCode: "GBP",
          LineItems: [{ Description: input.description, Quantity: 1, UnitAmount: 400, AccountCode: "310", TaxType: "NONE", TaxAmount: 0 }],
        },
      ],
    });
  });

  it("has 20% VAT on Expenses for a VAT-registered act, to the penny, and can arrive approved", () => {
    const body = xero.billPayload({ actFeesAccountCode: "325", billStatus: "AUTHORISED" }, CONTACT_ID, {
      ...input,
      netMinor: 33_333,
      vatMinor: 6_667,
      vatNumber: "GB123456789",
    });
    expect(body.Invoices[0]).toMatchObject({ Status: "AUTHORISED" });
    expect(body.Invoices[0].LineItems[0]).toEqual({
      Description: input.description,
      Quantity: 1,
      UnitAmount: 333.33,
      AccountCode: "325",
      TaxType: "INPUT2",
      TaxAmount: 66.67,
    });
  });

  it("refuses VAT without a VAT number, nothing to pay, fractions of a penny and a bad currency", () => {
    expect(() => xero.billPayload(settings, CONTACT_ID, { ...input, vatMinor: 100 })).toThrow(/no VAT number/);
    expect(() => xero.billPayload(settings, CONTACT_ID, { ...input, netMinor: 0 })).toThrow(/nothing to pay/);
    expect(() => xero.billPayload(settings, CONTACT_ID, { ...input, netMinor: 10.5 })).toThrow(/whole number of pence/);
    expect(() => xero.billPayload(settings, CONTACT_ID, { ...input, currency: "pounds" })).toThrow(/currency/);
    expect(() => xero.billPayload(settings, CONTACT_ID, { ...input, invoiceNumber: " " })).toThrow(/invoice number/);
  });

  it("links to the bill in Xero", () => {
    expect(xero.xeroBillUrl(billId(1), "!abc")).toBe(
      `https://go.xero.com/organisationlogin/default.aspx?shortcode=!abc&redirecturl=/AccountsPayable/View.aspx?InvoiceID=${billId(1)}`,
    );
  });
});

describeDb("act invoices in Xero (database)", () => {
  let prisma: (typeof import("@/lib/db"))["prisma"];
  let lib: typeof import("@/lib/act-invoices-xero");
  let agencyId = "";
  let otherAgencyId = "";
  let seq = 0;
  let bills = 0;
  /** What the stand-in Xero holds: each bill's status, total and what's been paid. */
  let xeroBills = new Map<string, { Status: string; Total: number; AmountPaid: number; AmountDue: number }>();

  const connect = (over: Record<string, unknown> = {}) =>
    prisma.xeroConnection
      .upsert({
        where: { agencyId },
        create: { agencyId },
        update: {},
      })
      .then(() =>
        prisma.xeroConnection.update({
          where: { agencyId },
          data: {
            tenantId: TENANT,
            tenantName: "Northern Lights Ltd",
            shortCode: "!nl",
            refreshTokenEnc: sealToken("refresh", KEY),
            accessTokenEnc: sealToken("access", KEY),
            accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
            needsReconnect: false,
            actFeesAccountCode: "310",
            billStatus: "AUTHORISED",
            payFromBankAccountCode: "090",
            actBillsAuto: false,
            actBillsAutoFrom: null,
            ...over,
          },
        }),
      );

  const invoice = async (over: Record<string, unknown> = {}, agency = agencyId) => {
    seq++;
    return prisma.actInvoice.create({
      data: {
        agencyId: agency,
        seq,
        number: `SB-${String(seq).padStart(4, "0")}`,
        currency: "GBP",
        netMinor: 40_000,
        totalMinor: 40_000,
        bookingRef: `BK-${seq}`,
        description: `Live performance by Ellie Hart at The Crown on gig ${seq}`,
        gigDate: new Date("2026-11-14T20:00:00Z"),
        issuedAt: new Date("2026-11-15T10:00:00Z"),
        actName: "Ellie Hart",
        payeeName: "Ellie Hart",
        ...over,
      },
    });
  };

  /** A stand-in Xero: contacts found by name or made, bills made and read back, payments and status changes. */
  const xeroAnswers = (contacts: { ContactID: string; Name: string }[] = []) => {
    routes[`GET ${api("Contacts")}`] = (c) => {
      const term = decodeURIComponent(new URL(c.url).searchParams.get("searchTerm") ?? "").toLowerCase();
      return { body: { Contacts: contacts.filter((x) => x.Name.toLowerCase().includes(term)) } };
    };
    routes[`PUT ${api("Contacts")}`] = (c) => {
      const made = { ContactID: `dddddddd-dddd-4ddd-8ddd-${String(contacts.length + 1).padStart(12, "0")}`, ...json(c).Contacts[0] };
      contacts.push(made);
      return { body: { Contacts: [made] } };
    };
    routes[`PUT ${api("Invoices")}`] = (c) => {
      const b = json(c).Invoices[0];
      const line = b.LineItems[0];
      const Total = Math.round((line.UnitAmount + line.TaxAmount) * 100) / 100;
      const id = billId(++bills);
      xeroBills.set(id, { Status: b.Status, Total, AmountPaid: 0, AmountDue: Total });
      return {
        body: { Invoices: [{ InvoiceID: id, InvoiceNumber: b.InvoiceNumber, Status: b.Status, Total, TotalTax: line.TaxAmount, CurrencyCode: "GBP" }] },
      };
    };
    routes[`GET ${api("Invoices?IDs=")}`] = (c) => {
      const ids = (new URL(c.url).searchParams.get("IDs") ?? "").split(",");
      return {
        body: {
          Invoices: ids.flatMap((id) => {
            const b = xeroBills.get(id);
            return b ? [{ InvoiceID: id, Type: "ACCPAY", CurrencyCode: "GBP", ...b }] : [];
          }),
        },
      };
    };
    routes[`POST ${api("Invoices/")}`] = (c) => {
      const b = json(c).Invoices[0];
      xeroBills.get(b.InvoiceID)!.Status = b.Status;
      return { body: { Invoices: [{ InvoiceID: b.InvoiceID, Status: b.Status }] } };
    };
    routes[`PUT ${api("Payments")}`] = (c) => {
      const p = json(c).Payments[0];
      const b = xeroBills.get(p.Invoice.InvoiceID)!;
      b.AmountPaid += p.Amount;
      b.AmountDue = Math.round((b.Total - b.AmountPaid) * 100) / 100;
      if (b.AmountDue <= 0) b.Status = "PAID";
      return { body: { Payments: [{ PaymentID: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", Status: "AUTHORISED" }] } };
    };
    return contacts;
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    lib = await import("@/lib/act-invoices-xero");
    const a = await createTestAgency(prisma, "actbills");
    agencyId = a.agency.id;
    otherAgencyId = (await createTestAgency(prisma, "actbills-other")).agency.id;
  });
  afterAll(async () => {
    await removeTestAgency(prisma, agencyId);
    await removeTestAgency(prisma, otherAgencyId);
  });
  beforeEach(async () => {
    await prisma.actInvoice.deleteMany({ where: { agencyId: { in: [agencyId, otherAgencyId] } } });
    xeroBills = new Map();
    bills = 0;
    await connect();
  });

  it("says when Xero isn't connected, without calling it", async () => {
    await prisma.xeroConnection.update({ where: { agencyId }, data: { refreshTokenEnc: "", tenantId: "" } });
    const inv = await invoice();
    const r = await lib.pushActInvoicesToXero(agencyId, [inv.id], opts);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/isn't connected/) });
    expect(r.results).toEqual([{ id: inv.id, number: inv.number, ok: false, error: expect.stringMatching(/isn't connected/) }]);
    expect(calls).toEqual([]);
  });

  it("makes a bill for each invoice, finding or adding the act as a supplier once, with VAT only for a VAT-registered act", async () => {
    const contacts = xeroAnswers([{ ContactID: CONTACT_ID, Name: "Ellie Hart" }]);
    const ellie1 = await invoice();
    const ellie2 = await invoice();
    const vat = await invoice({
      payeeName: "Jo Drummond",
      actName: "Wonderlust",
      actVatNumber: "GB123456789",
      vatPct: 20,
      vatMinor: 8_000,
      totalMinor: 48_000,
    });
    const theirs = await invoice({}, otherAgencyId);

    const r = await lib.pushActInvoicesToXero(agencyId, [ellie1.id, ellie2.id, vat.id, theirs.id], opts);
    expect(r.ok).toBe(true);
    expect(r.results).toEqual([
      { id: ellie1.id, number: ellie1.number, ok: true, action: "created", billId: billId(1), status: "AUTHORISED", url: expect.stringContaining(billId(1)) },
      { id: ellie2.id, number: ellie2.number, ok: true, action: "created", billId: billId(2), status: "AUTHORISED", url: expect.stringContaining(billId(2)) },
      { id: vat.id, number: vat.number, ok: true, action: "created", billId: billId(3), status: "AUTHORISED", url: expect.stringContaining("AccountsPayable") },
      { id: theirs.id, number: "", ok: false, error: "Invoice not found." },
    ]);

    // Ellie is found once by name (an existing contact, used as it is); Jo is added, with her VAT number.
    const searches = calls.filter((c) => c.method === "GET" && c.url.includes("/Contacts"));
    expect(searches.map((c) => decodeURIComponent(new URL(c.url).searchParams.get("searchTerm")!))).toEqual(["Ellie Hart", "Jo Drummond"]);
    const added = calls.filter((c) => c.method === "PUT" && c.url.endsWith("/Contacts"));
    expect(added.map(json)).toEqual([{ Contacts: [{ Name: "Jo Drummond", TaxNumber: "GB123456789" }] }]);
    expect(contacts).toHaveLength(2);

    const puts = calls.filter((c) => c.method === "PUT" && c.url.endsWith("/Invoices"));
    expect(puts).toHaveLength(3);
    const [b1, , b3] = puts.map((c) => json(c).Invoices[0]);
    expect(b1).toMatchObject({ Type: "ACCPAY", Contact: { ContactID: CONTACT_ID }, InvoiceNumber: ellie1.number, Status: "AUTHORISED", Date: "2026-11-15" });
    expect(b1.LineItems).toEqual([{ Description: ellie1.description, Quantity: 1, UnitAmount: 400, AccountCode: "310", TaxType: "NONE", TaxAmount: 0 }]);
    expect(b3.LineItems[0]).toMatchObject({ UnitAmount: 400, TaxType: "INPUT2", TaxAmount: 80 });
    expect(puts[0].headers.get("idempotency-key")).toBe(`gigsaw-${agencyId}-actbill-${ellie1.id}`);
    expect(puts[0].headers.get("xero-tenant-id")).toBe(TENANT);

    expect(await prisma.actInvoice.findUniqueOrThrow({ where: { id: ellie1.id } })).toMatchObject({
      xeroBillId: billId(1),
      xeroBillStatus: "AUTHORISED",
      xeroProblem: "",
    });
    expect(await prisma.actInvoice.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({ xeroBillId: "" });

    // Sending again does nothing: they're there already.
    calls = [];
    const again = await lib.pushActInvoicesToXero(agencyId, [ellie1.id], opts);
    expect(again.results).toEqual([expect.objectContaining({ id: ellie1.id, ok: true, action: "already", billId: billId(1) })]);
    expect(calls).toEqual([]);
  });

  it("keeps what Xero said was wrong with one, and carries on with the rest", async () => {
    xeroAnswers([{ ContactID: CONTACT_ID, Name: "Ellie Hart" }]);
    const bad = await invoice();
    const good = await invoice();
    const put = routes[`PUT ${api("Invoices")}`];
    routes[`PUT ${api("Invoices")}`] = (c) =>
      json(c).Invoices[0].InvoiceNumber === bad.number
        ? { status: 400, body: { Elements: [{ ValidationErrors: [{ Message: "Account code '310' is not a valid code for this document." }] }] } }
        : put(c);
    const r = await lib.pushActInvoicesToXero(agencyId, [bad.id, good.id], opts);
    expect(r.results.map((x) => [x.number, x.ok])).toEqual([
      [bad.number, false],
      [good.number, true],
    ]);
    expect((await prisma.actInvoice.findUniqueOrThrow({ where: { id: bad.id } })).xeroProblem).toMatch(/Account code '310' is not a valid code/);
  });

  it("records the payment of a paid invoice from the chosen bank account, once", async () => {
    xeroAnswers([{ ContactID: CONTACT_ID, Name: "Ellie Hart" }]);
    const inv = await invoice({ status: "PAID", paidAt: new Date("2026-11-18T12:00:00Z") });
    const unpaid = await invoice();
    await lib.pushActInvoicesToXero(agencyId, [inv.id, unpaid.id], opts);
    calls = [];
    const r = await lib.recordActInvoicePaymentsInXero(agencyId, [inv.id, unpaid.id], opts);
    expect(r.results).toEqual([
      { id: unpaid.id, number: unpaid.number, ok: true, action: "skipped", billId: expect.any(String), note: "Not paid yet." },
      { id: inv.id, number: inv.number, ok: true, action: "paid", billId: billId(1), status: "PAID" },
    ]);
    const pay = calls.find((c) => c.method === "PUT" && c.url.endsWith("/Payments"))!;
    expect(json(pay)).toEqual({
      Payments: [{ Invoice: { InvoiceID: billId(1) }, Account: { Code: "090" }, Date: "2026-11-18", Amount: 400, Reference: inv.number }],
    });
    expect(pay.headers.get("idempotency-key")).toBe(`gigsaw-${agencyId}-actpay-${inv.id}`);
    expect(await prisma.actInvoice.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({
      xeroPaymentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      xeroBillStatus: "PAID",
    });
    calls = [];
    expect((await lib.recordActInvoicePaymentsInXero(agencyId, [inv.id], opts)).results).toEqual([expect.objectContaining({ action: "already" })]);
    expect(calls).toEqual([]);
  });

  it("waits for a draft bill to be approved, and needs the bank account first", async () => {
    await connect({ billStatus: "DRAFT", payFromBankAccountCode: "" });
    xeroAnswers([{ ContactID: CONTACT_ID, Name: "Ellie Hart" }]);
    const inv = await invoice({ status: "PAID", paidAt: new Date() });
    await lib.pushActInvoicesToXero(agencyId, [inv.id], opts);
    expect(json(calls.find((c) => c.method === "PUT" && c.url.endsWith("/Invoices"))!).Invoices[0].Status).toBe("DRAFT");
    const noBank = await lib.recordActInvoicePaymentsInXero(agencyId, [inv.id], opts);
    expect(noBank).toMatchObject({ ok: false, error: expect.stringMatching(/Choose the bank account/) });
    await connect({ billStatus: "DRAFT" });
    const draft = await lib.recordActInvoicePaymentsInXero(agencyId, [inv.id], opts);
    expect(draft.results).toEqual([expect.objectContaining({ ok: false, error: expect.stringMatching(/still a draft in Xero. Approve it there/) })]);
    expect(calls.some((c) => c.url.endsWith("/Payments"))).toBe(false);
    // Approved in Xero: recorded next time.
    xeroBills.get(billId(1))!.Status = "AUTHORISED";
    expect((await lib.recordActInvoicePaymentsInXero(agencyId, [inv.id], opts)).results).toEqual([expect.objectContaining({ ok: true, action: "paid" })]);
    expect((await prisma.actInvoice.findUniqueOrThrow({ where: { id: inv.id } })).xeroProblem).toBe("");
  });

  it("says when the connection wasn't allowed to record payments, without needing reconnecting for invoices", async () => {
    xeroAnswers([{ ContactID: CONTACT_ID, Name: "Ellie Hart" }]);
    const inv = await invoice({ status: "PAID", paidAt: new Date() });
    await lib.pushActInvoicesToXero(agencyId, [inv.id], opts);
    routes[`PUT ${api("Payments")}`] = () => ({ status: 403, body: { Title: "Forbidden", Detail: "insufficient_scope" } });
    const r = await lib.recordActInvoicePaymentsInXero(agencyId, [inv.id], opts);
    expect(r).toMatchObject({ ok: false, error: xero.PAYMENTS_NOT_ALLOWED });
    expect((await prisma.xeroConnection.findUniqueOrThrow({ where: { agencyId } })).needsReconnect).toBe(false);
  });

  it("takes a voided invoice's bill out of Xero: voided when approved, deleted when a draft, flagged when it has a payment", async () => {
    xeroAnswers([{ ContactID: CONTACT_ID, Name: "Ellie Hart" }]);
    const approved = await invoice();
    const draft = await invoice();
    const paid = await invoice();
    await lib.pushActInvoicesToXero(agencyId, [approved.id, draft.id, paid.id], opts);
    xeroBills.get(billId(2))!.Status = "DRAFT";
    Object.assign(xeroBills.get(billId(3))!, { Status: "PAID", AmountPaid: 400, AmountDue: 0 });
    await prisma.actInvoice.updateMany({
      where: { id: { in: [approved.id, draft.id, paid.id] } },
      data: { status: "VOID", voidedAt: new Date(), liveBookingId: null },
    });
    calls = [];

    const r = await lib.pushActInvoicesToXero(agencyId, [approved.id, draft.id, paid.id], opts);
    expect(r.results).toEqual([
      { id: approved.id, number: approved.number, ok: true, action: "voided", billId: billId(1), status: "VOIDED" },
      { id: draft.id, number: draft.number, ok: true, action: "deleted", billId: billId(2), status: "DELETED" },
      { id: paid.id, number: paid.number, ok: false, error: expect.stringMatching(/has a payment against it/) },
    ]);
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => [c.url, json(c)])).toEqual([
      [api(`Invoices/${billId(1)}`), { Invoices: [{ InvoiceID: billId(1), Status: "VOIDED" }] }],
      [api(`Invoices/${billId(2)}`), { Invoices: [{ InvoiceID: billId(2), Status: "DELETED" }] }],
    ]);
    expect(await prisma.actInvoice.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({
      xeroBillStatus: "PAID",
      xeroProblem: expect.stringMatching(/void the bill there/),
    });
    expect(await prisma.actInvoice.findUniqueOrThrow({ where: { id: approved.id } })).toMatchObject({ xeroBillStatus: "VOIDED" });
    // Once out, it's left alone.
    calls = [];
    expect((await lib.pushActInvoicesToXero(agencyId, [approved.id], opts)).results).toEqual([expect.objectContaining({ action: "skipped" })]);
    expect(calls).toEqual([]);
  });

  it("sends by itself only when it's on, hourly in office hours, only invoices made since, and records payments", async () => {
    xeroAnswers([{ ContactID: CONTACT_ID, Name: "Ellie Hart" }]);
    const monday10 = new Date("2026-11-23T10:05:00Z");
    const before = await invoice({ issuedAt: new Date("2026-11-01T10:00:00Z") });
    const after = await invoice({ issuedAt: new Date("2026-11-20T10:00:00Z"), status: "PAID", paidAt: new Date("2026-11-21T10:00:00Z") });
    // Off: nothing.
    expect(await lib.runActBillsToXero(monday10, opts)).toEqual({ sent: 0, paid: 0, voided: 0, problems: 0 });
    await connect({ actBillsAuto: true, actBillsAutoFrom: new Date("2026-11-10T00:00:00Z") });
    // Saturday: nothing.
    expect(await lib.runActBillsToXero(new Date("2026-11-21T10:00:00Z"), opts)).toEqual({ sent: 0, paid: 0, voided: 0, problems: 0 });
    expect(await lib.runActBillsToXero(monday10, opts)).toEqual({ sent: 1, paid: 1, voided: 0, problems: 0 });
    expect(await prisma.actInvoice.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({ xeroBillId: "" });
    expect(await prisma.actInvoice.findUniqueOrThrow({ where: { id: after.id } })).toMatchObject({ xeroBillId: billId(1), xeroBillStatus: "PAID" });
    // Once an hour.
    const later = await invoice({ issuedAt: new Date("2026-11-23T10:06:00Z") });
    expect(await lib.runActBillsToXero(new Date("2026-11-23T10:30:00Z"), opts)).toEqual({ sent: 0, paid: 0, voided: 0, problems: 0 });
    expect(await lib.runActBillsToXero(new Date("2026-11-23T11:00:00Z"), opts)).toEqual({ sent: 1, paid: 0, voided: 0, problems: 0 });
    expect((await prisma.actInvoice.findUniqueOrThrow({ where: { id: later.id } })).xeroBillId).toBe(billId(2));
  });
});
