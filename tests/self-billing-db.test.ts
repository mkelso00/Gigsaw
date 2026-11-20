import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// The self-billing agreement (src/lib/self-billing.ts): the act ticks it with their pay details in the app, Gigsaw
// keeps when and the exact wording, asks again after 12 months, makes invoices either way (staff see "No self-billing
// agreement"), and prints "Issued under the self-billing agreement of <date>" on invoices made under one. Staff can see
// it but can't agree for the act. The database tests run only against the test database (tests/helpers/db.ts).

const state = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  const signedIn = async () => state.user;
  return { ...real, requireUser: signedIn, requireStaff: signedIn, requireAdmin: signedIn };
});
vi.mock("@/lib/calendar-sync/queue", () => ({ queueCalendarSync: () => {} }));
vi.mock("@/components/forms", () => ({
  ActionForm: ({ children }: { children: unknown }) => children,
  ServerForm: ({ children }: { children: unknown }) => children,
  SubmitButton: ({ children }: { children: unknown }) => children,
}));

const sb = await import("@/lib/self-billing");

describe("the agreement's rules", () => {
  it("lasts 12 calendar months", () => {
    const at = new Date("2025-11-20T10:00:00Z");
    expect(sb.agreementRenewsAt(at).toISOString()).toBe("2026-11-20T10:00:00.000Z");
    expect(sb.agreementState(at, new Date("2026-11-20T09:59:00Z"))).toBe("current");
    expect(sb.agreementState(at, new Date("2026-11-20T10:00:00Z"))).toBe("expired");
    expect(sb.agreementState(null)).toBe("none");
    // 29 February plus a year is 28 February.
    expect(sb.agreementRenewsAt(new Date("2028-02-29T12:00:00Z")).toISOString()).toBe("2029-02-28T12:00:00.000Z");
    expect(sb.agreementInForce({ selfBillingAgreedAt: at }, new Date("2026-06-01"))).toEqual(at);
    expect(sb.agreementInForce({ selfBillingAgreedAt: at }, new Date("2027-01-01"))).toBeNull();
    expect(sb.agreementInForce(null)).toBeNull();
  });

  it("uses Gigsaw's wording unless the business has its own, with the business's name", () => {
    expect(sb.selfBillingWording("", "Northern Lights")).toBe(
      "Northern Lights will make out invoices for my gigs on my behalf (self-billing). I won't issue my own invoices for these gigs, and I'll tell Northern Lights if my VAT registration changes.",
    );
    expect(sb.selfBillingWording("  {business} invoices for me.\r\nAgreed.  ", "NL")).toBe("NL invoices for me.\nAgreed.");
    expect(sb.issuedUnderLine(sb.agreementDate(new Date("2026-03-04T12:00:00Z")))).toBe("Issued under the self-billing agreement of 4 March 2026.");
    for (const s of [sb.DEFAULT_SELF_BILLING_TEXT, sb.agreementNeeded(null)!, sb.agreementNeeded(new Date(0))!]) expect(s).not.toMatch(/[—–]|sorry|apolog/i);
  });
});

