import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// A band's line-up for one booking: a member off (ill), a stand-in on. Who hears about it, who sees it, and
// that the stand-in never sees the act's fee. Database tests: TEST_DATABASE_URL only.

const state = vi.hoisted(() => ({ user: null as unknown, sent: [] as { to: string; subject: string; email: { rows?: [string, string][] } }[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/calendar-sync/queue", () => ({ queueCalendarSync: () => {} }));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  const signedIn = async () => state.user;
  return { ...real, requireUser: signedIn, requireStaff: signedIn, requireAdmin: signedIn };
});
vi.mock("@/lib/messaging", async (orig) => {
  const real = await orig<typeof import("@/lib/messaging")>();
  return {
    ...real,
    sendEmail: async (m: Parameters<typeof real.sendEmail>[0]) => {
      state.sent.push(m as never);
      return "SENT";
    },
    sendSms: async () => "SENT",
    sendPush: async () => 0,
  };
});

type Db = typeof import("@/lib/db");
const HOUR = 3_600_000;
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

describeDb("one booking's line-up (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  const stamp = Date.now().toString(36);
  let band = "";
  let singer = "";
  let guitarist = "";
  let bookingId = "";
  let otherGig = "";

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "lineup", { agencyName: "Lineup Test Music" });
    agencyId = t.agency.id;
    state.user = { ...t.admin, agencyId, role: "ADMIN", name: "Admin" };
    band = (await prisma.artist.create({ data: { agencyId, name: "The Lineup Band" } })).id;
    singer = (await prisma.person.create({ data: { agencyId, firstName: "Sally", surname: "Singer", email: `sally-${stamp}@lineup.gigsaw.invalid` } })).id;
    guitarist = (await prisma.person.create({ data: { agencyId, firstName: "Gary", surname: "Guitar", email: `gary-${stamp}@lineup.gigsaw.invalid` } })).id;
    await prisma.personAct.createMany({ data: [singer, guitarist].map((personId) => ({ personId, artistId: band })) });
    const gig = (days: number) => {
      const setStart = new Date(Date.now() + days * 24 * HOUR);
      return prisma.booking.create({
        data: {
          agencyId,
          reference: `LU-${days}-${stamp}`,
          artistId: band,
          status: "CONFIRMED",
          dealType: "BUY_SELL",
          feeMinor: 100_000,
          artistFeeMinor: 60_000,
          arriveBy: new Date(setStart.getTime() - HOUR),
          setStart,
          setEnd: new Date(setStart.getTime() + 2 * HOUR),
        },
      });
    };
    bookingId = (await gig(30)).id;
    otherGig = (await gig(40)).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  const keys = async (id: string) => {
    const { recipientsForGigs } = await import("@/lib/people");
    return ((await recipientsForGigs([{ id, artistId: band }])).get(id) ?? []).map((r) => r.key).sort();
  };

  it("takes the singer off and brings in a new stand-in, telling each of them", async () => {
    const { setOffGig, addStandIn } = await import("@/actions/lineup");
    state.sent = [];
    expect(await setOffGig(bookingId, singer, true, undefined)).toEqual({ ok: "Sally Singer is off this gig." });
    const depEmail = `dana-${stamp}@lineup.gigsaw.invalid`;
    expect(await addStandIn(bookingId, undefined, form({ firstName: "Dana", surname: "Dep", email: depEmail, phone: "07700 900111" }))).toEqual({
      ok: "Dana Dep is standing in on this gig.",
    });
    const dep = await prisma.person.findFirstOrThrow({ where: { agencyId, email: depEmail } });
    expect(state.sent.map((m) => m.to)).toEqual([`sally-${stamp}@lineup.gigsaw.invalid`, depEmail]);
    expect(state.sent[0].subject).toMatch(/^You're not needed for The Lineup Band at /);
    expect(state.sent[1].subject).toMatch(/^You're standing in with The Lineup Band: /);
    // Who hears about this gig now: the guitarist and the stand-in, not the singer. Other gigs are as they were.
    expect(await keys(bookingId)).toEqual([`person:${dep.id}`, `person:${guitarist}`].sort());
    expect(await keys(otherGig)).toEqual([`person:${guitarist}`, `person:${singer}`].sort());
  });

  it("shows each person the right gigs in their app and calendar", async () => {
    const { gigsForLogin } = await import("@/lib/lineup");
    const dep = await prisma.person.findFirstOrThrow({ where: { agencyId, firstName: "Dana" } });
    const seen = async (personId: string, actIds: string[]) =>
      (await prisma.booking.findMany({ where: { agencyId, ...gigsForLogin(actIds, personId) }, select: { id: true } })).map((b) => b.id).sort();
    expect(await seen(singer, [band])).toEqual([otherGig]); // off this one
    expect(await seen(guitarist, [band])).toEqual([bookingId, otherGig].sort());
    expect(await seen(dep.id, [])).toEqual([bookingId]); // not in the band, but on this gig
  });

  it("never shows the stand-in the act's fee", async () => {
    const { onConfirmed } = await import("@/lib/confirmations");
    state.sent = [];
    await onConfirmed(bookingId);
    const dep = await prisma.person.findFirstOrThrow({ where: { agencyId, firstName: "Dana" } });
    const toDep = state.sent.find((m) => m.to === dep.email);
    const toGary = state.sent.find((m) => m.to === `gary-${stamp}@lineup.gigsaw.invalid`);
    expect(toDep?.email.rows?.map(([k]) => k)).not.toContain("Fee");
    expect(toGary?.email.rows?.map(([k]) => k)).toContain("Fee");
    expect(state.sent.some((m) => m.to === `sally-${stamp}@lineup.gigsaw.invalid`)).toBe(false);
  });

  it("puts the singer back and takes the stand-in off again", async () => {
    const { setOffGig, removeStandIn } = await import("@/actions/lineup");
    const dep = await prisma.person.findFirstOrThrow({ where: { agencyId, firstName: "Dana" } });
    await setOffGig(bookingId, singer, false, undefined);
    await removeStandIn(bookingId, dep.id, undefined);
    expect(await keys(bookingId)).toEqual([`person:${guitarist}`, `person:${singer}`].sort());
    expect(await prisma.bookingLineup.count({ where: { bookingId } })).toBe(0);
  });
});
