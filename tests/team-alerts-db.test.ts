import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Where team alerts go (Settings, Notifications): an act's answer to an offer goes to the lead agent, the events or
// gigs inbox, both or nobody, as the business has chosen, and each person's own switches still apply. Runs only
// against the test database (see tests/helpers/db.ts). The providers' keys are cleared, so messages are only
// recorded (as NOT_SENT), and every address is on .invalid.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

type Db = typeof import("@/lib/db");
type Offers = typeof import("@/lib/offers");
type TeamAlerts = typeof import("@/lib/team-alerts");
const day = 24 * 3_600_000;

describeDb("team alert routing (database)", () => {
  let prisma: Db["prisma"];
  let answerOffer: Offers["answerOffer"];
  let teamRecipients: TeamAlerts["teamRecipients"];
  let agencyId = "";
  let newAgencyId = "";
  let actId = "";
  let agentId = "";
  let adminEmail = "";
  let ref = 0;
  let stamp = "";
  const addr = (who: string) => `${who}-${stamp}@gigsaw.invalid`;

  const setRouting = (data: Prisma.SettingsUpdateInput) => prisma.settings.update({ where: { agencyId }, data });

  /** A gig offered to the act, answered now; returns the staff emails and texts it sent. */
  const answer = async (eventType: string, reply: "ACCEPTED" | "DECLINED", opts: { agent?: boolean; agency?: string } = {}) => {
    const agency = opts.agency ?? agencyId;
    const setStart = new Date(Date.now() + 14 * day);
    const b = await prisma.booking.create({
      data: {
        agencyId: agency,
        reference: `TA-${++ref}`,
        artistId: actId,
        offeredArtistId: actId,
        agentId: opts.agent === false ? null : agentId,
        status: "AWAITING",
        eventType,
        arriveBy: setStart,
        setStart,
        timezone: "Europe/London",
      },
    });
    expect(await answerOffer(b.id, reply, { artistId: actId })).toBe(true);
    const sent = await prisma.message.findMany({ where: { bookingId: b.id, kind: "BOOKING_CHANGE", OR: [{ to: { contains: stamp } }, { channel: "SMS" }] } });
    return {
      emails: sent
        .filter((m) => m.channel === "EMAIL")
        .map((m) => m.to)
        .sort(),
      texts: sent.filter((m) => m.channel === "SMS").map((m) => m.to),
    };
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ answerOffer } = await import("@/lib/offers"));
    ({ teamRecipients } = await import("@/lib/team-alerts"));
    for (const k of ["RESEND_API_KEY", "MAIL_FROM", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"]) delete process.env[k];
    const t = await createTestAgency(prisma, "routing");
    stamp = t.stamp;
    agencyId = t.agency.id;
    adminEmail = t.admin.email;
    // An act with no email or phone of its own, so the only messages are the team's.
    actId = (await prisma.artist.create({ data: { agencyId, name: `Routing act ${stamp}` } })).id;
    agentId = (
      await prisma.user.create({ data: { email: addr("agent"), name: "Sam Agent", phone: "+447700900123", passwordHash: "x", role: "AGENT", agencyId } })
    ).id;
    // A business made after the setting, with its column defaults.
    newAgencyId = (await createTestAgency(prisma, "routing-new")).agency.id;
  });

  beforeEach(async () => {
    // Like a business from before the setting: everything to the lead agent. Each test sets what it needs.
    await setRouting({ alertRouting: {}, agencyEmail: addr("office"), eventsEmail: addr("events"), gigsEmail: addr("gigs") });
    await prisma.user.update({ where: { id: agentId }, data: { notifyPrefs: {} } });
  });

  afterAll(async () => {
    await removeTestAgency(prisma, agencyId);
    await removeTestAgency(prisma, newAgencyId);
    await prisma.$disconnect();
  });

  it("emails the events inbox and not the agent when an act accepts a wedding gig, when set so", async () => {
    await setRouting({ alertRouting: { ACCEPTED: { EVENTS: "INBOX", GIGS: "AGENT" } } });
    expect(await answer("WEDDING", "ACCEPTED")).toEqual({ emails: [addr("events")], texts: [] });
    // A venue gig still goes to the agent.
    expect((await answer("GIG", "ACCEPTED")).emails).toEqual([addr("agent")]);
  });

  it("sends a venue gig decline to the gigs inbox, with no email or text to the agent", async () => {
    await setRouting({ alertRouting: { DECLINED: { EVENTS: "AGENT", GIGS: "INBOX" } } });
    expect(await answer("GIG", "DECLINED")).toEqual({ emails: [addr("gigs")], texts: [] });
  });

  it("Both: the inbox and the agent, who still gets the text", async () => {
    await setRouting({ alertRouting: { DECLINED: { GIGS: "BOTH" } } });
    expect(await answer("GIG", "DECLINED")).toEqual({ emails: [addr("agent"), addr("gigs")].sort(), texts: ["+447700900123"] });
  });

  it("Nobody: nobody at all", async () => {
    await setRouting({ alertRouting: { ACCEPTED: { EVENTS: "NOBODY" }, DECLINED: { GIGS: "NOBODY" } } });
    expect(await answer("WEDDING", "ACCEPTED")).toEqual({ emails: [], texts: [] });
    expect(await answer("GIG", "DECLINED")).toEqual({ emails: [], texts: [] });
  });

  it("keeps each person's own switch: an agent who turned it off doesn't get it, the inbox still does", async () => {
    await prisma.user.update({ where: { id: agentId }, data: { notifyPrefs: { DECLINED: { email: false, text: false } } } });
    await setRouting({ alertRouting: { DECLINED: { GIGS: "BOTH", EVENTS: "AGENT" } } });
    expect(await answer("GIG", "DECLINED")).toEqual({ emails: [addr("gigs")], texts: [] });
    // On the lead agent alone, switched off is off: no business email instead, as before.
    expect(await answer("WEDDING", "DECLINED")).toEqual({ emails: [], texts: [] });
  });

  it("defaults match today's behaviour for a business from before the setting", async () => {
    // Inboxes filled in, nothing chosen: still the lead agent, or the business email with no agent.
    expect((await answer("WEDDING", "ACCEPTED")).emails).toEqual([addr("agent")]);
    expect(await answer("GIG", "DECLINED")).toEqual({ emails: [addr("agent")], texts: ["+447700900123"] });
    expect((await answer("WEDDING", "ACCEPTED", { agent: false })).emails).toEqual([addr("office")]);
    // The others, read straight from teamRecipients.
    const events = { context: "EVENTS" as const, agent: agentId };
    for (const alert of ["LATE", "SIGNED", "QUOTE", "PAID", "PLANNER", "CHECK_INS"] as const)
      expect((await teamRecipients(agencyId, alert, events)).emails, alert).toEqual([addr("agent")]);
    // A late act never went to the business email (the on-call contact covers it), so it still doesn't.
    expect((await teamRecipients(agencyId, "LATE", { context: "GIGS" })).emails).toEqual([]);
    expect((await teamRecipients(agencyId, "SIGNED", { context: "GIGS" })).emails).toEqual([addr("office")]);
    // New leads: Enquiry form says the business email (its default), so the business email.
    expect((await teamRecipients(agencyId, "ENQUIRY")).emails).toEqual([addr("office")]);
    // Billing reminders: the business email, else each admin. Pay run: the accounts email, else each admin.
    expect((await teamRecipients(agencyId, "BILLING")).emails).toEqual([addr("office")]);
    expect((await teamRecipients(agencyId, "PAY_RUN")).emails).toEqual([adminEmail]);
    await setRouting({ agencyEmail: "", accountsEmail: addr("accounts") });
    expect((await teamRecipients(agencyId, "BILLING")).emails).toEqual([adminEmail]);
    expect((await teamRecipients(agencyId, "PAY_RUN")).emails).toEqual([addr("accounts")]);
    await setRouting({ accountsEmail: "" });
  });

  it("new businesses: wedding and event alerts go to the events inbox once it's set", async () => {
    const s = await prisma.settings.findUniqueOrThrow({ where: { agencyId: newAgencyId } });
    expect(s.alertRouting).toEqual({ _defaults: "SHARED" });
    const agent = (
      await prisma.user.create({ data: { email: `agent2-${stamp}@gigsaw.invalid`, name: "Kim", passwordHash: "x", role: "AGENT", agencyId: newAgencyId } })
    ).id;
    const opts = { context: "EVENTS" as const, agent };
    // No inbox yet: the lead agent, as before.
    expect((await teamRecipients(newAgencyId, "ACCEPTED", opts)).emails).toEqual([agent2()]);
    await prisma.settings.update({ where: { agencyId: newAgencyId }, data: { eventsEmail: addr("new-events") } });
    expect((await teamRecipients(newAgencyId, "ACCEPTED", opts)).emails).toEqual([addr("new-events")]);
    expect((await teamRecipients(newAgencyId, "CHECK_INS", opts)).emails).toEqual([addr("new-events")]);
    expect((await teamRecipients(newAgencyId, "LATE", opts)).emails).toEqual([addr("new-events"), agent2()]);
    // Venue gigs stay with the agent.
    expect((await teamRecipients(newAgencyId, "ACCEPTED", { ...opts, context: "GIGS" })).emails).toEqual([agent2()]);
    function agent2() {
      return `agent2-${stamp}@gigsaw.invalid`;
    }
  });

  it("saves the inboxes and the table from the settings form, for admins", async () => {
    const auth = await import("@/lib/auth");
    const admin = await prisma.user.findFirstOrThrow({ where: { agencyId, role: "ADMIN" } });
    const spy = vi.spyOn(auth, "requireAdmin").mockResolvedValue({ ...admin, agencyId } as Awaited<ReturnType<typeof auth.requireAdmin>>);
    try {
      const { saveSettings } = await import("@/actions/settings");
      const form = new FormData();
      form.set("eventsEmail", "Events-Saved@Gigsaw.invalid");
      form.set("gigsEmail", "");
      form.set("alertRouting__shown", "1");
      form.set("route:ACCEPTED:EVENTS", "INBOX");
      form.set("route:DECLINED:GIGS", "NOBODY");
      form.set("route:PAY_RUN:ALL", "BOTH");
      expect(await saveSettings(undefined, form)).toEqual({ ok: "Saved." });
      const s = await prisma.settings.findUniqueOrThrow({ where: { agencyId } });
      expect(s.eventsEmail).toBe("events-saved@gigsaw.invalid");
      expect(s.gigsEmail).toBe("");
      expect(s.alertRouting).toMatchObject({ ACCEPTED: { EVENTS: "INBOX", GIGS: "AGENT" }, DECLINED: { GIGS: "NOBODY" }, PAY_RUN: { ALL: "BOTH" } });
      const bad = new FormData();
      bad.set("gigsEmail", "not an email");
      expect(await saveSettings(undefined, bad)).toEqual({ error: "Check the venue gigs email address" });
    } finally {
      spy.mockRestore();
    }
  });
});
