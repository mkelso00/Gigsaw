import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

vi.mock("server-only", () => ({}));

// Adding their gigs to a calendar is a required step in the act app (src/lib/act-calendar-step.ts).
describeDb("the act app's calendar step (database)", () => {
  let prisma: (typeof import("@/lib/db"))["prisma"];
  let step: typeof import("@/lib/act-calendar-step");
  let agencyId = "";
  let stamp = "";

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    step = await import("@/lib/act-calendar-step");
    const t = await createTestAgency(prisma, "calstep");
    agencyId = t.agency.id;
    stamp = t.stamp;
  });
  afterAll(async () => {
    if (prisma) await removeTestAgency(prisma, agencyId);
  });

  const actWithLogin = async (tag: string) => {
    const act = await prisma.artist.create({ data: { agencyId, name: `Act ${tag}` } });
    const login = await prisma.user.create({
      data: { email: `${tag}-${stamp}@calstep.gigsaw.invalid`, name: tag, role: "ARTIST", agencyId, artistId: act.id, passwordHash: "x" },
    });
    return { act, login };
  };

  it("is needed until the act's feed is fetched by a calendar app", async () => {
    const { act, login } = await actWithLogin("feed");
    expect(await step.needsCalendar(login.id)).toBe(true);
    await step.markFeedFetched({ artistId: act.id });
    expect(await step.needsCalendar(login.id)).toBe(false);
    const first = (await prisma.user.findUniqueOrThrow({ where: { id: login.id } })).calendarAddedAt;
    // Later fetches keep the first date.
    await step.markFeedFetched({ artistId: act.id });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: login.id } })).calendarAddedAt).toEqual(first);
  });

  it("is done when the act says so, or has Google or Outlook connected", async () => {
    const said = await actWithLogin("said");
    await step.markCalendarAdded(said.login.id);
    expect(await step.needsCalendar(said.login.id)).toBe(false);

    const connected = await actWithLogin("connected");
    await prisma.calendarConnection.create({ data: { agencyId, userId: connected.login.id, provider: "GOOGLE", refreshTokenEnc: "x" } });
    expect(await step.needsCalendar(connected.login.id)).toBe(false);
  });

  it("only ticks off the logins of the act whose feed was fetched", async () => {
    const a = await actWithLogin("mine");
    const b = await actWithLogin("other");
    await step.markFeedFetched({ artistId: a.act.id });
    expect(await step.needsCalendar(b.login.id)).toBe(true);
  });
});
