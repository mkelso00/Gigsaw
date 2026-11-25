import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Lead stages on the Leads page (src/actions/enquiries.ts, src/lib/lapsed-leads.ts closeLead):
// New → Contacted → Proposal made, or set aside as Not going ahead with a reason. Setting a lead aside
// frees its date (its Enquiry booking, a wedding's held gigs and the wedding) and withdraws its open
// proposals, but never touches one that's been agreed. Database tests: TEST_DATABASE_URL only.

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

describeDb("lead stages (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let n = 0;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "leadstages", { defaultTimezone: "Europe/London" });
    agencyId = t.agency.id;
    staff.user = t.user;
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  const gig = (o: { status: string; ref: string; eventId?: string; artistId?: string }) =>
    prisma.booking.create({
      data: {
        agencyId,
        reference: o.ref,
        status: o.status,
        eventId: o.eventId ?? null,
        artistId: o.artistId ?? null,
        arriveBy: new Date("2030-09-14T17:00:00Z"),
        setStart: new Date("2030-09-14T18:00:00Z"),
        setEnd: new Date("2030-09-14T22:00:00Z"),
        timezone: "Europe/London",
        feeMinor: 100_000,
      },
    });

  const lead = async (o: { wedding?: boolean; proposal?: string } = {}) => {
    const stamp = `${++n}-${Date.now().toString(36)}`;
    const contact = await prisma.contact.create({ data: { agencyId, name: "Amy Jones", email: `amy-${stamp}@leadstages.gigsaw.invalid`, type: "CLIENT" } });
    const event = o.wedding
      ? await prisma.event.create({ data: { agencyId, name: `Amy's wedding ${stamp}`, type: "WEDDING", date: "2030-09-14", customerId: contact.id } })
      : null;
    const booking = o.wedding ? null : await gig({ status: "ENQUIRY", ref: `LS-${stamp}` });
    const enquiry = await prisma.enquiry.create({
      data: {
        agencyId,
        name: "Amy Jones",
        email: contact.email!,
        eventType: o.wedding ? "WEDDING" : "PRIVATE_PARTY",
        date: "2030-09-14",
        contactId: contact.id,
        bookingId: booking?.id ?? null,
        eventId: event?.id ?? null,
      },
    });
    const q = o.proposal
      ? await prisma.quote.create({
          data: {
            agencyId,
            number: `QS-${stamp}`,
            enquiryId: enquiry.id,
            eventId: event?.id ?? null,
            contactId: contact.id,
            title: "Amy's do",
            eventType: enquiry.eventType,
            status: o.proposal,
            token: randomBytes(24).toString("base64url"),
            validUntil: "2030-12-31",
          },
        })
      : null;
    return { contact, event, booking, enquiry, q, stamp };
  };

  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const leadNow = (id: string) => prisma.enquiry.findUniqueOrThrow({ where: { id } });

  it("Customer contacted moves a lead to Contacted and keeps the first time; Back to new clears it", async () => {
    const { setEnquiryStatus } = await import("@/actions/enquiries");
    const { enquiry } = await lead();
    await setEnquiryStatus(enquiry.id, "CONTACTED");
    const first = await leadNow(enquiry.id);
    expect(first.status).toBe("CONTACTED");
    expect(first.contactedAt).not.toBeNull();
    await setEnquiryStatus(enquiry.id, "CONTACTED");
    expect((await leadNow(enquiry.id)).contactedAt?.getTime()).toBe(first.contactedAt!.getTime());
    const log = await prisma.activity.findMany({ where: { agencyId, entityId: enquiry.id } });
    expect(log.map((a) => a.action)).toContain("contacted the customer");

    await setEnquiryStatus(enquiry.id, "NEW");
    expect((await leadNow(enquiry.id)).status).toBe("NEW");
  });

  it("Not going ahead sets the lead aside with its reason, frees the date and withdraws the draft", async () => {
    const { setLeadAside } = await import("@/actions/enquiries");
    const { enquiry, booking, q } = await lead({ proposal: "DRAFT" });
    const r = await setLeadAside(enquiry.id, {}, form({ reason: "Over their budget", note: "Wanted a trio for £400" }));
    expect(r).toMatchObject({ ok: expect.stringContaining("Moved to Not going ahead") });
    expect(r?.ok).toContain(booking!.reference);
    const e = await leadNow(enquiry.id);
    expect(e).toMatchObject({ status: "CLOSED", closedReason: "Over their budget: Wanted a trio for £400" });
    expect(e.doneAt).not.toBeNull();
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking!.id } })).status).toBe("CANCELLED");
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q!.id } })).status).toBe("WITHDRAWN");
    const why = await prisma.activity.findFirst({ where: { agencyId, entityId: booking!.id, action: "cancelled" } });
    expect(why?.detail).toBe("Not going ahead: Over their budget: Wanted a trio for £400");
    // One line on the lead itself, from the action.
    expect(await prisma.activity.count({ where: { agencyId, entityId: enquiry.id, action: "set a lead aside" } })).toBe(1);

    // Back to new brings it back to the list, with the reason cleared.
    const { setEnquiryStatus } = await import("@/actions/enquiries");
    await setEnquiryStatus(enquiry.id, "NEW");
    expect(await leadNow(enquiry.id)).toMatchObject({ status: "NEW", closedReason: "" });
  });

  it("cancels a wedding lead's held gigs and the wedding, but leaves a confirmed gig and the wedding alone", async () => {
    const { closeLead } = await import("@/lib/lapsed-leads");
    const a = await lead({ wedding: true, proposal: "SENT" });
    const held = await gig({ status: "HOLD", eventId: a.event!.id, ref: `LH-${a.stamp}` });
    expect(await closeLead(agencyId, a.enquiry.id, "Booked someone else")).toMatchObject({ ok: true, cancelled: [held.reference], eventCancelled: true });
    expect((await prisma.event.findUniqueOrThrow({ where: { id: a.event!.id } })).status).toBe("CANCELLED");
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: a.q!.id } })).status).toBe("WITHDRAWN");

    const b = await lead({ wedding: true });
    const firm = await gig({ status: "CONFIRMED", eventId: b.event!.id, ref: `LC-${b.stamp}` });
    expect(await closeLead(agencyId, b.enquiry.id, "No reply")).toMatchObject({ ok: true, cancelled: [], eventCancelled: false });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: firm.id } })).status).toBe("CONFIRMED");
    expect((await prisma.event.findUniqueOrThrow({ where: { id: b.event!.id } })).status).not.toBe("CANCELLED");
  });

  it("refuses a lead whose proposal has been accepted, and wants a reason", async () => {
    const { setLeadAside } = await import("@/actions/enquiries");
    const { enquiry, booking } = await lead({ proposal: "ACCEPTED" });
    expect(await setLeadAside(enquiry.id, {}, form({ reason: "No reply" }))).toMatchObject({ error: expect.stringContaining("booked") });
    expect(await setLeadAside(enquiry.id, {}, form({ reason: "made up" }))).toMatchObject({ error: expect.stringContaining("Choose why") });
    expect((await leadNow(enquiry.id)).status).toBe("NEW");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking!.id } })).status).toBe("ENQUIRY");
  });

  it("a set-aside lead stays set aside when an old proposal lapses later", async () => {
    const { freeLapsedLead } = await import("@/lib/lapsed-leads");
    const { enquiry, q } = await lead({ proposal: "SENT" });
    await prisma.enquiry.update({ where: { id: enquiry.id }, data: { status: "CLOSED", closedReason: "No reply" } });
    await prisma.quote.update({ where: { id: q!.id }, data: { status: "EXPIRED" } });
    await freeLapsedLead(q!.id);
    expect(await leadNow(enquiry.id)).toMatchObject({ status: "CLOSED", closedReason: "No reply" });
  });

  it("turning a contacted lead into a proposal moves it to Proposal made", async () => {
    const { enquiry } = await lead();
    await prisma.enquiry.update({ where: { id: enquiry.id }, data: { status: "CONTACTED", contactedAt: new Date() } });
    const { makeProposal } = await import("@/actions/proposals");
    expect(await makeProposal("enquiry", enquiry.id, {})).toBeUndefined();
    expect((await leadNow(enquiry.id)).status).toBe("DONE");
  });
});