describeDb("the self-billing agreement (database)", () => {
  let prisma: (typeof import("@/lib/db"))["prisma"];
  let agencyId = "";
  let stamp = "";
  let admin: { id: string; agencyId: string; role: string; email: string };
  let ref = 0;
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const WORDING = "Wordsmith Music makes out my invoices for me. I'll tell Wordsmith Music if my VAT registration changes.";
  const DETAILS = { bankAccountName: "Ellie Hart", bankSortCode: "11 22 33", bankAccountNumber: "12345678", address: "1 High St\nLeeds", vatNumber: "" };
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    return f;
  };
  const empty = undefined as never;

  /** An act with its own login, signed in. */
  const actLogin = async (over: Record<string, unknown> = {}) => {
    const act = await prisma.artist.create({ data: { agencyId, name: `Act ${++ref}`, email: `act${ref}-${stamp}@sb.gigsaw.invalid`, ...over } });
    const user = await prisma.user.create({ data: { email: act.email, name: act.name, passwordHash: "x", role: "ARTIST", agencyId, artistId: act.id } });
    state.user = { ...user, agencyId };
    return act;
  };
  const finishedGig = (artistId: string) => {
    const setEnd = new Date(Date.now() - 2 * HOUR);
    const setStart = new Date(setEnd.getTime() - 2 * HOUR);
    return prisma.booking.create({
      data: {
        agencyId,
        reference: `SB-T-${stamp}-${++ref}`,
        artistId,
        status: "CONFIRMED",
        dealType: "BUY_SELL",
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd,
        feeMinor: 90_000,
        artistFeeMinor: 60_000,
      },
    });
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const a = await createTestAgency(prisma, "selfbilling", {
      agencyName: "Wordsmith Music",
      selfBillingAgreementText: "{business} makes out my invoices for me. I'll tell {business} if my VAT registration changes.",
    });
    agencyId = a.agency.id;
    stamp = a.stamp;
    admin = { id: a.admin.id, agencyId, role: "ADMIN", email: a.admin.email };
  });
  afterAll(async () => {
    await removeTestAgency(prisma, agencyId);
  });

  it("must be ticked with the details, and keeps when and the exact wording agreed", async () => {
    const { saveMyDetails } = await import("@/actions/act-details");
    const act = await actLogin();
    expect(await saveMyDetails("act", act.id, empty, form(DETAILS))).toEqual({
      error: "Tick to agree to Wordsmith Music making out your invoices for you (self-billing)",
    });
    // Reworded in Settings since the page was opened: read it again.
    expect(await saveMyDetails("act", act.id, empty, form({ ...DETAILS, selfBilling: "on", selfBillingText: "Something older." }))).toEqual({
      error: expect.stringMatching(/reworded/),
    });
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: act.id } })).detailsCompletedAt).toBeNull();

    const before = Date.now();
    await expect(saveMyDetails("act", act.id, empty, form({ ...DETAILS, selfBilling: "on", selfBillingText: WORDING }))).rejects.toThrow("REDIRECT /app");
    const saved = await prisma.artist.findUniqueOrThrow({ where: { id: act.id } });
    expect(saved.selfBillingAgreedText).toBe(WORDING);
    expect(saved.selfBillingAgreedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(saved.detailsCompletedAt).toBeInstanceOf(Date);
    expect(await prisma.activity.count({ where: { entityId: act.id, action: "agreed to self-billing in the app" } })).toBe(1);

    // Changing details later doesn't ask again while it's current, and keeps the date.
    await expect(saveMyDetails("act", act.id, empty, form({ address: "2 New Rd", vatNumber: "" }))).rejects.toThrow("REDIRECT /app/details?saved=1");
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: act.id } })).selfBillingAgreedAt).toEqual(saved.selfBillingAgreedAt);
  });

  it("is asked for again after 12 months, in the app and on the details form", async () => {
    const { saveMyDetails } = await import("@/actions/act-details");
    const { renderToStaticMarkup } = await import("react-dom/server");
    (globalThis as { React?: unknown }).React = await import("react");
    const { SelfBillingPrompt } = await import("@/components/self-billing-prompt");
    const old = new Date(Date.now() - 400 * DAY);
    const act = await actLogin({
      ...DETAILS,
      bankSortCode: "11-22-33",
      detailsCompletedAt: new Date(),
      selfBillingAgreedAt: old,
      selfBillingAgreedText: "Old words.",
    });
    const user = state.user as { agencyId: string; artistId: string | null; personId: string | null };
    const prompt = renderToStaticMarkup((await SelfBillingPrompt({ user, agency: "Wordsmith Music" }))!);
    expect(prompt).toContain("Please confirm self-billing again");
    expect(prompt).toContain("/app/details#self-billing");
    // Saving without the tick is refused; with it, the new date and wording are kept.
    expect((await saveMyDetails("act", act.id, empty, form({ address: "1 High St", vatNumber: "" })))?.error).toMatch(/Tick to agree/);
    await expect(
      saveMyDetails("act", act.id, empty, form({ address: "1 High St", vatNumber: "", selfBilling: "on", selfBillingText: WORDING })),
    ).rejects.toThrow("REDIRECT");
    const after = await prisma.artist.findUniqueOrThrow({ where: { id: act.id } });
    expect(after.selfBillingAgreedAt!.getTime()).toBeGreaterThan(old.getTime());
    expect(after.selfBillingAgreedText).toBe(WORDING);
    expect(await SelfBillingPrompt({ user, agency: "Wordsmith Music" })).toBeNull();
  });

  it("staff can't agree for the act: their edits leave it as it was", async () => {
    const { updatePersonPay } = await import("@/actions/act-details");
    state.user = admin;
    const person = await prisma.person.create({ data: { agencyId, firstName: "Nia", surname: "Staffed" } });
    const r = await updatePersonPay(person.id, empty, form({ ...DETAILS, selfBilling: "on", selfBillingText: WORDING, selfBillingAgreedAt: "2026-01-01" }));
    expect(r).toEqual({ ok: "Pay details saved." });
    expect(await prisma.person.findUniqueOrThrow({ where: { id: person.id } })).toMatchObject({ selfBillingAgreedAt: null, selfBillingAgreedText: "" });
  });

  it("invoices are made either way, carry the agreement in force, and say so when printed; staff see when there's none", async () => {
    const lib = await import("@/lib/act-invoices");
    const agreedAt = new Date(Date.now() - 30 * DAY);
    const withAgreement = await actLogin({
      ...DETAILS,
      bankSortCode: "11-22-33",
      detailsCompletedAt: new Date(),
      selfBillingAgreedAt: agreedAt,
      selfBillingAgreedText: WORDING,
    });
    const lapsed = await actLogin({
      ...DETAILS,
      bankSortCode: "11-22-33",
      detailsCompletedAt: new Date(),
      selfBillingAgreedAt: new Date(Date.now() - 400 * DAY),
    });
    const never = await actLogin({ ...DETAILS, bankSortCode: "11-22-33", detailsCompletedAt: new Date() });
    const [g1, g2, g3] = [await finishedGig(withAgreement.id), await finishedGig(lapsed.id), await finishedGig(never.id)];
    for (const g of [g1, g2, g3]) expect(await lib.issueActInvoice(g.id)).toHaveProperty("number");
    const inv = (id: string) => prisma.actInvoice.findUniqueOrThrow({ where: { liveBookingId: id } });
    expect((await inv(g1.id)).selfBillingAgreedAt).toEqual(agreedAt);
    expect((await inv(g2.id)).selfBillingAgreedAt).toBeNull();
    expect((await inv(g3.id)).selfBillingAgreedAt).toBeNull();

    const { renderToStaticMarkup } = await import("react-dom/server");
    (globalThis as { React?: unknown }).React = await import("react");
    const { default: Print } = await import("@/app/print/act-invoices/[id]/page");
    state.user = admin;
    const print = async (id: string) => renderToStaticMarkup(await Print({ params: Promise.resolve({ id }) }));
    expect(await print((await inv(g1.id)).id)).toContain(`Issued under the self-billing agreement of ${sb.agreementDate(agreedAt)}.`);
    expect(await print((await inv(g3.id)).id)).not.toContain("Issued under the self-billing agreement");

    // The act's page shows staff whether there's an agreement, and what was agreed.
    const { PayDetailsCard } = await import("@/components/pay-details-card");
    const card = async (artistId: string) => renderToStaticMarkup((await PayDetailsCard({ artistId, user: { ...admin, role: "AGENT" } as never }))!);
    const agreedCard = await card(withAgreement.id);
    expect(agreedCard).toContain("Self-billing agreed");
    expect(agreedCard).toContain(WORDING.replace("'", "&#x27;"));
    expect(await card(never.id)).toContain("No self-billing agreement");
    expect(await card(lapsed.id)).toMatch(/No self-billing agreement.*more than 12 months ago/);
  });
});
