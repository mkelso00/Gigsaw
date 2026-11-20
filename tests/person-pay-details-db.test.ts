import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Pay details on people and a lead for each band, in the database: the migration that moves acts' details
// onto people, the Your details gate per person, who each invoice is made out to (a band's lead, the one
// person in a solo act, or the act itself), who can see which invoices, and every person in a band hearing
// about its gigs. Runs only against the test database (see tests/helpers/db.ts):
//   TEST_DATABASE_URL=postgresql://…/gigsaw_test npx vitest run tests/person-pay-details-db.test.ts

const state = vi.hoisted(() => ({ user: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  const signedIn = async () => state.user;
  return { ...real, requireUser: signedIn, requireStaff: signedIn, requireAdmin: signedIn };
});
vi.mock("@/lib/calendar-sync/queue", () => ({ queueCalendarSync: () => {} }));
vi.mock("@/components/forms", () => ({
  ActionForm: ({ children }: { children: unknown }) => children,
  SubmitButton: ({ children }: { children: unknown }) => children,
}));

type Db = typeof import("@/lib/db");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const empty = undefined as never;
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};
const bank = (n: string) => ({
  bankAccountName: `Account ${n}`,
  bankSortCode: "11-22-33",
  bankAccountNumber: n,
  address: `${n} Band Lane\nLeeds`,
  detailsCompletedAt: new Date(),
});

