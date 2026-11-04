import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Database tests for double taps: marking paid, booking from a "Yes", approving a new act. Each
// is run twice at once and must only happen once. Like offers-db.test.ts, it only runs against
// a throwaway database (named gigsaw_test or gigsaw_w…):
//   DATABASE_URL=postgresql://…/gigsaw_test npx vitest run tests/claims-db.test.ts

const staff = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));
vi.mock("@/lib/auth", () => ({ requireStaff: async () => staff.user, requireUser: async () => staff.user }));

const url = process.env.DATABASE_URL ?? "";
const testDb = /^gigsaw_(test|w\w+)$/.test(url.split("?")[0].split("/").pop() ?? "");

type Db = typeof import("@/lib/db");

describe.skipIf(!testDb)("double taps (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let actId = "";
  let ref = 0;
  const stamp = Date.now().toString(36);
  const day = 24 * 3_600_000;
  const empty = undefined as never;

  const form = (fields: Record<string, string | string[]>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
    return f;
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    // With settings already made, as every real business has.
    agencyId = (await prisma.agency.create({ data: { name: "Claims test agency", settings: { create: {} } } })).id;
    const user = await prisma.user.create({ data: { email: `claims-${stamp}@gigsaw.test`, name: "Test agent", passwordHash: "x", role: "ADMIN", agencyId } });
    staff.user = { ...user, agencyId };
    actId = (await prisma.artist.create({ data: { agencyId, name: "Act A", demo: true } })).id;
  });

  afterAll(async () => {
    if (!agencyId) return;
    await prisma.activity.deleteMany({ where: { agencyId } });
    await prisma.availabilityRequest.deleteMany({ where: { agencyId } });
    await prisma.actApplication.deleteMany({ where: { agencyId } });
    await prisma.booking.deleteMany({ where: { agencyId, archivedAt: undefined } });
    await prisma.personAct.deleteMany({ where: { person: { agencyId } } });
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.person.deleteMany({ where: { agencyId } });
    await prisma.artist.deleteMany({ where: { agencyId } });
    await prisma.settings.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await prisma.$disconnect();
  });

  it("markPaid logs the balance once", async () => {
    const { markPaid } = await import("@/actions/payments");
    const setStart = new Date(Date.now() - 2 * day);
    const b = await prisma.booking.create({
      data: { agencyId, reference: `C-${++ref}`, artistId: actId, status: "CONFIRMED", arriveBy: setStart, setStart, feeMinor: 50_000, demo: true },
    });
    const f = form({ direction: "IN", id: b.id });
    // A few at once, as a double tap plus a colleague on the same page.
    await Promise.all([1, 2, 3, 4].map(() => markPaid(empty, f)));
    const payments = await prisma.payment.findMany({ where: { bookingId: b.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0].amountMinor).toBe(50_000);
  });

  it("bookFromReply makes one booking", async () => {
    const { bookFromReply } = await import("@/actions/availability");
    const req = await prisma.availabilityRequest.create({
      data: {
        agencyId,
        date: "2026-12-12",
        startTime: "20:00",
        endTime: "22:00",
        place: "A barn",
        replies: { create: { artistId: actId, token: `r-${stamp}`, answer: "YES" } },
      },
      include: { replies: true },
    });
    const reply = req.replies[0];
    const results = await Promise.all([bookFromReply(reply.id, empty), bookFromReply(reply.id, empty)]);
    expect(results.filter((r) => r?.error)).toEqual([]);
    expect(await prisma.booking.count({ where: { agencyId, notes: req.note, eventName: "A barn" } })).toBe(1);
    const after = await prisma.availabilityReply.findUniqueOrThrow({ where: { id: reply.id } });
    expect(after.bookingId).not.toBeNull();
  });

  it("bookFromReply puts only one act on a gig that needs one", async () => {
    const { bookFromReply } = await import("@/actions/availability");
    const actB = (await prisma.artist.create({ data: { agencyId, name: "Act B", demo: true } })).id;
    const setStart = new Date(Date.now() + 9 * day);
    const gig = await prisma.booking.create({ data: { agencyId, reference: `C-${++ref}`, status: "PENDING", arriveBy: setStart, setStart, demo: true } });
    const req = await prisma.availabilityRequest.create({
      data: {
        agencyId,
        date: "2026-12-13",
        bookingId: gig.id,
        replies: {
          create: [
            { artistId: actId, token: `ra-${stamp}`, answer: "YES" },
            { artistId: actB, token: `rb-${stamp}`, answer: "YES" },
          ],
        },
      },
      include: { replies: true },
    });
    const results = await Promise.all(req.replies.map((r) => bookFromReply(r.id, empty)));
    expect(results.filter((r) => r?.error)).toHaveLength(1);
    const replies = await prisma.availabilityReply.findMany({ where: { requestId: req.id, bookingId: { not: null } } });
    expect(replies).toHaveLength(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: gig.id } })).artistId).toBe(replies[0].artistId);
  });

  it("approveApplication makes the act once", async () => {
    const { approveApplication } = await import("@/actions/join");
    const a = await prisma.actApplication.create({
      data: { agencyId, actName: `Double Act ${stamp}`, contactName: "Sam Jones", email: `apply-${stamp}@gigsaw.test`, passwordHash: "x" },
    });
    const results = await Promise.allSettled([approveApplication(a.id, empty), approveApplication(a.id, empty)]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await prisma.artist.count({ where: { agencyId, name: a.actName } })).toBe(1);
    expect((await prisma.actApplication.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("APPROVED");
  });
});
