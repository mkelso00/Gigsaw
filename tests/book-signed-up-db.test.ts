import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDaysToKey } from "@/lib/time";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// "Only book acts who've signed up to Gigsaw" (src/lib/book-signed-up.ts), through every way an act gets onto a
// booking: staff who aren't admins are refused, an admin is asked "Book anyway", an act that's signed up or been
// approved is booked as before, nothing changes with the switch off, and a booking with no act is always fine.
// Database tests: TEST_DATABASE_URL only.

const state = vi.hoisted(() => ({ user: null as unknown, sent: [] as { to: string; subject: string }[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  const signedIn = async () => state.user;
  return { ...real, requireUser: signedIn, requireStaff: signedIn, requireAdmin: signedIn };
});
vi.mock("@/lib/messaging", async (orig) => {
  const real = await orig<typeof import("@/lib/messaging")>();
  return {
    ...real,
    sendEmail: async (m: { to: string; subject: string }) => (state.sent.push({ to: m.to, subject: m.subject }), "SENT"),
    sendSms: async () => "SENT",
    sendPush: async () => 0,
  };
});

type Db = (typeof import("@/lib/db"))["prisma"];
const empty = undefined as never;
const form = (fields: Record<string, string | string[]> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
  return f;
};
const anyway = (fields: Record<string, string | string[]> = {}) => form({ ...fields, confirmed: "yes" });
const DAY = 86_400_000;
const dayKey = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

describeDb("only booking acts who've signed up (database)", () => {
  let prisma: Db;
  let agencyId = "";
  let stamp = "";
  let venueId = "";
  let admin: Record<string, unknown>;
  let agent: Record<string, unknown>;
  const acts = { unsigned: "", signed: "", approved: "", band: "", bandUnsigned: "", noLeadBand: "", withEmail: "" };
  const REFUSAL =
    /^Nobody Yet hasn't signed up to Gigsaw yet, so they can't be booked\. Send them their sign-up link \(Acts → Nobody Yet\), or ask an admin to approve them\.$/;
  // Each booking on its own day, so no two of them are a possible double booking.
  let day = 20;
  const nextDay = () => dayKey((day += 4));
  let n = 0;
  const tag = () => `bs-${stamp}-${++n}`;
  const asAdmin = () => (state.user = admin);
  const asAgent = () => (state.user = agent);
  const setRule = (on: boolean) => prisma.settings.update({ where: { agencyId }, data: { bookOnlySignedUp: on } });

  const login = (data: { artistId?: string; personId?: string }, password = true) =>
    prisma.user.create({
      data: { email: `${tag()}@signup.gigsaw.invalid`, name: "Login", role: "ARTIST", agencyId, passwordHash: password ? "x" : "", ...data },
    });
  const person = async (first: string, signedUp: boolean | null) => {
    const p = await prisma.person.create({ data: { agencyId, firstName: first, surname: stamp } });
    if (signedUp !== null) await login({ personId: p.id }, signedUp);
    return p;
  };

  beforeAll(async () => {
    prisma = (await import("@/lib/db")).prisma;
    const t = await createTestAgency(prisma, "booksignup", { bookOnlySignedUp: true, agencyName: "Suave Test Agency" });
    agencyId = t.agency.id;
    stamp = t.stamp;
    admin = { ...t.user, role: "ADMIN" };
    const a = await prisma.user.create({ data: { email: `agent-${stamp}@gigsaw.invalid`, name: "Lucy Agent", passwordHash: "x", role: "AGENT", agencyId } });
    agent = { ...a, agencyId };
    // Demo venue and acts: their gigs are never messaged.
    venueId = (await prisma.venue.create({ data: { agencyId, name: "Signup Rooms", timezone: "Europe/London", demo: true } })).id;
    const act = (name: string, data: Record<string, unknown> = {}) => prisma.artist.create({ data: { agencyId, name, demo: true, ...data } });
    acts.unsigned = (await act("Nobody Yet")).id;
    acts.signed = (await act("Signed Singer")).id;
    await login({ artistId: acts.signed });
    acts.approved = (await act("Approved Act", { bookBeforeSignupAt: new Date(), bookBeforeSignupById: t.admin.id })).id;
    // A band whose lead has signed up and whose other member hasn't: bookable.
    const lead = await person("Lena", true);
    const other = await person("Otto", null);
    acts.band = (await act("Lead Signed Band", { leadPersonId: lead.id, members: { create: [{ personId: lead.id }, { personId: other.id }] } })).id;
    // A band whose other member signed up but whose lead hasn't (only a link sent): not bookable.
    const lead2 = await person("Liam", false);
    const other2 = await person("Ola", true);
    acts.bandUnsigned = (
      await act("Lead Unsigned Band", { leadPersonId: lead2.id, members: { create: [{ personId: lead2.id }, { personId: other2.id }] } })
    ).id;
    const p3 = await person("Nina", true);
    const p4 = await person("Ned", true);
    acts.noLeadBand = (await act("No Lead Band", { members: { create: [{ personId: p3.id }, { personId: p4.id }] } })).id;
    // A real act (not demo) with an email, for its sign-up link.
    acts.withEmail = (await prisma.artist.create({ data: { agencyId, name: "Email Act", email: `email-act-${stamp}@signup.gigsaw.invalid` } })).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { email: { contains: stamp } } });
    await removeTestAgency(prisma, agencyId);
  });

  const bookingForm = (artistId: string, more: Record<string, string> = {}) => {
    const eventName = tag();
    return {
      eventName,
      f: { artistId, venueId, date: nextDay(), setStartTime: "19:00", setEndTime: "21:00", status: "PENDING", fee: "200", eventName, ...more },
    };
  };
  const made = (eventName: string) => prisma.booking.findFirst({ where: { agencyId, eventName } });

  describe("the rules, read from the database", () => {
    it("knows who has signed up, by act", async () => {
      const { blockedActs } = await import("@/lib/book-signed-up-server");
      const blocked = await blockedActs(agencyId, Object.values(acts));
      expect(blocked.map((b) => b.name).sort()).toEqual(["Email Act", "Lead Unsigned Band", "No Lead Band", "Nobody Yet"]);
      expect(blocked.find((b) => b.name === "Lead Unsigned Band")).toMatchObject({ who: `Liam ${stamp}`, why: /sign-up link has been sent/ });
    });

    it("a new business starts with the switch off, and the migration turns it on for the businesses already here", async () => {
      const other = await createTestAgency(prisma, "booksignup-new");
      try {
        expect((await prisma.settings.findUniqueOrThrow({ where: { agencyId: other.agency.id } })).bookOnlySignedUp).toBe(false);
      } finally {
        await removeTestAgency(prisma, other.agency.id);
      }
      const sql = readFileSync(path.join(__dirname, "../prisma/migrations/20261226000000_book_only_signed_up/migration.sql"), "utf8");
      expect(sql).toMatch(/-- data:start\n[\s\S]*UPDATE "Settings" SET "bookOnlySignedUp" = true;\n-- data:end/);
    });

    it("is switched in Settings, General", async () => {
      asAdmin();
      const { saveSettings } = await import("@/actions/settings");
      expect(await saveSettings(empty, form({ bookOnlySignedUp__shown: "1" }))).toEqual({ ok: "Saved." });
      expect((await prisma.settings.findUniqueOrThrow({ where: { agencyId } })).bookOnlySignedUp).toBe(false);
      expect(await saveSettings(empty, form({ bookOnlySignedUp__shown: "1", bookOnlySignedUp: "on" }))).toEqual({ ok: "Saved." });
      expect((await prisma.settings.findUniqueOrThrow({ where: { agencyId } })).bookOnlySignedUp).toBe(true);
    });

    it("marks the acts in the pickers, and nothing with the switch off", async () => {
      const { pickerNotes } = await import("@/lib/book-signed-up-server");
      const notes = await pickerNotes(agencyId);
      expect(notes.get(acts.unsigned)).toBe("Not signed up");
      expect(notes.get(acts.approved)).toBe("Approved");
      expect(notes.has(acts.signed)).toBe(false);
      expect(notes.has(acts.band)).toBe(false);
      await setRule(false);
      try {
        expect((await pickerNotes(agencyId)).size).toBe(0);
      } finally {
        await setRule(true);
      }
    });
  });

  describe("a new booking (createBooking)", () => {
    it("refuses staff who aren't admins, saying what to do", async () => {
      asAgent();
      const { createBooking } = await import("@/actions/bookings");
      const { eventName, f } = bookingForm(acts.unsigned);
      expect(await createBooking(empty, form(f))).toEqual({ error: expect.stringMatching(REFUSAL) });
      // Book anyway is only for admins.
      expect((await createBooking(empty, anyway(f)))?.error).toMatch(REFUSAL);
      expect(await made(eventName)).toBeNull();
    });

    it("asks an admin, and books when they say Book anyway, noting it on the booking", async () => {
      asAdmin();
      const { createBooking } = await import("@/actions/bookings");
      const { eventName, f } = bookingForm(acts.unsigned);
      const res = await createBooking(empty, form(f));
      expect(res?.confirm).toMatchObject({ title: "Nobody Yet hasn't signed up to Gigsaw yet", button: "Book anyway" });
      expect(res?.confirm?.items.join(" ")).toMatch(/approve them to be booked before signing up, on their page \(Acts → Nobody Yet\)/);
      expect(await made(eventName)).toBeNull();
      expect(await createBooking(empty, anyway(f))).toBeUndefined();
      const b = (await made(eventName))!;
      expect(b.artistId).toBe(acts.unsigned);
      expect(await prisma.activity.findFirst({ where: { entityId: b.id, action: "booked before the act signed up to Gigsaw" } })).toMatchObject({
        detail: "Nobody Yet",
      });
    });

    it("books acts who've signed up or been approved, a band by its lead, and a booking with no act", async () => {
      asAgent();
      const { createBooking } = await import("@/actions/bookings");
      for (const id of [acts.signed, acts.approved, acts.band]) {
        const { eventName, f } = bookingForm(id);
        expect(await createBooking(empty, form(f))).toBeUndefined();
        expect((await made(eventName))?.artistId).toBe(id);
      }
      const none = bookingForm("");
      expect(await createBooking(empty, form(none.f))).toBeUndefined();
      expect((await made(none.eventName))?.artistId).toBeNull();
      for (const id of [acts.bandUnsigned, acts.noLeadBand]) {
        const { f } = bookingForm(id);
        expect((await createBooking(empty, form(f)))?.error).toMatch(/hasn't signed up to Gigsaw yet, so they can't be booked/);
      }
    });

    it("books anyone with the switch off", async () => {
      asAgent();
      await setRule(false);
      try {
        const { createBooking } = await import("@/actions/bookings");
        const { eventName, f } = bookingForm(acts.unsigned);
        expect(await createBooking(empty, form(f))).toBeUndefined();
        expect((await made(eventName))?.artistId).toBe(acts.unsigned);
      } finally {
        await setRule(true);
      }
    });
  });

  describe("changing a booking (updateBooking, setBookingStatus)", () => {
    it("refuses a different act who hasn't signed up, but leaves a booking's own act alone", async () => {
      asAgent();
      const { createBooking, updateBooking, setBookingStatus } = await import("@/actions/bookings");
      const { eventName, f } = bookingForm(acts.signed);
      await createBooking(empty, form(f));
      const b = (await made(eventName))!;
      expect((await updateBooking(b.id, empty, form({ ...f, artistId: acts.unsigned })))?.error).toMatch(REFUSAL);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).artistId).toBe(acts.signed);

      // A booking made before the switch, with an act who hasn't signed up: still edited and moved on as before.
      await setRule(false);
      const old = bookingForm(acts.unsigned);
      await createBooking(empty, form(old.f));
      await setRule(true);
      const ob = (await made(old.eventName))!;
      expect(await updateBooking(ob.id, empty, form({ ...old.f, fee: "250", notes: "Bring the PA" }))).toBeUndefined();
      expect(await prisma.booking.findUniqueOrThrow({ where: { id: ob.id } })).toMatchObject({ artistId: acts.unsigned, feeMinor: 25000 });
      expect((await setBookingStatus(ob.id, empty, form({ status: "HOLD" })))?.ok).toBe("Now On hold.");
    });

    it("asks an admin before changing to such an act", async () => {
      asAdmin();
      const { createBooking, updateBooking } = await import("@/actions/bookings");
      const { eventName, f } = bookingForm(acts.signed);
      await createBooking(empty, form(f));
      const b = (await made(eventName))!;
      expect((await updateBooking(b.id, empty, form({ ...f, artistId: acts.unsigned })))?.confirm?.title).toBe("Nobody Yet hasn't signed up to Gigsaw yet");
      expect(await updateBooking(b.id, empty, anyway({ ...f, artistId: acts.unsigned }))).toBeUndefined();
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).artistId).toBe(acts.unsigned);
    });
  });

  describe("quick booking and the venue schedule (src/actions/slots.ts)", () => {
    const quick = (artistId: string) => ({
      date: nextDay(),
      venueId,
      startTime: "19:00",
      endTime: "21:00",
      fee: "150",
      artistId,
      mode: "confirm",
      label: tag(),
    });

    it("addRotaGig: refused for staff, asked of an admin, fine with no act", async () => {
      const { addRotaGig } = await import("@/actions/slots");
      asAgent();
      const one = quick(acts.unsigned);
      expect((await addRotaGig(empty, form(one)))?.error).toMatch(REFUSAL);
      expect(await prisma.booking.count({ where: { agencyId, eventName: one.label } })).toBe(0);
      const none = quick("");
      expect((await addRotaGig(empty, form(none)))?.ok).toMatch(/Pending, needs an act/);
      const weekly = { ...quick(acts.unsigned), weekly: "on", weeks: "3" };
      expect((await addRotaGig(empty, form(weekly)))?.error).toMatch(REFUSAL);

      asAdmin();
      expect((await addRotaGig(empty, form(one)))?.confirm).toMatchObject({ title: "Nobody Yet hasn't signed up to Gigsaw yet", button: "Book anyway" });
      expect((await addRotaGig(empty, anyway(one)))?.ok).toMatch(/^Booked Nobody Yet at Signup Rooms/);
      expect((await addRotaGig(empty, anyway(weekly)))?.ok).toMatch(/^Booked Nobody Yet at Signup Rooms, 3 bookings/);
      const logged = await prisma.activity.count({ where: { agencyId, action: "booked before the act signed up to Gigsaw", detail: "Nobody Yet" } });
      expect(logged).toBeGreaterThanOrEqual(4);
    });

    it("addRotaGig: an approved act books straight away", async () => {
      asAgent();
      const { addRotaGig } = await import("@/actions/slots");
      expect((await addRotaGig(empty, form(quick(acts.approved))))?.ok).toMatch(/^Booked Approved Act/);
    });

    it("assignSlot: refused for staff, asked of an admin", async () => {
      const { assignSlot } = await import("@/actions/slots");
      const date = nextDay();
      const { weekdayOf } = await import("@/lib/rota");
      const slot = await prisma.venueSlot.create({
        data: { agencyId, venueId, weekday: weekdayOf(date), arriveTime: "18:30", startTime: "19:00", endTime: "21:00", label: tag() },
      });
      asAgent();
      expect((await assignSlot(slot.id, date, empty, form({ artistId: acts.unsigned, mode: "confirm" })))?.error).toMatch(REFUSAL);
      asAdmin();
      expect((await assignSlot(slot.id, date, empty, form({ artistId: acts.unsigned, mode: "confirm" })))?.confirm?.title).toBe(
        "Nobody Yet hasn't signed up to Gigsaw yet",
      );
      expect(await assignSlot(slot.id, date, empty, anyway({ artistId: acts.unsigned, mode: "confirm" }))).toEqual({ ok: "Booked." });
      asAgent();
      expect(await assignSlot(slot.id, addDaysToKey(date, 7), empty, form({ artistId: acts.signed, mode: "confirm" }))).toEqual({ ok: "Booked." });
    });

    it("bookRegulars: staff book the rest and are told who wasn't booked; an admin is asked first", async () => {
      const { bookRegulars } = await import("@/actions/slots");
      const { weekdayOf } = await import("@/lib/rota");
      const from = dayKey(200);
      const label = tag();
      // Only this test's slots are active while it runs.
      await prisma.venueSlot.updateMany({ where: { agencyId }, data: { active: false } });
      await prisma.venueSlot.create({
        data: { agencyId, venueId, weekday: weekdayOf(from), arriveTime: "18:30", startTime: "19:00", endTime: "21:00", label, artistId: acts.unsigned },
      });
      await prisma.venueSlot.create({
        data: { agencyId, venueId, weekday: weekdayOf(from), arriveTime: "21:30", startTime: "22:00", endTime: "23:00", label, artistId: acts.signed },
      });
      asAgent();
      const res = await bookRegulars(empty, form({ from, weeks: "1", mode: "confirm" }));
      expect(res?.ok).toMatch(/^Booked 1 booking/);
      expect(res?.ok).toMatch(/1 left without an act: Signup Rooms .* Nobody Yet hasn't signed up to Gigsaw yet, so they can't be booked\./);
      expect(await prisma.booking.count({ where: { agencyId, eventName: label, artistId: acts.unsigned } })).toBe(0);
      expect(await prisma.booking.count({ where: { agencyId, eventName: label, artistId: acts.signed } })).toBe(1);

      asAdmin();
      expect((await bookRegulars(empty, form({ from, weeks: "1", mode: "confirm" })))?.confirm).toMatchObject({
        title: "Nobody Yet hasn't signed up to Gigsaw yet",
        button: "Book anyway",
      });
      expect((await bookRegulars(empty, anyway({ from, weeks: "1", mode: "confirm" })))?.ok).toMatch(/^Booked 1 booking/);
      expect(await prisma.booking.count({ where: { agencyId, eventName: label, artistId: acts.unsigned } })).toBe(1);
      await prisma.venueSlot.updateMany({ where: { agencyId, label }, data: { active: false } });
    });
  });

  describe("copying a booking (copyBooking)", () => {
    it("with its act: refused for staff, asked of an admin; without it: always fine", async () => {
      const { createBookingWithReference } = await import("@/lib/bookings");
      const { buildSchedule } = await import("@/lib/schedule");
      const b = await createBookingWithReference(agencyId, {
        ...buildSchedule(dayKey(300), { arrive: "18:30", setStart: "19:00", setEnd: "21:00" }, "Europe/London"),
        artistId: acts.unsigned,
        venueId,
        status: "PENDING",
        timezone: "Europe/London",
        demo: true,
      });
      const { copyBooking } = await import("@/actions/bookings");
      asAgent();
      expect(await copyBooking(b.id, [dayKey(310)], "PENDING", true)).toEqual({ ok: false, message: expect.stringMatching(REFUSAL), ids: [] });
      expect(await copyBooking(b.id, [dayKey(310)], "PENDING", true, true)).toMatchObject({ ok: false, message: expect.stringMatching(REFUSAL) });
      const without = await copyBooking(b.id, [dayKey(311)], "PENDING", false);
      expect(without.ok).toBe(true);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: without.ids[0] } })).artistId).toBeNull();

      asAdmin();
      const ask = await copyBooking(b.id, [dayKey(312)], "PENDING", true);
      expect(ask).toMatchObject({ ok: false, ids: [], confirm: { title: "Nobody Yet hasn't signed up to Gigsaw yet", button: "Book anyway" } });
      const done = await copyBooking(b.id, [dayKey(312), dayKey(319)], "PENDING", true, true);
      expect(done).toMatchObject({ ok: true, message: expect.stringMatching(/^Copied to 2 dates/) });
      expect(await prisma.booking.count({ where: { id: { in: done.ids }, artistId: acts.unsigned } })).toBe(2);
      expect(await prisma.activity.count({ where: { entityId: { in: done.ids }, action: "booked before the act signed up to Gigsaw" } })).toBe(2);
    });
  });

  describe("adding an act to a wedding or event (addEventAct)", () => {
    it("refused for staff, asked of an admin, fine for an approved act or no act", async () => {
      const e = await prisma.event.create({ data: { agencyId, name: tag(), type: "WEDDING", date: dayKey(150), timezone: "Europe/London", demo: true } });
      const { addEventAct } = await import("@/actions/events");
      const fields = (artistId: string, status = "PENDING") => ({ artistId, startTime: "19:00", endTime: "23:00", sale: "500", status });
      const add = (artistId: string, status?: string) => form(fields(artistId, status));
      asAgent();
      expect((await addEventAct(e.id, empty, add(acts.unsigned)))?.error).toMatch(REFUSAL);
      expect((await addEventAct(e.id, empty, add("", "HOLD")))?.ok).toMatch(/needs an act/);
      expect((await addEventAct(e.id, empty, add(acts.approved)))?.ok).toMatch(/^Approved Act added/);
      asAdmin();
      expect((await addEventAct(e.id, empty, add(acts.unsigned)))?.confirm).toMatchObject({ title: "Nobody Yet hasn't signed up to Gigsaw yet" });
      expect(await addEventAct(e.id, empty, anyway(fields(acts.unsigned)))).toEqual({ ok: expect.stringMatching(/^Nobody Yet added/) });
      expect(await prisma.booking.count({ where: { eventId: e.id, artistId: acts.unsigned } })).toBe(1);
    });
  });

  describe("booking someone who said they're free (bookFromReply)", () => {
    it("refused for staff, asked of an admin", async () => {
      const { bookFromReply } = await import("@/actions/availability");
      const req = await prisma.availabilityRequest.create({
        data: { agencyId, date: dayKey(160), startTime: "19:00", endTime: "21:00", venueId, place: tag() },
      });
      const reply = await prisma.availabilityReply.create({
        data: { requestId: req.id, artistId: acts.unsigned, token: `tok-${tag()}-xxxxxxxxxxxxxxxx`, answer: "YES" },
      });
      asAgent();
      expect((await bookFromReply(reply.id, empty, form()))?.error).toMatch(REFUSAL);
      asAdmin();
      expect((await bookFromReply(reply.id, empty, form()))?.confirm?.title).toBe("Nobody Yet hasn't signed up to Gigsaw yet");
      expect(await prisma.availabilityReply.findUniqueOrThrow({ where: { id: reply.id } })).toMatchObject({ bookingId: null });
      expect(await bookFromReply(reply.id, empty, anyway())).toBeUndefined();
      const booked = await prisma.availabilityReply.findUniqueOrThrow({ where: { id: reply.id }, include: { booking: true } });
      expect(booked.booking?.artistId).toBe(acts.unsigned);
    });
  });

  describe("sending a proposal", () => {
    const proposal = async (artistId: string) =>
      prisma.quote.create({
        data: {
          agencyId,
          number: tag(),
          title: "Summer party",
          eventType: "CORPORATE",
          lines: { create: [{ artistId, date: dayKey(170), startTime: "19:00", saleMinor: 50000, costMinor: 30000 }] },
        },
      });

    it("is blocked for staff while a line names an act who hasn't signed up", async () => {
      const { getProposalLink, sendProposalNow } = await import("@/actions/proposals");
      const { proposalActsNotSignedUp, proposalInclude } = await import("@/lib/proposal-server");
      const q = await proposal(acts.unsigned);
      const full = await prisma.quote.findUniqueOrThrow({ where: { id: q.id }, include: proposalInclude });
      expect((await proposalActsNotSignedUp(full)).map((b) => b.name)).toEqual(["Nobody Yet"]);
      asAgent();
      expect((await getProposalLink(q.id, empty, form()))?.error).toMatch(REFUSAL);
      expect((await sendProposalNow(q.id, empty, form({ to: `customer-${stamp}@gigsaw.invalid` })))?.error).toMatch(REFUSAL);
      expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("DRAFT");
      expect(state.sent.filter((m) => m.to.startsWith("customer-"))).toEqual([]);
    });

    it("asks an admin, who can send it anyway", async () => {
      const { getProposalLink } = await import("@/actions/proposals");
      const q = await proposal(acts.unsigned);
      asAdmin();
      const res = await getProposalLink(q.id, empty, form());
      expect(res?.confirm).toMatchObject({ title: "Nobody Yet hasn't signed up to Gigsaw yet", button: "Send anyway" });
      expect(res?.confirm?.items).toContain("The customer can accept the proposal straight away, which books the acts on it.");
      expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("DRAFT");
      expect((await getProposalLink(q.id, empty, anyway()))?.ok).toMatch(/Your link is ready/);
      expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("SENT");
      expect(await prisma.activity.findFirst({ where: { entityId: q.id, action: "sent with acts who haven't signed up to Gigsaw" } })).toBeTruthy();
    });

    it("goes as before for acts who've signed up or been approved, and lines with no act", async () => {
      const { getProposalLink } = await import("@/actions/proposals");
      asAgent();
      for (const id of [acts.signed, acts.approved, null]) {
        const q = await proposal(id as string);
        expect((await getProposalLink(q.id, empty, form()))?.ok).toMatch(/Your link is ready/);
      }
    });
  });

  describe("on the act's page", () => {
    it("an admin approves an act to be booked before signing up, and can take it back", async () => {
      const { setBookBeforeSignup } = await import("@/actions/act-signup");
      const { createBooking } = await import("@/actions/bookings");
      const target = (await prisma.artist.create({ data: { agencyId, name: "Later Approved", demo: true } })).id;
      asAdmin();
      expect(await setBookBeforeSignup(target, true, empty)).toEqual({ ok: "Later Approved can be booked before signing up." });
      expect(await prisma.artist.findUniqueOrThrow({ where: { id: target } })).toMatchObject({
        bookBeforeSignupAt: expect.any(Date),
        bookBeforeSignupById: (admin as { id: string }).id,
      });
      asAgent();
      const { eventName, f } = bookingForm(target);
      expect(await createBooking(empty, form(f))).toBeUndefined();
      expect((await made(eventName))?.artistId).toBe(target);
      asAdmin();
      expect(await setBookBeforeSignup(target, false, empty)).toEqual({ ok: "Later Approved can't be booked until they sign up." });
      asAgent();
      expect((await createBooking(empty, form(bookingForm(target).f)))?.error).toMatch(/^Later Approved hasn't signed up to Gigsaw yet/);
    });

    it("sends the act its sign-up link: the same set-up link as First time? Set up your login", async () => {
      const { sendActSignupLink } = await import("@/actions/act-signup");
      asAgent();
      state.sent = [];
      const email = `email-act-${stamp}@signup.gigsaw.invalid`;
      expect(await sendActSignupLink(acts.withEmail, empty)).toEqual({ ok: `Sign-up link sent to ${email}. It works for 24 hours.` });
      expect(await prisma.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ artistId: acts.withEmail, passwordHash: "", role: "ARTIST" });
      expect(state.sent).toEqual([{ to: email, subject: "Set up your Gigsaw login for Suave Test Agency" }]);
      // A band with nobody chosen to get its invoices: choose first.
      expect((await sendActSignupLink(acts.noLeadBand, empty))?.error).toMatch(/^Choose who No Lead Band's invoices go to first/);
      // A sample act from the demo data never signs up.
      const sample = await prisma.artist.create({ data: { agencyId, name: "Sample Act", demo: true, email: `sample-${stamp}@signup.gigsaw.invalid` } });
      expect((await sendActSignupLink(sample.id, empty))?.error).toBe("Sample Act is a sample act from the demo data, so it can't sign up.");
      // Signed up already: nothing to send.
      expect(await sendActSignupLink(acts.signed, empty)).toEqual({ ok: "Signed Singer has already signed up." });
    });
  });
});