describeDb("pay details on people (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let stamp = "";
  let admin: { id: string; email: string; agencyId: string; role: string };
  let n = 0;
  const mail = (tag: string) => `${tag}-${stamp}-${++n}@bandpay.gigsaw.invalid`;

  const newAct = (data: Record<string, unknown> = {}) => prisma.artist.create({ data: { agencyId, name: `Act ${++n}`, ...data } });
  const newPerson = (firstName: string, data: Record<string, unknown> = {}) =>
    prisma.person.create({ data: { agencyId, firstName, surname: `Bloggs${++n}`, email: mail(firstName.toLowerCase()), ...data } });
  /** A band of these people, each with their own login. */
  const band = async (names: string[], actData: Record<string, unknown> = {}) => {
    const act = await newAct(actData);
    const people = [];
    for (const name of names) {
      const p = await newPerson(name);
      await prisma.personAct.create({ data: { personId: p.id, artistId: act.id } });
      const login = await prisma.user.create({ data: { email: p.email, name, passwordHash: "x", role: "ARTIST", agencyId, personId: p.id } });
      people.push({ ...p, login: { ...login, agencyId } });
    }
    return { act, people };
  };
  /** A gig that finished two hours ago, £600 to the act. */
  const finishedGig = (artistId: string) => {
    const setEnd = new Date(Date.now() - 2 * HOUR);
    const setStart = new Date(setEnd.getTime() - 2 * HOUR);
    return prisma.booking.create({
      data: {
        agencyId,
        reference: `BP-${++n}`,
        artistId,
        status: "CONFIRMED",
        dealType: "BUY_SELL",
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd,
        feeMinor: 90_000,
        artistFeeMinor: 60_000,
      },
    });
  };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    // After the client is made, as Prisma reads a local .env file when it starts: messages are only recorded.
    for (const k of ["RESEND_API_KEY", "MAIL_FROM", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"]) delete process.env[k];
    const t = await createTestAgency(prisma, "bandpay", {
      agencyName: "Band Pay Music",
      actInvoiceMode: "AUTO",
      agencyEmail: "office@bandpay.gigsaw.invalid",
      weeklyReminders: false,
      dayReminders: true,
      dayReminderTime: "12:00",
    });
    agencyId = t.agency.id;
    stamp = t.stamp;
    admin = { ...t.admin, agencyId };
    state.user = admin;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.reminder.deleteMany({ where: { recipient: { in: (await prisma.person.findMany({ where: { agencyId } })).map((p) => `person:${p.id}`) } } });
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  describe("moving acts' details to people (the migration)", () => {
    it("moves them where it's clear whose they are, exactly as movePlan says, and leaves the rest for staff", async () => {
      const { movePlan, hasAnyPayDetails } = await import("@/lib/payee");
      const withDetails = { ...bank("10000001"), address: "1 High St\nLeeds" };
      // The act's only member, with no address of their own.
      const solo = await newAct({ ...withDetails, detailsCompletedAt: new Date("2026-10-01") });
      const ellie = await newPerson("Ellie", { address: "" });
      // A band whose email is one member's: that member's, and they become its lead.
      const michael = await newPerson("Michael");
      const partyBand = await newAct({ ...bank("10000002"), email: michael.email.toUpperCase() });
      const [kerry, dev] = [await newPerson("Kerry"), await newPerson("Dev")];
      // The only member, but with a different address: unclear.
      const rogues = await newAct({ ...bank("10000003") });
      const rob = await newPerson("Rob", { address: "9 Other Road" });
      // A band where no member's email is the act's: unclear.
      const quiet = await newAct({ ...bank("10000004"), email: "band@bandpay.gigsaw.invalid" });
      const [q1, q2] = [await newPerson("Q"), await newPerson("R")];
      // Graham's solo act and a duo with his email: both would land on him, so neither moves.
      const grahamSolo = await newAct({ ...bank("10000005") });
      const graham = await newPerson("Graham");
      const duo = await newAct({ ...bank("10000006"), email: graham.email });
      const jo = await newPerson("Jo");
      // Nobody on file: stays on the act (it's still the payee).
      const alone = await newAct({ ...bank("10000007") });
      await prisma.personAct.createMany({
        data: [
          [ellie, solo],
          [michael, partyBand],
          [kerry, partyBand],
          [dev, partyBand],
          [rob, rogues],
          [q1, quiet],
          [q2, quiet],
          [graham, grahamSolo],
          [graham, duo],
          [jo, duo],
        ].map(([p, a]) => ({ personId: p.id, artistId: a.id })),
      });
      const gig = await finishedGig(solo.id);
      const old = await prisma.actInvoice.create({
        data: {
          agencyId,
          artistId: solo.id,
          bookingId: gig.id,
          seq: 1,
          number: "SB-0001",
          currency: "GBP",
          netMinor: 1,
          totalMinor: 1,
          bookingRef: "x",
          description: "x",
          gigDate: new Date(),
          actName: solo.name,
          payeeName: solo.name,
        },
      });

      // What the rules say, from the same rows the SQL reads.
      const acts = await prisma.artist.findMany({ where: { agencyId }, include: { members: { include: { person: true } } } });
      const plan = movePlan(
        acts.map((a) => ({
          id: a.id,
          email: a.email,
          address: a.address,
          hasDetails: hasAnyPayDetails(a),
          members: a.members.map((m) => ({ id: m.person.id, email: m.person.email, address: m.person.address })),
        })),
      );
      expect(Object.fromEntries(plan)).toEqual({ [solo.id]: { personId: ellie.id, setLead: false }, [partyBand.id]: { personId: michael.id, setLead: true } });

      // The migration's own SQL, run in a transaction that's then rolled back, so nothing else in the test
      // database is changed.
      const sql = readFileSync(path.resolve(__dirname, "../prisma/migrations/20261214000000_person_pay_details/migration.sql"), "utf8");
      const part = sql.slice(sql.indexOf("-- data:start"), sql.indexOf("-- data:end"));
      const statements = part
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .split(/;\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      expect(statements.length).toBeGreaterThan(5);
      const ROLLBACK = new Error("rollback");
      let after: { acts: typeof acts; people: Awaited<ReturnType<typeof prisma.person.findMany>>; invoice: typeof old | null; logged: number } | null = null;
      await prisma
        .$transaction(
          async (tx) => {
            for (const s of statements) await tx.$executeRawUnsafe(s);
            after = {
              acts: await tx.artist.findMany({ where: { agencyId }, include: { members: { include: { person: true } } } }),
              people: await tx.person.findMany({ where: { agencyId } }),
              invoice: await tx.actInvoice.findUnique({ where: { id: old.id } }),
              logged: await tx.activity.count({ where: { agencyId, action: "pay details moved to a person" } }),
            };
            throw ROLLBACK;
          },
          { timeout: 30_000 },
        )
        .catch((e) => {
          if (e !== ROLLBACK) throw e;
        });
      const a = after!;
      const actAfter = (id: string) => a.acts.find((x) => x.id === id)!;
      const personAfter = (id: string) => a.people.find((x) => x.id === id)!;
      // Moved: on the person, off the act, a band's matching member is its lead, and it's in the log.
      expect(personAfter(ellie.id)).toMatchObject({ bankAccountNumber: "10000001", address: "1 High St\nLeeds", detailsCompletedAt: new Date("2026-10-01") });
      expect(actAfter(solo.id)).toMatchObject({ bankAccountNumber: "", address: "", detailsCompletedAt: null, leadPersonId: null });
      expect(personAfter(michael.id)).toMatchObject({ bankAccountNumber: "10000002", detailsCompletedAt: expect.any(Date) });
      expect(actAfter(partyBand.id)).toMatchObject({ bankAccountNumber: "", leadPersonId: michael.id });
      expect(a.logged).toBe(2);
      // The invoice already paid from them is theirs to see now; what it says is unchanged.
      expect(a.invoice).toMatchObject({ payeePersonId: ellie.id, payeeName: solo.name });
      // Everything else stays where it was, exactly matching the plan.
      const moved = a.acts.filter((x) => !x.bankAccountNumber && acts.find((b) => b.id === x.id)!.bankAccountNumber).map((x) => x.id);
      expect(moved.sort()).toEqual([...plan.keys()].sort());
      for (const id of [rogues.id, quiet.id, grahamSolo.id, duo.id, alone.id]) expect(actAfter(id).bankAccountNumber).not.toBe("");
      for (const p of [rob, q1, q2, graham, jo, kerry, dev]) expect(personAfter(p.id).bankAccountNumber).toBe("");
      expect(personAfter(rob.id).address).toBe("9 Other Road");
      // And it was all rolled back.
      expect((await prisma.person.findUniqueOrThrow({ where: { id: ellie.id } })).bankAccountNumber).toBe("");
    });
  });

  describe("Your details, per person", () => {
    it("each person in a band fills in their own; one who has isn't held up by the others", async () => {
      const { requireActApp } = await import("@/lib/act-details-server");
      const { payHoldersFor } = await import("@/lib/payee-server");
      const { people } = await band(["Ann", "Ben"]);
      const [ann, ben] = people;
      await prisma.person.update({ where: { id: ann.id }, data: bank("20000001") });
      await prisma.user.update({ where: { id: ann.login.id }, data: { calendarAddedAt: new Date() } });
      state.user = ann.login;
      expect(await requireActApp()).toMatchObject({ personId: ann.id });
      state.user = ben.login;
      await expect(requireActApp()).rejects.toThrow("REDIRECT /app/details");
      // Ben is only ever asked for his own.
      expect((await payHoldersFor(ben.login)).map((h) => h.id)).toEqual([ben.id]);
      state.user = admin;
    });
  });

  describe("who invoices are made out to", () => {
    it("a band: waits for staff to choose its lead, then goes to the lead with their details; a new lead replaces it", async () => {
      const lib = await import("@/lib/act-invoices");
      const { setActLead } = await import("@/actions/act-details");
      const { NO_PAYEE } = await import("@/lib/act-invoice-rules");
      const { act, people } = await band(["Amy", "Bea", "Cal", "Dee"]);
      const [amy, bea, cal] = people;
      for (const [i, p] of people.entries()) await prisma.person.update({ where: { id: p.id }, data: bank(`3000000${i}`) });
      const gig = await finishedGig(act.id);
      expect(await lib.issueActInvoice(gig.id)).toEqual({ skipped: NO_PAYEE });
      expect((await lib.uninvoicedGigs(agencyId)).find((r) => r.booking.id === gig.id)).toMatchObject({ reason: NO_PAYEE, canMake: false });

      state.user = admin;
      expect(await setActLead(act.id, empty, form({ leadPersonId: "someone-else" }))).toEqual({ error: "Choose someone in the act" });
      expect(await setActLead(act.id, empty, form({ leadPersonId: amy.id }))).toMatchObject({ ok: expect.stringContaining("now go to Amy") });
      expect(await lib.issueActInvoice(gig.id)).toMatchObject({ number: expect.any(String) });
      const inv = await prisma.actInvoice.findUniqueOrThrow({ where: { liveBookingId: gig.id } });
      expect(inv).toMatchObject({
        actName: act.name,
        payeeName: `Amy ${amy.surname}`,
        payeePersonId: amy.id,
        bankAccountNumber: "30000000",
        actAddress: "30000000 Band Lane\nLeeds",
      });

      // Who sees it: the lead, and nobody else in the band, nor the band's own login.
      const bandLogin = await prisma.user.create({
        data: { email: mail("bandlogin"), name: act.name, passwordHash: "x", role: "ARTIST", agencyId, artistId: act.id },
      });
      expect((await lib.invoicesForActLogin(amy.login)).map((i) => i.id)).toEqual([inv.id]);
      for (const who of [bea.login, cal.login, { ...bandLogin, agencyId }]) {
        expect(await lib.invoicesForActLogin(who)).toEqual([]);
        expect(await lib.invoiceForViewer(who, inv.id)).toBeNull();
      }
      expect(await lib.invoiceForViewer({ ...amy.login, role: "ARTIST" }, inv.id)).toMatchObject({ bankAccountNumber: "30000000" });

      // Staff choose Bea instead: the unpaid invoice is replaced with one to her.
      expect(await setActLead(act.id, empty, form({ leadPersonId: bea.id }))).toMatchObject({ ok: expect.any(String) });
      expect(await lib.reconcileActInvoice(inv.id)).toBe("reissued");
      expect(await prisma.actInvoice.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ status: "VOID", note: "Who it's made out to changed" });
      expect(await prisma.actInvoice.findUniqueOrThrow({ where: { liveBookingId: gig.id } })).toMatchObject({
        payeePersonId: bea.id,
        bankAccountNumber: "30000001",
      });
      expect(await lib.invoicesForActLogin(amy.login)).toHaveLength(1); // only her old, void one
      expect((await lib.invoicesForActLogin(bea.login)).map((i) => i.status)).toEqual(["ISSUED"]);
    });

    it("a solo act with one person: to that person, once their own details are in", async () => {
      const lib = await import("@/lib/act-invoices");
      const { act, people } = await band(["Solo"]);
      const gig = await finishedGig(act.id);
      expect(await lib.issueActInvoice(gig.id)).toEqual({ skipped: `Waiting for details from Solo ${people[0].surname}` });
      await prisma.person.update({ where: { id: people[0].id }, data: bank("40000001") });
      expect(await lib.issueActInvoice(gig.id)).toMatchObject({ number: expect.any(String) });
      expect(await prisma.actInvoice.findUniqueOrThrow({ where: { liveBookingId: gig.id } })).toMatchObject({
        payeePersonId: people[0].id,
        bankAccountNumber: "40000001",
      });
      expect(await lib.invoicesForActLogin(people[0].login)).toHaveLength(1);
      // The act's own login (if it has one) fills in that person's details, so it sees them too.
      const actLogin = await prisma.user.create({
        data: { email: mail("sololog"), name: act.name, passwordHash: "x", role: "ARTIST", agencyId, artistId: act.id },
      });
      expect(await lib.invoicesForActLogin({ ...actLogin, agencyId })).toHaveLength(1);
    });

    it("an act with nobody on file: to the act, from its own details, as before", async () => {
      const lib = await import("@/lib/act-invoices");
      const act = await newAct(bank("50000001"));
      const gig = await finishedGig(act.id);
      expect(await lib.issueActInvoice(gig.id)).toMatchObject({ number: expect.any(String) });
      expect(await prisma.actInvoice.findUniqueOrThrow({ where: { liveBookingId: gig.id } })).toMatchObject({
        payeePersonId: null,
        payeeName: act.name,
        bankAccountNumber: "50000001",
      });
    });

    it("the scheduler makes a band's invoice once its lead's details are in", async () => {
      const lib = await import("@/lib/act-invoices");
      const { act, people } = await band(["Lead", "Other"]);
      await prisma.artist.update({ where: { id: act.id }, data: { leadPersonId: people[0].id } });
      const gig = await finishedGig(act.id);
      await lib.runActInvoices();
      expect(await prisma.actInvoice.count({ where: { bookingId: gig.id } })).toBe(0);
      // Someone else in the band adding theirs makes no difference.
      await prisma.person.update({ where: { id: people[1].id }, data: bank("60000002") });
      await lib.runActInvoices();
      expect(await prisma.actInvoice.count({ where: { bookingId: gig.id } })).toBe(0);
      await prisma.person.update({ where: { id: people[0].id }, data: bank("60000001") });
      await lib.runActInvoices();
      expect(await prisma.actInvoice.findUniqueOrThrow({ where: { liveBookingId: gig.id } })).toMatchObject({ payeePersonId: people[0].id });
    });
  });

  describe("bank details stay with the person and the admins", () => {
    it("agents see whether a person's details are in, never the details; admins see them with the NI number masked", async () => {
      const { renderToStaticMarkup } = await import("react-dom/server");
      (globalThis as { React?: unknown }).React = await import("react");
      const { PayDetailsCard, PersonPayCard } = await import("@/components/pay-details-card");
      const { act, people } = await band(["Nia", "Oli"]);
      await prisma.person.update({ where: { id: people[0].id }, data: { ...bank("70000001"), niNumber: "JG103726A" } });
      await prisma.artist.update({ where: { id: act.id }, data: { leadPersonId: people[0].id } });
      const asRole = (role: string) => ({ ...admin, role }) as never;
      const html = async (el: Promise<React.ReactElement | null>) => renderToStaticMarkup((await el)!);
      for (const el of [PersonPayCard({ personId: people[0].id, user: asRole("AGENT") }), PayDetailsCard({ artistId: act.id, user: asRole("AGENT") })]) {
        const agent = await html(el);
        expect(agent).toContain("Details complete");
        for (const secret of ["70000001", "11-22-33", "Band Lane", "JG", "26 A"]) expect(agent).not.toContain(secret);
      }
      const asAdmin = await html(PayDetailsCard({ artistId: act.id, user: asRole("ADMIN") }));
      expect(asAdmin).toContain("70000001");
      expect(asAdmin).toContain("•• •• •• 26 A");
      expect(asAdmin).not.toContain("JG103726A");
    });

    it("the band's other members never get the lead's details to fill in or see", async () => {
      const { payHoldersFor } = await import("@/lib/payee-server");
      const { saveMyDetails } = await import("@/actions/act-details");
      const { people } = await band(["Pat", "Quin"]);
      await prisma.person.update({ where: { id: people[0].id }, data: bank("80000001") });
      const holders = await payHoldersFor(people[1].login);
      expect(JSON.stringify(holders)).not.toContain("80000001");
      state.user = people[1].login;
      expect(await saveMyDetails("person", people[0].id, empty, form({ address: "x" }))).toEqual({
        error: expect.stringMatching(/can't change these details/),
      });
      state.user = admin;
    });
  });

  describe("everyone in a band hears about its gigs", () => {
    it("each of a 4-person band's members gets the offer, the confirmation, a change and the day's reminder", async () => {
      const { sendOffers } = await import("@/lib/offers");
      const { onConfirmed } = await import("@/lib/confirmations");
      const { saveAndTell } = await import("@/lib/bulk");
      const { runReminders } = await import("@/lib/reminders");
      const { recipientsForActs } = await import("@/lib/people");
      const { addDaysToKey, localDateKey, zonedToUtc } = await import("@/lib/time");
      const { act, people } = await band(["Wil", "Xan", "Yas", "Zed"], { email: mail("bandact") });
      await prisma.artist.update({ where: { id: act.id }, data: { leadPersonId: people[0].id } });
      const emails = people.map((p) => p.email);
      const count = async (bookingId: string, kind: string, subject?: string) => {
        const rows = await prisma.message.findMany({ where: { bookingId, kind, channel: "EMAIL", ...(subject ? { subject: { contains: subject } } : {}) } });
        return { to: rows.map((r) => r.to).sort(), all: rows.length };
      };
      // A gig two days from now at 19:00, booked a week before.
      const date = addDaysToKey(localDateKey(new Date(), "Europe/London"), 2);
      const arriveBy = zonedToUtc(date, "19:00", "Europe/London");
      const b = await prisma.booking.create({
        data: {
          agencyId,
          reference: `BP-${++n}`,
          artistId: act.id,
          status: "AWAITING",
          arriveBy,
          setStart: new Date(arriveBy.getTime() + 30 * 60_000),
          timezone: "Europe/London",
          artistFeeMinor: 40_000,
          feeMinor: 60_000,
          dealType: "BUY_SELL",
          createdAt: new Date(arriveBy.getTime() - 7 * DAY),
        },
      });

      // The offer: one each, every one with the link (any of them can answer, as before).
      expect(await sendOffers([b.id])).toBe(4);
      expect((await count(b.id, "BOOKING_CHANGE", "Booking offer")).to).toEqual([...emails].sort());

      // Confirmed: "You're booked" to each.
      await prisma.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED" } });
      await onConfirmed(b.id);
      expect((await count(b.id, "BOOKING_CHANGE", "You're booked")).to).toEqual([...emails].sort());

      // A change made with others (bulk changes and venue-wide changes go through here): told to each.
      const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id }, include: { venue: { select: { name: true } } } });
      await saveAndTell(row, { setStart: new Date(row.setStart.getTime() + HOUR) }, { agencyId, notify: true, changeover: 0 });
      expect((await count(b.id, "BOOKING_CHANGE", "has changed")).to).toEqual([...emails].sort());

      // On the day: a reminder each.
      await runReminders(new Date(zonedToUtc(date, "12:00", "Europe/London").getTime() + 60_000));
      expect((await count(b.id, "REMINDER")).to).toEqual([...emails].sort());

      // Never the act's own email, which isn't anyone's login.
      expect(await prisma.message.count({ where: { bookingId: b.id, to: act.email } })).toBe(0);

      // The band's own login, if it has one, hears too (it sees the gigs in the app).
      const bandLogin = await prisma.user.create({
        data: { email: mail("bandown"), name: act.name, passwordHash: "x", role: "ARTIST", agencyId, artistId: act.id },
      });
      const heard = (await recipientsForActs([act.id])).get(act.id)!;
      expect(heard.map((r) => r.userId).sort()).toEqual([...people.map((p) => p.login.id), bandLogin.id].sort());
      expect(heard.find((r) => r.userId === bandLogin.id)).toMatchObject({ emails: [bandLogin.email], phone: "" });
    });
  });
});
