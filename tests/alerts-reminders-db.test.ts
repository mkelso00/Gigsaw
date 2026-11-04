import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// The scheduler can run the overdue check and the reminders on two servers at once (or twice
// in the same minute). Each message is claimed before it's sent, so it must go exactly once.
// Runs only against the test database (see tests/helpers/db.ts). Nothing leaves the machine:
// the providers' keys are cleared, so messages are only recorded (as NOT_SENT), and the
// addresses are on .invalid.

vi.mock("server-only", () => ({}));

type Db = typeof import("@/lib/db");
const day = 24 * 3_600_000;

describeDb("alerts and reminders claims (database)", () => {
  let prisma: Db["prisma"];
  let overdueAgency = "";
  let reminderAgency = "";
  let reminderRecipient = "";

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    // After the client is made, as Prisma reads a local .env file when it starts.
    for (const k of ["RESEND_API_KEY", "MAIL_FROM", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"]) delete process.env[k];
    // Each agency only does the one job, so the two tests can't get in each other's way.
    overdueAgency = (
      await createTestAgency(prisma, "overdue", { overdueAlerts: true, alertEmail: "on-call@gigsaw.invalid", weeklyReminders: false, dayReminders: false })
    ).agency.id;
    reminderAgency = (await createTestAgency(prisma, "remind", { overdueAlerts: false, weeklyReminders: false, dayReminders: true, dayReminderTime: "12:00" }))
      .agency.id;
  });

  afterAll(async () => {
    // Reminder claims aren't tied to an agency, so they go by hand.
    if (reminderRecipient) await prisma.reminder.deleteMany({ where: { recipient: reminderRecipient } });
    await removeTestAgency(prisma, overdueAgency);
    await removeTestAgency(prisma, reminderAgency);
    await prisma.$disconnect();
  });

  it("sends an overdue alert once when the check runs several times at once", async () => {
    const { runOverdueCheck } = await import("@/lib/alerts");
    const act = await prisma.artist.create({ data: { agencyId: overdueAgency, name: "Late Act", email: "late-act@gigsaw.invalid" } });
    const now = new Date();
    const arriveBy = new Date(now.getTime() - 30 * 60_000);
    const b = await prisma.booking.create({
      data: {
        agencyId: overdueAgency,
        reference: "OD-1",
        artistId: act.id,
        status: "CONFIRMED",
        arriveBy,
        setStart: new Date(now.getTime() + 30 * 60_000),
        timezone: "Europe/London",
      },
    });
    await Promise.all([1, 2, 3, 4].map(() => runOverdueCheck(now)));
    expect(await prisma.message.count({ where: { bookingId: b.id, kind: "OVERDUE_ALERT" } })).toBe(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).overdueAlertSentAt).toEqual(now);
    // And a later run doesn't send it again.
    await runOverdueCheck(new Date(now.getTime() + 60_000));
    expect(await prisma.message.count({ where: { bookingId: b.id, kind: "OVERDUE_ALERT" } })).toBe(1);
  });

  it("sends an on-the-day reminder once when reminders run several times at once", async () => {
    const { runReminders } = await import("@/lib/reminders");
    const { addDaysToKey, localDateKey, zonedToUtc } = await import("@/lib/time");
    const act = await prisma.artist.create({ data: { agencyId: reminderAgency, name: "Early Act", email: "early-act@gigsaw.invalid" } });
    reminderRecipient = `act:${act.id}`;
    // A gig two days from now at 19:00, booked well before its reminder (12:00 that day) is due.
    const date = addDaysToKey(localDateKey(new Date(), "Europe/London"), 2);
    const arriveBy = zonedToUtc(date, "19:00", "Europe/London");
    const b = await prisma.booking.create({
      data: {
        agencyId: reminderAgency,
        reference: "RM-1",
        artistId: act.id,
        status: "CONFIRMED",
        arriveBy,
        setStart: new Date(arriveBy.getTime() + 30 * 60_000),
        timezone: "Europe/London",
        createdAt: new Date(arriveBy.getTime() - 7 * day),
      },
    });
    const now = new Date(zonedToUtc(date, "12:00", "Europe/London").getTime() + 60_000);
    await Promise.all([1, 2, 3, 4].map(() => runReminders(now)));
    expect(await prisma.message.count({ where: { bookingId: b.id, kind: "REMINDER" } })).toBe(1);
    expect(await prisma.reminder.count({ where: { kind: "DAY", recipient: reminderRecipient, key: date } })).toBe(1);
    // And the next minute's run doesn't send it again.
    await runReminders(new Date(now.getTime() + 60_000));
    expect(await prisma.message.count({ where: { bookingId: b.id, kind: "REMINDER" } })).toBe(1);
  });
});
