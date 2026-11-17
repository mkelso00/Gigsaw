import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// A venue's bill for the month counts every gig that isn't cancelled, including ones still
// waiting for an act or a yes, unless the statuses are narrowed. Database tests: TEST_DATABASE_URL only.

vi.mock("server-only", () => ({}));

type Db = typeof import("@/lib/db");
const HOUR = 3_600_000;

describeDb("venue statement statuses (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let venueId = "";
  let n = 0;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "statement");
    agencyId = t.agency.id;
    const venue = await prisma.venue.create({ data: { agencyId, name: "Statement Arms" } });
    venueId = venue.id;
    const act = await prisma.artist.create({ data: { agencyId, name: "Statement Act" } });
    // Five gigs on 1 to 5 March 2031, one of each kind, £100 sale each.
    const make = (status: string, withAct = true) => {
      const setStart = new Date(Date.UTC(2031, 2, ++n, 20));
      return prisma.booking.create({
        data: {
          agencyId,
          venueId,
          reference: `ST-${n}-${Date.now()}`,
          status,
          artistId: withAct ? act.id : null,
          arriveBy: new Date(setStart.getTime() - HOUR),
          setStart,
          setEnd: new Date(setStart.getTime() + 2 * HOUR),
          feeMinor: 10_000,
          currency: "GBP",
        },
      });
    };
    await make("CONFIRMED");
    await make("PENDING", false); // still needs an act
    await make("AWAITING");
    await make("HOLD");
    await make("CANCELLED");
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  it("counts every gig that isn't cancelled by default, gigs with no act included", async () => {
    const { venueStatement } = await import("@/lib/venue-statement");
    const s = (await venueStatement(agencyId, venueId, "2031-03-01", "2031-03-31"))!;
    expect(s.rows.map((r) => r.b.status)).toEqual(["CONFIRMED", "PENDING", "AWAITING", "HOLD"]);
    expect(s.totals).toMatchObject({ gigs: 4, sale: 40_000, unconfirmed: 3, noAct: 1 });
  });

  it("counts only the statuses picked", async () => {
    const { venueStatement } = await import("@/lib/venue-statement");
    const s = (await venueStatement(agencyId, venueId, "2031-03-01", "2031-03-31", false, ["CONFIRMED", "SETTLED"]))!;
    expect(s.rows.map((r) => r.b.status)).toEqual(["CONFIRMED"]);
    expect(s.totals.sale).toBe(10_000);
    // Cancelled never counts, even if asked for.
    const c = (await venueStatement(agencyId, venueId, "2031-03-01", "2031-03-31", false, ["CANCELLED"]))!;
    expect(c.rows).toHaveLength(0);
  });
});
