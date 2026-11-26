import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { signupStatus } from "@/lib/act-signup";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Someone already signed up (Sean Ellis, in a band) who gets a new act (Sean Ellis Solo) doesn't have to sign up
// again: the act goes on to his person and login (src/lib/act-person-link.ts).

const staff = vi.hoisted(() => ({ user: null as unknown, claims: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireAdmin: async () => staff.user,
  requireStaff: async () => staff.user,
}));
vi.mock("@/lib/act-claim", async (original) => ({
  ...(await original<typeof import("@/lib/act-claim")>()),
  sendClaimLink: async (email: string) => {
    staff.claims.push(email);
    return "claim";
  },
}));

type Db = typeof import("@/lib/db");

describeDb("a new act for someone already signed up (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let n = 0;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "existingsignup");
    agencyId = t.agency.id;
    staff.user = t.user;
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  /** Sean, in a band with Sam, signed up either with his own login or through the band's login (not yet joined to him). */
  const sean = async (how: "PERSON" | "BAND_LOGIN") => {
    const i = ++n;
    const email = `sean-${i}-${Date.now()}@existing.gigsaw.invalid`;
    const person = await prisma.person.create({ data: { agencyId, firstName: "Sean", surname: `Ellis ${i}`, email } });
    const sam = await prisma.person.create({ data: { agencyId, firstName: "Sam", surname: `Lee ${i}` } });
    const band = await prisma.artist.create({ data: { agencyId, name: `The Ellis Band ${i}` } });
    await prisma.personAct.createMany({
      data: [
        { personId: person.id, artistId: band.id },
        { personId: sam.id, artistId: band.id },
      ],
    });
    await prisma.user.create({
      data: {
        email,
        name: "Sean Ellis",
        passwordHash: "set",
        role: "ARTIST",
        agencyId,
        ...(how === "PERSON" ? { personId: person.id } : { artistId: band.id }),
      },
    });
    return { person, email, i };
  };
  const statusOf = async (artistId: string) =>
    signupStatus(
      await prisma.artist.findUniqueOrThrow({
        where: { id: artistId },
        select: { login: { select: { passwordHash: true } }, members: { select: { person: { select: { login: { select: { passwordHash: true } } } } } } },
      }),
    );
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("adding the act with his email puts it on him, so it's signed up straight away", async () => {
    const { createArtist } = await import("@/actions/crm");
    const s = await sean("PERSON");
    await createArtist({}, form({ name: `Sean Ellis Solo ${s.i}`, email: s.email }));
    const solo = await prisma.artist.findFirstOrThrow({ where: { agencyId, name: `Sean Ellis Solo ${s.i}` } });
    expect(await prisma.personAct.count({ where: { artistId: solo.id, personId: s.person.id } })).toBe(1);
    expect(await statusOf(solo.id)).toBe("SIGNED_UP");
  });

  it("the same when he signed up through his band's login, which is joined to him on the way", async () => {
    const { createArtist } = await import("@/actions/crm");
    const s = await sean("BAND_LOGIN");
    await createArtist({}, form({ name: `Sean Ellis Solo ${s.i}`, email: s.email }));
    const solo = await prisma.artist.findFirstOrThrow({ where: { agencyId, name: `Sean Ellis Solo ${s.i}` } });
    expect(await statusOf(solo.id)).toBe("SIGNED_UP");
    expect((await prisma.user.findFirstOrThrow({ where: { email: s.email } })).personId).toBe(s.person.id);
  });

  it("adding him to the act by name joins his band login to him, so it counts", async () => {
    const { addActMember } = await import("@/actions/people");
    const s = await sean("BAND_LOGIN");
    const solo = await prisma.artist.create({ data: { agencyId, name: `Sean Solo by name ${s.i}` } });
    expect(await statusOf(solo.id)).toBe("NOT_YET");
    await addActMember(solo.id, {}, form({ person: `Sean Ellis ${s.i}` }));
    expect(await statusOf(solo.id)).toBe("SIGNED_UP");
  });

  it("Send sign-up link adds the act to his existing login instead of refusing, and sends nothing", async () => {
    const { sendActSignupLink } = await import("@/actions/act-signup");
    const s = await sean("PERSON");
    const solo = await prisma.artist.create({ data: { agencyId, name: `Sean Solo link ${s.i}`, email: s.email } });
    staff.claims = [];
    const r = await sendActSignupLink(solo.id, {});
    expect(r).toMatchObject({ ok: expect.stringContaining("already signed up") });
    expect(staff.claims).toEqual([]);
    expect(await statusOf(solo.id)).toBe("SIGNED_UP");
  });
});
