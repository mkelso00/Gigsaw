import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actInUseMessage } from "@/lib/archive";

describe("actInUseMessage", () => {
  it("lets an act with no bookings go", () => {
    expect(actInUseMessage({ total: 0, archived: 0 })).toBeNull();
  });

  it("counts archived bookings and says so", () => {
    expect(actInUseMessage({ total: 1, archived: 0 })).toBe("This act has 1 booking. Delete or reassign them first.");
    expect(actInUseMessage({ total: 3, archived: 3 })).toBe("This act has 3 bookings, including 3 archived. Delete or reassign them first.");
  });
});

// Against a real database (the app's client hides archived bookings, which is what these guard
// against). Run with TEST_DATABASE_URL pointing at a scratch database that has the migrations,
// e.g. TEST_DATABASE_URL=postgresql://…/gigsaw_test npx vitest run tests/archive.test.ts
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("archived bookings in guards (database)", () => {
  type Db = typeof import("@/lib/db").prisma;
  let prisma: Db;
  let agencyId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = (await import("@/lib/db")).prisma;
    const agency = await prisma.agency.create({ data: { name: `Archive test ${Date.now()}` } });
    agencyId = agency.id;
    const admin = await prisma.user.create({
      data: { email: `archive-test-${Date.now()}@gigsaw.test`, name: "Archive Test", passwordHash: "x", role: "ADMIN", agencyId },
    });
    const { addDemoData } = await import("@/lib/demo");
    await addDemoData(prisma, { agencyId, leadAgentId: admin.id });
  }, 60_000);

  afterAll(async () => {
    if (agencyId) await prisma.agency.delete({ where: { id: agencyId } });
    await prisma.$disconnect();
  });

  it("counts an act's archived bookings, which the default query hides", async () => {
    const { actBookingCounts } = await import("@/lib/archive");
    const b = await prisma.booking.findFirstOrThrow({ where: { agencyId, artistId: { not: null } } });
    const artistId = b.artistId!;
    const before = await actBookingCounts(prisma, artistId);
    await prisma.booking.update({ where: { id: b.id }, data: { archivedAt: new Date() } });
    const after = await actBookingCounts(prisma, artistId);
    expect(after).toEqual({ total: before.total, archived: before.archived + 1 });
    // The bug: the plain count drops the archived one.
    expect(await prisma.booking.count({ where: { artistId } })).toBe(before.total - before.archived - 1);
  });

  it("removes demo data even when a demo booking is archived", async () => {
    const { removeDemoData } = await import("@/lib/demo");
    await prisma.booking.updateMany({ where: { agencyId, demo: true, artistId: { not: null } }, data: { archivedAt: new Date() } });
    const res = await removeDemoData(prisma, agencyId);
    expect(res.bookings).toBeGreaterThan(0);
    expect(await prisma.booking.count({ where: { agencyId, archivedAt: undefined } })).toBe(0);
    expect(await prisma.artist.count({ where: { agencyId } })).toBe(0);
  });
});
