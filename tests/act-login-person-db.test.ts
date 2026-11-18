import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { personForActLogin } from "@/lib/login-person";
import { signupStatus } from "@/lib/act-signup";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

describe("which person an act login belongs to", () => {
  const justin = { id: "p1", email: "justin@example.com" };
  const sam = { id: "p2", email: "sam@example.com" };
  it("matches the person whose email is the login's or the act's", () => {
    expect(personForActLogin({ email: "JUSTIN@example.com" }, { email: "" }, [sam, justin])).toBe("p1");
    expect(personForActLogin({ email: "other@example.com" }, { email: "justin@example.com" }, [sam, justin])).toBe("p1");
  });
  it("falls back to the act's only member, and never guesses between two", () => {
    expect(personForActLogin({ email: "other@example.com" }, { email: "" }, [justin])).toBe("p1");
    expect(personForActLogin({ email: "other@example.com" }, { email: "" }, [sam, justin])).toBeNull();
    expect(personForActLogin({ email: "x@example.com" }, { email: "" }, [])).toBeNull();
    expect(
      personForActLogin({ email: "same@example.com" }, { email: "" }, [
        { id: "a", email: "same@example.com" },
        { id: "b", email: "same@example.com" },
      ]),
    ).toBeNull();
  });
});

type Db = typeof import("@/lib/db");
const HOUR = 3_600_000;

describeDb("act logins linked to their person (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let ref = 0;
  const made = { justin: "", sam: "", solo: "", band: "", login: "", soloGig: "", bandGig: "" };

  const gig = (artistId: string, eventName: string, daysAhead: number) => {
    const setStart = new Date(Date.now() + daysAhead * 24 * HOUR);
    return prisma.booking.create({
      data: {
        agencyId,
        reference: `LP-${++ref}`,
        artistId,
        eventName,
        status: "CONFIRMED",
        dealType: "BUY_SELL",
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd: new Date(setStart.getTime() + 2 * HOUR),
        feeMinor: 90_000,
        artistFeeMinor: 60_000,
      },
    });
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "loginperson", { defaultTimezone: "Europe/London" });
    agencyId = t.agency.id;
    const email = `justin-${t.stamp}@gigsaw.invalid`;
    // Justin Crow: his own solo act, and in a band with Sam. He signed up with the solo act's email.
    const justin = await prisma.person.create({ data: { agencyId, firstName: "Justin", surname: "Crow", email } });
    const sam = await prisma.person.create({ data: { agencyId, firstName: "Sam", surname: "Lee", email: `sam-${t.stamp}@gigsaw.invalid` } });
    const solo = await prisma.artist.create({ data: { agencyId, name: "Justin Crow", email } });
    const band = await prisma.artist.create({ data: { agencyId, name: "The Crows" } });
    await prisma.personAct.createMany({
      data: [
        { personId: justin.id, artistId: solo.id },
        { personId: justin.id, artistId: band.id },
        { personId: sam.id, artistId: band.id },
      ],
    });
    const login = await prisma.user.create({ data: { email, name: "Justin Crow", passwordHash: "x", role: "ARTIST", agencyId, artistId: solo.id } });
    Object.assign(made, { justin: justin.id, sam: sam.id, solo: solo.id, band: band.id, login: login.id });
    made.soloGig = (await gig(solo.id, "Solo night", 5)).id;
    made.bandGig = (await gig(band.id, "Band night", 6)).id;
  });

  afterAll(async () => {
    await removeTestAgency(prisma, agencyId);
  });

  const bandStatus = async () =>
    signupStatus(
      await prisma.artist.findUniqueOrThrow({
        where: { id: made.band },
        select: { login: { select: { passwordHash: true } }, members: { select: { person: { select: { login: { select: { passwordHash: true } } } } } } },
      }),
    );

  it("the migration links an existing act login to its person, so the band counts them as signed up", async () => {
    expect(await bandStatus()).toBe("NOT_YET");
    const sql = readFileSync(path.resolve(__dirname, "../prisma/migrations/20261219010000_link_act_logins_to_people/migration.sql"), "utf8");
    const statements = sql
      .slice(sql.indexOf("-- data:start"), sql.indexOf("-- data:end"))
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(2);
    const ROLLBACK = new Error("rollback");
    let linked: string | null | undefined;
    await prisma
      .$transaction(async (tx) => {
        for (const s of statements) await tx.$executeRawUnsafe(s);
        linked = (await tx.user.findUniqueOrThrow({ where: { id: made.login } })).personId;
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
    expect(linked).toBe(made.justin);
  });

  it("the act's calendar feed carries the person's gigs in every act once linked", async () => {
    const { GET } = await import("@/app/api/calendar/[token]/route");
    const { calendarToken } = await prisma.artist.findUniqueOrThrow({ where: { id: made.solo }, select: { calendarToken: true } });
    // Fetching the feed links the login (nobody has to sign in again), and the band's gig is in it.
    const res = await GET(new Request(`http://localhost/api/calendar/${calendarToken}.ics`), { params: Promise.resolve({ token: `${calendarToken}.ics` }) });
    expect(res.status).toBe(200);
    const ics = await res.text();
    expect(ics).toContain("Solo night");
    expect(ics).toContain("Band night");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: made.login } })).personId).toBe(made.justin);
    expect(await bandStatus()).toBe("PARTLY");
  });

  it("leaves a person who already has their own login alone", async () => {
    const { linkActLoginToPerson } = await import("@/lib/login-person");
    const email = `solo2-${Date.now()}@gigsaw.invalid`;
    const act = await prisma.artist.create({ data: { agencyId, name: "Sam Solo", email } });
    await prisma.personAct.create({ data: { personId: made.sam, artistId: act.id } });
    await prisma.user.create({
      data: { email: `sam-own-${Date.now()}@gigsaw.invalid`, name: "Sam", passwordHash: "x", role: "ARTIST", agencyId, personId: made.sam },
    });
    const actLogin = await prisma.user.create({ data: { email, name: "Sam Solo", passwordHash: "x", role: "ARTIST", agencyId, artistId: act.id } });
    expect(await linkActLoginToPerson(actLogin.id)).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actLogin.id } })).personId).toBeNull();
  });
});
