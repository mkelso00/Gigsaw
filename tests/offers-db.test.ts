import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { offerResetFor } from "@/lib/offer-links";

// Database test for answering offers. It makes and removes its own business, so it only runs
// against a throwaway database (named gigsaw_test or gigsaw_w…), never the real one:
//   DATABASE_URL=postgresql://…/gigsaw_test npx vitest run tests/offers-db.test.ts

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const url = process.env.DATABASE_URL ?? "";
const testDb = /^gigsaw_(test|w\w+)$/.test(url.split("?")[0].split("/").pop() ?? "");

type Db = typeof import("@/lib/db");
type Offers = typeof import("@/lib/offers");
type Actions = typeof import("@/actions/offers");

describe.skipIf(!testDb)("offers (database)", () => {
  // Loaded here rather than at the top, so a skipped run never touches the database.
  let prisma: Db["prisma"];
  let answerOffer: Offers["answerOffer"];
  let sendOffers: Offers["sendOffers"];
  let answerByToken: Actions["answerByToken"];
  let acceptAllByToken: Actions["acceptAllByToken"];
  let agencyId = "";
  let actA = "";
  let actB = "";
  let ref = 0;
  const day = 24 * 3_600_000;

  // Demo bookings, so nothing is ever sent.
  const awaiting = async (artistId: string) => {
    const setStart = new Date(Date.now() + 7 * day);
    const b = await prisma.booking.create({
      data: { agencyId, reference: `T-${++ref}`, artistId, status: "AWAITING", arriveBy: setStart, setStart, timezone: "Europe/London", demo: true },
    });
    await sendOffers([b.id]);
    return prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ answerOffer, sendOffers } = await import("@/lib/offers"));
    ({ answerByToken, acceptAllByToken } = await import("@/actions/offers"));
    const agency = await prisma.agency.create({ data: { name: "Offer test agency" } });
    agencyId = agency.id;
    actA = (await prisma.artist.create({ data: { agencyId, name: "Act A", demo: true } })).id;
    actB = (await prisma.artist.create({ data: { agencyId, name: "Act B", demo: true } })).id;
  });

  afterAll(async () => {
    if (!agencyId) return;
    await prisma.activity.deleteMany({ where: { agencyId } });
    await prisma.booking.deleteMany({ where: { agencyId, archivedAt: undefined } });
    await prisma.artist.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await prisma.$disconnect();
  });

  it("records only one of two accepts at once", async () => {
    const b = await awaiting(actA);
    const results = await Promise.all([answerOffer(b.id, "ACCEPTED", { artistId: actA }), answerOffer(b.id, "ACCEPTED", { artistId: actA })]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.status).toBe("CONFIRMED");
    expect(await prisma.activity.count({ where: { entityId: b.id, action: "act accepted the offer" } })).toBe(1);
  });

  it("doesn't let a decline overwrite an accept", async () => {
    const b = await awaiting(actA);
    expect(await answerOffer(b.id, "ACCEPTED", { artistId: actA })).toBe(true);
    expect(await answerOffer(b.id, "DECLINED", { artistId: actA })).toBe(false);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).offerResponse).toBe("ACCEPTED");
  });

  it("makes a new link when the offer is sent again", async () => {
    const b = await awaiting(actA);
    await sendOffers([b.id]);
    const again = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(again.offerToken).not.toBe(b.offerToken);
    expect((await answerByToken(b.offerToken!, "ACCEPTED")).ok).toBe(false);
    expect((await answerByToken(again.offerToken!, "ACCEPTED")).ok).toBe(true);
  });

  it("stops act A's old link working once the booking is offered to act B", async () => {
    const b = await awaiting(actA);
    const oldToken = b.offerToken!;
    // What updateBooking does when the act changes, then the new offer.
    await prisma.booking.update({ where: { id: b.id }, data: { artistId: actB, ...offerResetFor(b, { artistId: actB }) } });
    await sendOffers([b.id]);
    const moved = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(moved.offerToken).not.toBe(oldToken);
    expect(moved.offeredArtistId).toBe(actB);
    expect((await answerByToken(oldToken, "ACCEPTED")).ok).toBe(false);
    expect((await acceptAllByToken(oldToken)).ok).toBe(false);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("AWAITING");
  });

  it("refuses a link still bound to the old act (links sent before this fix)", async () => {
    const b = await awaiting(actA);
    // The act changed but the token was kept, as the old code did.
    await prisma.booking.update({ where: { id: b.id }, data: { artistId: actB } });
    expect((await answerByToken(b.offerToken!, "ACCEPTED")).ok).toBe(false);
    expect((await acceptAllByToken(b.offerToken!)).ok).toBe(false);
    expect(await answerOffer(b.id, "ACCEPTED", { artistId: actA })).toBe(false);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("AWAITING");
  });
});
