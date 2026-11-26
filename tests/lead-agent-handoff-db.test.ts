import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// "Who looks after what you book" (Profile; src/lib/lead-agent.ts): an owner who adds bookings hands them to the
// booking coordinator, who becomes lead agent (and gets the alerts) while the owner stays as Booked by.

const staff = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireAdmin: async () => staff.user,
  requireStaff: async () => staff.user,
  requireSignedIn: async () => staff.user,
}));

type Db = typeof import("@/lib/db");
const HOUR = 3_600_000;

describeDb("handing your bookings to the booking coordinator (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let otherAgencyId = "";
  let tom: { id: string; agencyId: string; handOffToId: string | null; name: string };
  let lucyId = "";
  let n = 0;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "handoff", { defaultTimezone: "Europe/London" });
    agencyId = t.agency.id;
    tom = t.user as typeof tom;
    staff.user = tom;
    lucyId = (await prisma.user.create({ data: { email: `lucy-${t.stamp}@handoff.gigsaw.invalid`, name: "Lucy", passwordHash: "x", role: "AGENT", agencyId } }))
      .id;
    otherAgencyId = (await createTestAgency(prisma, "handoff2")).agency.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await removeTestAgency(prisma, otherAgencyId);
    await prisma.$disconnect();
  });

  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const refresh = async () => {
    tom = { ...tom, handOffToId: (await prisma.user.findUniqueOrThrow({ where: { id: tom.id } })).handOffToId };
    staff.user = { ...(staff.user as object), handOffToId: tom.handOffToId };
  };
  const gig = (daysAhead: number, agentId: string) => {
    const setStart = new Date(Date.now() + daysAhead * 24 * HOUR);
    return prisma.booking.create({
      data: {
        agencyId,
        reference: `HO-${++n}-${Date.now()}`,
        status: "CONFIRMED",
        agentId,
        createdById: agentId,
        arriveBy: setStart,
        setStart,
        setEnd: new Date(setStart.getTime() + 2 * HOUR),
      },
    });
  };

  it("is saved on the Profile, and only to someone on the same team", async () => {
    const { saveMyHandOff } = await import("@/actions/settings");
    const outsider = await prisma.user.create({
      data: { email: `x-${Date.now()}@handoff.gigsaw.invalid`, name: "X", passwordHash: "x", role: "AGENT", agencyId: otherAgencyId },
    });
    expect(await saveMyHandOff({}, form({ handOffToId: outsider.id }))).toMatchObject({ error: expect.any(String) });
    expect(await saveMyHandOff({}, form({ handOffToId: lucyId }))).toMatchObject({ ok: expect.stringContaining("Lucy is now lead agent") });
    await refresh();
    expect(tom.handOffToId).toBe(lucyId);
  });

  it("a wedding Tom makes has Lucy as lead agent, and its gigs follow; Tom can still pick someone else", async () => {
    const { createEvent } = await import("@/actions/events");
    await createEvent({}, form({ type: "WEDDING", date: "2031-06-14", customerName: `Hannah ${Date.now()}` }));
    const wedding = await prisma.event.findFirstOrThrow({ where: { agencyId, date: "2031-06-14" }, orderBy: { createdAt: "desc" } });
    expect(wedding.agentId).toBe(lucyId);

    await createEvent({}, form({ type: "WEDDING", date: "2031-06-15", customerName: `Amy ${Date.now()}`, agentId: tom.id }));
    expect((await prisma.event.findFirstOrThrow({ where: { agencyId, date: "2031-06-15" } })).agentId).toBe(tom.id);

    const { updateEvent } = await import("@/actions/events");
    const g = await gig(30, tom.id);
    await prisma.booking.update({ where: { id: g.id }, data: { eventId: wedding.id } });
    await updateEvent(wedding.id, {}, form({ type: "WEDDING", date: "2031-06-14", customerId: wedding.customerId!, agentId: tom.id }));
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: g.id } })).agentId).toBe(tom.id);
  });

  it("a proposal Tom starts has Lucy as lead agent and Tom as its maker", async () => {
    const { createDraftProposal } = await import("@/lib/proposal-server");
    const c = await prisma.contact.create({ data: { agencyId, name: "Liv & Lewis", type: "CLIENT" } });
    const q = await createDraftProposal(tom, { contactId: c.id });
    expect(q).toMatchObject({ agentId: lucyId, createdById: tom.id });
  });

  it("hands over what Tom leads now (upcoming only), and going back to Me stops it", async () => {
    const { saveMyHandOff } = await import("@/actions/settings");
    const soon = await gig(10, tom.id);
    const past = await gig(-10, tom.id);
    const act = await prisma.artist.create({ data: { agencyId, name: "Tom's act", agentId: tom.id } });
    const r = await saveMyHandOff({}, form({ handOffToId: lucyId, moveExisting: "on" }));
    expect(r).toMatchObject({ ok: expect.stringContaining("Moved to Lucy") });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: soon.id } })).agentId).toBe(lucyId);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: past.id } })).agentId).toBe(tom.id);
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: act.id } })).agentId).toBe(lucyId);

    await saveMyHandOff({}, form({ handOffToId: "" }));
    await refresh();
    const { leadAgentFor } = await import("@/lib/lead-agent");
    expect(tom.handOffToId).toBeNull();
    expect(leadAgentFor(tom)).toBe(tom.id);
  });
});
