import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";
import { balanceDueDate } from "@/lib/event-plan";

// The wedding journey's scheduled emails (src/lib/events.ts runEventMessages): 6 months, 3 months, 4 weeks,
// 1 week and after, the coordinator's notices, secured weddings only, late bookings, and Send now.
// Database tests: TEST_DATABASE_URL only.

type Sent = { to: string; subject: string; email: { title: string; rows?: [string, string][]; intro?: string; cta?: { label: string; url: string } } };
const state = vi.hoisted(() => ({ user: null as unknown, sent: [] as Sent[] }));
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
type Events = typeof import("@/lib/events");
type Time = typeof import("@/lib/time");
const HOUR = 3_600_000;

/**
 * A time zone where it's office hours right now, so the run can use the real clock (the emails' own
 * "due by" dates read it too) and still send. One of these is always between 10am and 6pm.
 */
const ZONES = ["Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Asia/Kolkata", "Australia/Sydney", "Asia/Dubai", "Pacific/Auckland"];

describeDb("the wedding journey's scheduled emails (database)", () => {
  let prisma: Db["prisma"];
  let ev: Events;
  let time: Time;
  let agencyId = "";
  let tz = "Europe/London";
  let today = "";
  let act = "";
  let lucyId = "";
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const lucyEmail = `lucy-${stamp}@journey.gigsaw.invalid`;
  const officeEmail = `office-${stamp}@journey.gigsaw.invalid`;
  const actEmail = `band-${stamp}@journey.gigsaw.invalid`;
  let n = 0;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ev = await import("@/lib/events");
    time = await import("@/lib/time");
    const now = new Date();
    tz = ZONES.find((z) => {
      const h = time.localTime(now, z);
      return h >= "10:00" && h < "18:00";
    })!;
    today = time.localDateKey(now, tz);
    const t = await createTestAgency(prisma, "journey", {
      agencyName: "Journey Test Music",
      agencyEmail: officeEmail,
      reviewLink: "https://g.page/r/journey-test/review",
    });
    agencyId = t.agency.id;
    state.user = { ...t.admin, agencyId, role: "ADMIN", name: "Admin" };
    lucyId = (await prisma.user.create({ data: { email: lucyEmail, name: "Lucy Coordinator", passwordHash: "x", role: "AGENT", agencyId } })).id;
    act = (await prisma.artist.create({ data: { agencyId, name: "Journey Band" } })).id;
    const person = await prisma.person.create({ data: { agencyId, firstName: "Bo", surname: "Band", email: actEmail } });
    await prisma.personAct.create({ data: { personId: person.id, artistId: act } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  /** A wedding `days` from today with one act on it (sale £1,000, the act paid £600), and the couple. */
  /** Booked through the gate (src/lib/secure-event.ts), unless `secured` is false: its EV_GATE row. */
  const wedding = async (
    days: number,
    opts: { status?: string; agent?: boolean; payPlan?: string; plannerDone?: boolean; plannerSent?: boolean; secured?: boolean } = {},
  ) => {
    const i = ++n;
    const coupleEmail = `couple${i}-${stamp}@journey.gigsaw.invalid`;
    const couple = await prisma.contact.create({ data: { agencyId, type: "CLIENT", name: `Sam Couple${i}`, email: coupleEmail } });
    const date = time.addDaysToKey(today, days);
    const e = await prisma.event.create({
      data: {
        agencyId,
        name: `Wedding ${i} ${stamp}`,
        type: "WEDDING",
        date,
        timezone: tz,
        customerId: couple.id,
        agentId: opts.agent === false ? null : lucyId,
        payPlan: opts.payPlan ?? "FULL",
        plannerDoneAt: opts.plannerDone ? new Date() : null,
        plannerSentAt: opts.plannerSent ? new Date(Date.now() - 90 * 24 * HOUR) : null,
        timeline: "Ceremony 1pm",
      },
    });
    const setStart = time.zonedToUtc(date, "19:00", tz);
    const b = await prisma.booking.create({
      data: {
        agencyId,
        reference: `JR-${i}-${stamp}`,
        eventId: e.id,
        artistId: act,
        promoterId: couple.id,
        status: opts.status ?? "CONFIRMED",
        dealType: "BUY_SELL",
        feeMinor: 100_000,
        artistFeeMinor: 60_000,
        timezone: tz,
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd: new Date(setStart.getTime() + 2 * HOUR),
      },
    });
    if (opts.secured !== false) await prisma.reminder.create({ data: { kind: "EV_GATE", recipient: `event:${e.id}`, key: "" } });
    return { e, b, coupleEmail };
  };
  const to = (email: string) => state.sent.filter((m) => m.to === email);
  const claims = async (eventId: string) =>
    (await prisma.reminder.findMany({ where: { recipient: `event:${eventId}`, kind: { not: "EV_GATE" } } }))
      .map((r) => `${r.kind.replace(/^EV_/, "")}${r.key ? `:${r.key}` : ""}`)
      .sort();
  const run = async () => {
    state.sent = [];
    return ev.runEventMessages(new Date());
  };
  /** Nothing in an email to the couple may show what the act is paid (£600.00). */
  const noActFee = (m: Sent) => expect(JSON.stringify(m)).not.toContain("600.00");

  it("6 months out: asks the couple for the running order with a payment summary, and tells Lucy to get in touch, once", async () => {
    const { e, coupleEmail } = await wedding(182);
    await prisma.payment.create({
      data: {
        bookingId: (await prisma.booking.findFirstOrThrow({ where: { eventId: e.id } })).id,
        direction: "IN",
        kind: "DEPOSIT",
        amountMinor: 25_000,
        paidAt: new Date(),
      },
    });
    await run();
    const [mail] = to(coupleEmail);
    expect(to(coupleEmail)).toHaveLength(1);
    expect(mail.subject).toBe(`${e.name}: a few details from you`);
    expect(mail.email.cta?.url).toMatch(/\/w\//);
    expect(mail.email.rows).toEqual(
      expect.arrayContaining([
        ["Total", "£1,000.00"],
        ["Paid so far", "£250.00"],
        ["Left to pay", "£750.00"],
        ["Balance due", time.formatDate(new Date(`${balanceDueDate(e.date)}T12:00:00Z`), "UTC")],
      ]),
    );
    noActFee(mail);
    const [notice] = to(lucyEmail).filter((m) => m.subject.startsWith(e.name));
    expect(notice.subject).toBe(`${e.name}: 6 months to go`);
    expect(notice.email.intro).toMatch(/^Hi Lucy, .* is 6 months away\. We've asked Sam Couple\d+ for their running order\. Please get in touch with them/);
    expect(await claims(e.id)).toEqual(["PLANNER_REQUEST", "TEAM_SIX_MONTHS"]);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: e.id } })).plannerSentAt).not.toBeNull();
    // Only once.
    await run();
    expect(to(coupleEmail)).toHaveLength(0);
    expect(to(lucyEmail).filter((m) => m.subject.startsWith(e.name))).toHaveLength(0);
  });

  it("sends the coordinator's notice to the business email when the wedding has no lead agent", async () => {
    const { e } = await wedding(150, { agent: false });
    await run();
    expect(to(officeEmail).filter((m) => m.subject === `${e.name}: 5 months to go`)).toHaveLength(1);
  });

  it("3 months out: the balance and a planner reminder to the couple, Lucy told what's missing, nothing to the act", async () => {
    const { e, coupleEmail } = await wedding(91, { plannerSent: true });
    await run();
    const mails = to(coupleEmail);
    expect(mails.map((m) => m.subject).sort()).toEqual(["A quick reminder: the running order for your wedding", `${e.name}: balance of £1,000.00`].sort());
    for (const m of mails) noActFee(m);
    const balance = mails.find((m) => m.subject.includes("balance"))!;
    expect(balance.email.rows).toEqual(expect.arrayContaining([["Left to pay", "£1,000.00"]]));
    const [summary] = to(lucyEmail).filter((m) => m.subject.startsWith(e.name));
    expect(summary.subject).toBe(`${e.name}: 3 months to go, a few things missing`);
    expect(summary.email.intro).toContain("Still missing: the running order and the balance.");
    expect(summary.email.intro).toContain("We've sent Sam Couple");
    expect(summary.email.rows).toEqual(expect.arrayContaining([["Money", "£1,000.00 still to pay (we've sent a reminder)"]]));
    expect(to(actEmail).filter((m) => m.subject.includes(e.name))).toHaveLength(0);
    expect(await claims(e.id)).toEqual(["BALANCE_REMINDER", "PLANNER_CHASE", "TEAM_THREE_MONTHS"]);
  });

  it("3 months out with everything in: Lucy hears all is in hand, and the balance reminder is looked at once and not sent", async () => {
    const { e, b, coupleEmail } = await wedding(80, { plannerDone: true });
    await prisma.payment.create({ data: { bookingId: b.id, direction: "IN", kind: "BALANCE", amountMinor: 100_000, paidAt: new Date() } });
    await run();
    expect(to(coupleEmail)).toHaveLength(0);
    const [summary] = to(lucyEmail).filter((m) => m.subject.startsWith(e.name));
    expect(summary.subject).toBe(`${e.name}: 3 months to go, all in hand`);
    expect(summary.email.intro).toContain("everything's in hand");
    // Checked, not sent: the run doesn't keep loading it, and the wedding page says it wasn't needed.
    expect(await claims(e.id)).toEqual(["BALANCE_REMINDER:checked", "TEAM_THREE_MONTHS"]);
    expect((await ev.sentEventMessages(e.id)).has("BALANCE_REMINDER")).toBe(false);
  });

  it("3 months out on a deposit plan: reminds only of what's owed to the business, never the act's part", async () => {
    // Paid in cash to the act on the day: the business's part is £400, all paid, so no reminder although £600 is still to go to the act.
    const paid = await wedding(85, { payPlan: "DEPOSIT_CASH", plannerDone: true });
    await prisma.payment.create({ data: { bookingId: paid.b.id, direction: "IN", kind: "DEPOSIT", amountMinor: 40_000, paidAt: new Date() } });
    // By transfer, with £150 of the deposit still owed to the business.
    const owing = await wedding(86, { payPlan: "DEPOSIT_TRANSFER", plannerDone: true });
    await prisma.payment.create({ data: { bookingId: owing.b.id, direction: "IN", kind: "DEPOSIT", amountMinor: 25_000, paidAt: new Date() } });
    await run();
    expect(to(paid.coupleEmail)).toHaveLength(0);
    const [mail] = to(owing.coupleEmail);
    expect(mail.subject).toBe(`${owing.e.name}: deposit of £150.00`);
    expect(mail.email.rows).toEqual([
      ["Deposit to Journey Test Music", "£150.00 still to pay"],
      ["Due", "Now"],
    ]);
    noActFee(mail);
  });

  it("4 weeks out with no running order: a last call to the couple and a notice to Lucy", async () => {
    const { e, coupleEmail } = await wedding(28, { plannerSent: true });
    await run();
    const [mail] = to(coupleEmail);
    expect(mail.subject).toBe(`${e.name}: we need your running order`);
    expect(mail.email.intro).toMatch(/only 4 weeks away/);
    const [notice] = to(lucyEmail).filter((m) => m.subject.startsWith(e.name));
    expect(notice.subject).toBe(`${e.name}: running order still missing`);
    expect(notice.email.intro).toContain("we've sent them a last reminder");
  });

  it("1 week out: 'we can't wait' to the couple and the final details to the act", async () => {
    const { e, coupleEmail } = await wedding(7, { plannerDone: true });
    await run();
    const [mail] = to(coupleEmail);
    expect(to(coupleEmail)).toHaveLength(1);
    expect(mail.email.title).toBe("We can't wait!");
    expect(mail.email.intro).toBe("Hi Sam, we can't wait! There's nothing for you to worry about, we're all ready to go 👌");
    noActFee(mail);
    expect(to(actEmail).filter((m) => m.subject === `Final details: ${e.name}, ${time.formatDate(new Date(`${e.date}T12:00:00Z`), "UTC")}`)).toHaveLength(1);
    expect(await claims(e.id)).toEqual(["ACT_DETAILS", "WEEK_TO_GO"]);
  });

  it("after the day: thank you, with the review link", async () => {
    const { coupleEmail } = await wedding(-1, { plannerDone: true });
    await run();
    const [mail] = to(coupleEmail);
    expect(mail.subject).toBe("Congratulations, and thank you!");
    expect(mail.email.intro).toContain("thank you for booking Journey Band with us");
    expect(mail.email.cta).toEqual({ label: "Leave us a review", url: "https://g.page/r/journey-test/review" });
  });

  it("sends nothing to or about the couple while the wedding isn't secured (On hold or Enquiry only)", async () => {
    const held = await wedding(182, { status: "HOLD", secured: false });
    const enquiry = await wedding(91, { status: "ENQUIRY", secured: false });
    await run();
    expect(to(held.coupleEmail)).toHaveLength(0);
    expect(to(enquiry.coupleEmail)).toHaveLength(0);
    expect(to(lucyEmail).filter((m) => m.subject.startsWith(held.e.name) || m.subject.startsWith(enquiry.e.name))).toHaveLength(0);
    expect(await claims(held.e.id)).toEqual([]);
    // Once secured (the gate in src/lib/secure-event.ts claims its row), the stage that's live goes.
    await prisma.reminder.create({ data: { kind: "EV_GATE", recipient: `event:${held.e.id}`, key: "" } });
    await run();
    expect(to(held.coupleEmail)).toHaveLength(1);
  });

  it("a wedding's gigs being Pending or Confirmed doesn't start the schedule: only the gate does", async () => {
    // A gig staff added with no act yet (Pending), and one Confirmed by hand, on weddings that haven't passed the gate.
    const pending = await wedding(150, { status: "PENDING", secured: false });
    await prisma.booking.update({ where: { id: pending.b.id }, data: { artistId: null } });
    const confirmed = await wedding(91, { status: "CONFIRMED", secured: false });
    await run();
    expect(to(pending.coupleEmail)).toHaveLength(0);
    expect(to(confirmed.coupleEmail)).toHaveLength(0);
    expect(to(lucyEmail).filter((m) => m.subject.startsWith(pending.e.name) || m.subject.startsWith(confirmed.e.name))).toHaveLength(0);
    expect(await claims(pending.e.id)).toEqual([]);
    expect(await claims(confirmed.e.id)).toEqual([]);
  });

  it("tells the acts of a held wedding nothing: no final details a week before, and Send now says why", async () => {
    const { sendEventStepNow, sendPlanToActsNow } = await import("@/actions/events");
    // Not secured, its gig On hold.
    const held = await wedding(7, { status: "HOLD", plannerDone: true, secured: false });
    // Secured, but its only gig is one staff pencilled in On hold.
    const pencilled = await wedding(6, { status: "HOLD", plannerDone: true });
    await run();
    const final = (e: { name: string }) => to(actEmail).filter((m) => m.subject.startsWith(`Final details: ${e.name}`));
    expect(final(held.e)).toHaveLength(0);
    expect(final(pencilled.e)).toHaveLength(0);
    expect(to(held.coupleEmail)).toHaveLength(0);
    expect(await claims(held.e.id)).toEqual([]);
    expect(await claims(pencilled.e.id)).toEqual(["WEEK_TO_GO"]);
    state.sent = [];
    const why = "The acts are On hold until the booking is secured, so nothing goes to them yet";
    expect(await sendEventStepNow(held.e.id, "ACT_DETAILS", undefined)).toEqual({ error: why });
    expect(await sendPlanToActsNow(held.e.id, undefined)).toEqual({ error: why });
    expect(to(actEmail)).toHaveLength(0);
    // Send now that had nothing to send leaves the step unsent.
    expect(await claims(held.e.id)).toEqual([]);
    // A plan change reaches no one either.
    await prisma.event.update({ where: { id: held.e.id }, data: { timeline: "Ceremony 2pm", planChangedAt: new Date(Date.now() - HOUR) } });
    await ev.runPlanUpdates(new Date());
    expect(to(actEmail)).toHaveLength(0);
  });

  it("weddings made before the schedule started but secured after it get the stage that's live now", async () => {
    // Made at enquiry time before the start, booked (through the gate) since: new to the schedule.
    const late = await wedding(150);
    await prisma.event.update({ where: { id: late.e.id }, data: { createdAt: new Date("2026-10-01T10:00:00Z") } });
    // Made and booked before the start (no gate row, a Confirmed gig): it was part-way through this stage then.
    const old = await wedding(151, { secured: false });
    await prisma.event.update({ where: { id: old.e.id }, data: { createdAt: new Date("2026-10-01T10:00:00Z") } });
    await run();
    expect(to(late.coupleEmail).map((m) => m.subject)).toEqual([`${late.e.name}: a few details from you`]);
    expect(await claims(late.e.id)).toEqual(["PLANNER_REQUEST", "TEAM_SIX_MONTHS"]);
    expect(to(old.coupleEmail)).toHaveLength(0);
    expect(await claims(old.e.id)).toEqual([]);
  });

  it("a wedding booked before the start with only On hold gigs still gets its thank-you", async () => {
    const old = await wedding(-2, { status: "HOLD", secured: false });
    await prisma.event.update({ where: { id: old.e.id }, data: { createdAt: new Date("2026-10-01T10:00:00Z") } });
    const fresh = await wedding(-2, { status: "HOLD", secured: false });
    await run();
    expect(to(old.coupleEmail).map((m) => m.subject)).toEqual(["Congratulations, and thank you!"]);
    expect(to(old.coupleEmail)[0].email.intro).toContain("thank you for booking Journey Band with us");
    expect(to(fresh.coupleEmail)).toHaveLength(0);
  });

  it("a late booking gets only the stage that's live now: no 6-month emails 2 months out, and the first planner email is a first ask", async () => {
    const { e, coupleEmail } = await wedding(60);
    await run();
    expect(await claims(e.id)).toEqual(["BALANCE_REMINDER", "PLANNER_CHASE", "TEAM_THREE_MONTHS"]);
    const subjects = to(coupleEmail).map((m) => m.subject);
    // The planner email reads as the first ask (they were never sent the link), not a reminder.
    expect(subjects).toContain(`${e.name}: a few details from you`);
    expect(subjects).not.toContain("A quick reminder: the running order for your wedding");
    expect(subjects).toHaveLength(2);
  });

  it("Send now sends a step straight away, marks it sent and logs it; the automatic one then doesn't go", async () => {
    const { sendEventStepNow } = await import("@/actions/events");
    const { e, coupleEmail } = await wedding(170);
    state.sent = [];
    expect(await sendEventStepNow(e.id, "TEAM_SIX_MONTHS", undefined)).toEqual({ ok: "Sent." });
    expect(to(lucyEmail)).toHaveLength(1);
    expect(await sendEventStepNow(e.id, "PLANNER_REQUEST", undefined)).toEqual({ ok: "Sent." });
    expect(to(coupleEmail)).toHaveLength(1);
    expect(await claims(e.id)).toEqual(["PLANNER_REQUEST", "TEAM_SIX_MONTHS"]);
    expect((await ev.sentEventMessages(e.id)).has("TEAM_SIX_MONTHS")).toBe(true);
    const log = await prisma.activity.findMany({ where: { agencyId, entityId: e.id, action: "sent an email now" } });
    expect(log).toHaveLength(2);
    // In their window now, but already sent: the automatic run leaves them.
    await run();
    expect(to(coupleEmail)).toHaveLength(0);
    expect(to(lucyEmail).filter((m) => m.subject.startsWith(e.name))).toHaveLength(0);
    // Nothing owed once it's all paid: says so rather than sending.
    await prisma.payment.create({
      data: {
        bookingId: (await prisma.booking.findFirstOrThrow({ where: { eventId: e.id } })).id,
        direction: "IN",
        kind: "BALANCE",
        amountMinor: 100_000,
        paidAt: new Date(),
      },
    });
    expect(await sendEventStepNow(e.id, "BALANCE_REMINDER", undefined)).toEqual({ error: "Nothing is left to pay you" });
    expect(await sendEventStepNow(e.id, "NOT_A_STEP", undefined)).toEqual({ error: "Unknown email" });
    expect(await claims(e.id)).toEqual(["PLANNER_REQUEST", "TEAM_SIX_MONTHS"]);
  });

  it("Send now doesn't send a step the automatic run has just sent, unless it's Send again", async () => {
    const { sendEventStepNow } = await import("@/actions/events");
    const { e, coupleEmail } = await wedding(160);
    await run();
    expect(to(coupleEmail)).toHaveLength(1);
    // The page still showed Send now: it has just gone, so it doesn't go twice.
    state.sent = [];
    expect(await sendEventStepNow(e.id, "PLANNER_REQUEST", undefined)).toEqual({ ok: "It has just been sent." });
    expect(to(coupleEmail)).toHaveLength(0);
    // Send again (the page knew it was sent) does send it.
    const again = new FormData();
    again.append("again", "1");
    expect(await sendEventStepNow(e.id, "PLANNER_REQUEST", undefined, again)).toEqual({ ok: "Sent." });
    expect(to(coupleEmail)).toHaveLength(1);
  });

  // Runs the schedule at a later date, so it comes last: it would send the other weddings' later stages too.
  it("the 3-month emails go on the balance date for a wedding on 14 August 2027 (due 14 May), not after it", async () => {
    const { e, coupleEmail } = await wedding(200, { plannerSent: true });
    await prisma.event.update({ where: { id: e.id }, data: { date: "2027-08-14", timezone: "Europe/London" } });
    const may = (day: number) => new Date(Date.UTC(2027, 4, day, 11));
    state.sent = [];
    // 13 May, 93 days before: still the 6-month stage.
    await ev.runEventMessages(may(13));
    expect(to(coupleEmail).map((m) => m.subject)).toEqual([`${e.name}: a few details from you`]);
    // 14 May, the day the balance is due: the balance reminder, due by that day.
    state.sent = [];
    await ev.runEventMessages(may(14));
    const balance = to(coupleEmail).find((m) => m.subject.includes("balance"))!;
    const dueDay = time.formatDate(new Date("2027-05-14T12:00:00Z"), "UTC");
    expect(balance.email.rows).toEqual(expect.arrayContaining([["Due", dueDay]]));
    expect(balance.email.intro).toContain(`due by ${dueDay}`);
    const [summary] = to(lucyEmail).filter((m) => m.subject.startsWith(e.name));
    expect(summary.email.intro).toContain(`the balance is due by ${dueDay}. Still missing:`);
  });
});

describe("weddings already in the diary when the schedule started", () => {
  it("only get the stages that open after it, plus act details and thanks as before", async () => {
    const { missedAtLaunch } = await import("@/lib/events");
    const old = { createdAt: new Date("2026-10-01T10:00:00Z"), date: "2027-01-07" }; // 50 days after launch: in the 3-month stage
    expect(missedAtLaunch(old, "BALANCE_REMINDER")).toBe(true);
    expect(missedAtLaunch(old, "TEAM_THREE_MONTHS")).toBe(true);
    expect(missedAtLaunch(old, "PLANNER_FINAL")).toBe(false);
    expect(missedAtLaunch(old, "WEEK_TO_GO")).toBe(false);
    expect(missedAtLaunch(old, "ACT_DETAILS")).toBe(false);
    expect(missedAtLaunch({ ...old, createdAt: new Date("2026-11-20T10:00:00Z") }, "BALANCE_REMINDER")).toBe(false);
  });
});
