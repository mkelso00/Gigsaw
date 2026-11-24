import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// The client's lead contact (src/lib/client-recipient.ts), end to end in the database: the arrival note goes to the
// booking's lead contact rather than the owner, falling back to the venue's and then the company's; with "Send
// day-to-day emails to this company's own email" off and no lead contact it isn't sent at all; wedding couples and
// private customers hear exactly as before; the PO request goes to the lead contact; a copied booking keeps it; and
// "Someone new" on the booking form adds the person at the venue. Messages land in the Message table (no provider is
// set up in tests). Database tests: TEST_DATABASE_URL only.

const staff = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireStaff: async () => staff.user,
  requireAdmin: async () => staff.user,
  requireUser: async () => staff.user,
}));

type Db = (typeof import("@/lib/db"))["prisma"];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describeDb("the client's lead contact (database)", () => {
  let prisma: Db;
  let agencyId = "";
  let stamp = "";
  let n = 0;
  const ids: Record<string, string> = {};
  const mail = (who: string) => `${who}-${stamp}@lead.gigsaw.invalid`;

  beforeAll(async () => {
    prisma = (await import("@/lib/db")).prisma;
    const t = await createTestAgency(prisma, "lead", { agencyName: "Lead Test Music", clientArrivalMessages: true });
    agencyId = t.agency.id;
    stamp = t.stamp;
    staff.user = t.user;
    ids.act = (await prisma.artist.create({ data: { agencyId, name: "Lead Test Act" } })).id;
    ids.swan = (await prisma.venue.create({ data: { agencyId, name: "The Swan" } })).id;
    ids.crown = (await prisma.venue.create({ data: { agencyId, name: "The Crown" } })).id;
    ids.rekom = (await prisma.contact.create({ data: { agencyId, name: "Rekom accounts", company: "Rekom", email: mail("owner"), phone: "07700 900001" } })).id;
    const person = (firstName: string, at: { venueId?: string; companyId?: string }, phone: string) =>
      prisma.person.create({ data: { agencyId, firstName, surname: "Lead", email: mail(firstName.toLowerCase()), phone, ...at } });
    ids.sam = (await person("Sam", { venueId: ids.swan }, "07700 900002")).id;
    ids.jo = (await person("Jo", { venueId: ids.swan }, "07700 900003")).id;
    ids.kim = (await person("Kim", { companyId: ids.rekom }, "07700 900004")).id;
    await prisma.venue.update({ where: { id: ids.swan }, data: { leadContactId: ids.sam } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  /** A confirmed gig starting in an hour, the act just arrived. */
  const gig = async (data: Record<string, unknown> = {}) => {
    const setStart = new Date(Date.now() + HOUR + ++n * 60_000);
    return prisma.booking.create({
      data: {
        agencyId,
        reference: `LD-${n}-${stamp}`,
        artistId: ids.act,
        status: "CONFIRMED",
        arriveBy: new Date(setStart.getTime() - HOUR),
        setStart,
        setEnd: new Date(setStart.getTime() + 2 * HOUR),
        notifyClientOnArrival: true,
        ...data,
      },
    });
  };
  const arrive = async (bookingId: string) => {
    await prisma.checkIn.create({ data: { bookingId, artistId: ids.act, kind: "ARRIVED" } });
    const { notifyClientOfArrival } = await import("@/lib/alerts");
    return notifyClientOfArrival(bookingId);
  };
  const sentFor = (bookingId: string, kind = "CLIENT_ARRIVAL") =>
    prisma.message.findMany({ where: { agencyId, bookingId, kind }, select: { to: true, channel: true, body: true } });
  const to = async (bookingId: string, kind?: string) => (await sentFor(bookingId, kind)).map((m) => `${m.channel} ${m.to}`).sort();

  it("sends the arrival note to the booking's lead contact, not the owner or the venue's usual contact", async () => {
    const b = await gig({ venueId: ids.swan, promoterId: ids.rekom, clientContactId: ids.jo });
    expect(await arrive(b.id)).toBe(true);
    expect(await to(b.id)).toEqual(["EMAIL " + mail("jo"), "SMS +447700900003"].sort());
    expect((await sentFor(b.id)).find((m) => m.channel === "EMAIL")!.body).toContain("Hi Jo");
  });

  it("falls back to the venue's lead contact, then the company's, then the company itself", async () => {
    const atSwan = await gig({ venueId: ids.swan, promoterId: ids.rekom });
    expect(await arrive(atSwan.id)).toBe(true);
    expect(await to(atSwan.id)).toEqual(["EMAIL " + mail("sam"), "SMS +447700900002"].sort());

    // The Crown has no lead contact: Rekom's.
    await prisma.contact.update({ where: { id: ids.rekom }, data: { leadContactId: ids.kim } });
    const atCrown = await gig({ venueId: ids.crown, promoterId: ids.rekom });
    expect(await arrive(atCrown.id)).toBe(true);
    expect(await to(atCrown.id)).toEqual(["EMAIL " + mail("kim"), "SMS +447700900004"].sort());

    // Nobody named anywhere: the company's own email and phone, as before.
    await prisma.contact.update({ where: { id: ids.rekom }, data: { leadContactId: null } });
    const plain = await gig({ venueId: ids.crown, promoterId: ids.rekom });
    expect(await arrive(plain.id)).toBe(true);
    expect(await to(plain.id)).toEqual(["EMAIL " + mail("owner"), "SMS +447700900001"].sort());
  });

  it("doesn't send the arrival note at all when the company doesn't want day-to-day emails and has no lead contact", async () => {
    await prisma.contact.update({ where: { id: ids.rekom }, data: { notifyOwner: false } });
    try {
      const b = await gig({ venueId: ids.crown, promoterId: ids.rekom });
      expect(await arrive(b.id)).toBe(false);
      expect(await sentFor(b.id)).toHaveLength(0);
      // Not claimed either: choose a lead contact before the act arrives and they're told.
      expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.clientNotifiedAt).toBeNull();

      // A lead contact still hears, at the venue or on the booking.
      const atSwan = await gig({ venueId: ids.swan, promoterId: ids.rekom });
      expect(await arrive(atSwan.id)).toBe(true);
      expect(await to(atSwan.id)).toEqual(["EMAIL " + mail("sam"), "SMS +447700900002"].sort());
    } finally {
      await prisma.contact.update({ where: { id: ids.rekom }, data: { notifyOwner: true } });
    }
  });

  it("leaves wedding couples and private customers as they were, even at a venue with a lead contact", async () => {
    await prisma.settings.update({ where: { agencyId }, data: { customerConfirmations: "EVENTS" } });
    const coupleEmail = mail("couple");
    const couple = await prisma.contact.create({ data: { agencyId, type: "CLIENT", name: "Hannah Jones", email: coupleEmail, phone: "07700 900005" } });
    const { onConfirmed } = await import("@/lib/confirmations");

    // A wedding at The Swan: no arrival note (couples never get one), and the "confirmed" email goes to the couple.
    const wedding = await gig({ venueId: ids.swan, promoterId: couple.id, eventType: "WEDDING" });
    expect(await arrive(wedding.id)).toBe(false);
    await onConfirmed(wedding.id);
    expect(await to(wedding.id, "EVENT")).toEqual(["EMAIL " + coupleEmail]);

    // A private customer's party at The Swan: the arrival note and the confirmation go to them, not to Sam.
    const party = await gig({ venueId: ids.swan, promoterId: couple.id, eventType: "PRIVATE_PARTY" });
    expect(await arrive(party.id)).toBe(true);
    expect(await to(party.id)).toEqual(["EMAIL " + coupleEmail, "SMS +447700900005"].sort());
    await onConfirmed(party.id);
    expect(await to(party.id, "EVENT")).toEqual(["EMAIL " + coupleEmail]);

    // A wedding with several acts: the customer hears once, as before.
    const event = await prisma.event.create({ data: { agencyId, name: "Hannah's wedding", date: "2031-08-14", customerId: couple.id } });
    const inEvent = await gig({ venueId: ids.swan, promoterId: couple.id, eventType: "WEDDING", eventId: event.id });
    await onConfirmed(inEvent.id);
    expect(await prisma.message.findMany({ where: { agencyId, kind: "EVENT", to: coupleEmail, bookingId: null } })).toHaveLength(1);

    // Only a lead contact chosen on the booking itself takes over.
    const planned = await gig({ venueId: ids.swan, promoterId: couple.id, eventType: "PRIVATE_PARTY", clientContactId: ids.jo });
    await onConfirmed(planned.id);
    expect(await to(planned.id, "EVENT")).toEqual(["EMAIL " + mail("jo")]);
  });

  it("sends the PO request to the lead contact, and to the company's own email when it has none", async () => {
    const actions = await import("@/actions/monthly-billing");
    const server = await import("@/lib/monthly-billing-server");
    const month = "2031-05";
    const venue = await prisma.venue.create({ data: { agencyId, name: "The Lamb" } });
    const ali = await prisma.person.create({ data: { agencyId, firstName: "Ali", surname: "Lead", email: mail("ali"), venueId: venue.id } });
    const payer = await prisma.contact.create({
      data: { agencyId, name: "Lamb Pubs Ltd", email: mail("lamb-owner"), billing: "PER_VENUE", notifyOwner: false },
    });
    const setStart = new Date(Date.UTC(2031, 4, 9, 19));
    await gig({ venueId: venue.id, promoterId: payer.id, setStart, arriveBy: new Date(setStart.getTime() - HOUR), setEnd: null, feeMinor: 20_000 });
    const bill = async () => (await server.monthlyBills(agencyId, month)).find((v) => v.bill.venueId === venue.id)!;

    // No lead contact, and the company has asked for no day-to-day emails: a PO request is a business document, so its own email.
    const own = await server.poRecipient(agencyId, await bill());
    expect(own).toMatchObject({ email: mail("lamb-owner") });
    expect(own!.hint).toMatch(/still go to the company/);

    await prisma.venue.update({ where: { id: venue.id }, data: { leadContactId: ali.id } });
    const form = new FormData();
    form.set("mode", "send");
    expect((await actions.askForPo((await bill()).id, undefined, form))?.error).toBeUndefined();
    const sent = await prisma.message.findMany({ where: { agencyId, kind: "BILLING" }, select: { to: true, body: true } });
    expect(sent.map((m) => m.to)).toEqual([mail("ali")]);
    expect(sent[0].body).toContain("Hi Ali");
  });

  it("keeps the lead contact when a booking is copied, and adds Someone new at the venue from the booking form", async () => {
    const { copyBooking, createBooking } = await import("@/actions/bookings");
    const original = await gig({ venueId: ids.swan, promoterId: ids.rekom, clientContactId: ids.jo, status: "PENDING", demo: true });
    const day = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
    const res = await copyBooking(original.id, [day(40), day(47)], "PENDING", true);
    expect(res.ok).toBe(true);
    const copies = await prisma.booking.findMany({ where: { id: { in: res.ids } } });
    expect(copies.map((c) => c.clientContactId)).toEqual([ids.jo, ids.jo]);

    const eventName = `Someone new ${stamp}`;
    const f = new FormData();
    for (const [k, v] of Object.entries({
      venueId: ids.crown,
      promoterId: ids.rekom,
      date: day(60),
      setStartTime: "19:00",
      status: "PENDING",
      eventName,
      clientContactId: "new",
      newContactName: "Pat de Souza",
      newContactEmail: mail("PAT"),
      newContactPhone: "07700 900006",
    }))
      f.set(k, v);
    expect(await createBooking(undefined, f)).toBeUndefined();
    const made = await prisma.booking.findFirstOrThrow({ where: { agencyId, eventName }, include: { clientContact: true } });
    expect(made.clientContact).toMatchObject({ firstName: "Pat", surname: "de Souza", email: mail("pat"), phone: "07700 900006", venueId: ids.crown });

    // Left on Automatic, a new booking names nobody: the venue's lead contact is used when messages go.
    const auto = new FormData();
    for (const [k, v] of Object.entries({
      venueId: ids.swan,
      date: day(61),
      setStartTime: "19:00",
      status: "PENDING",
      eventName: `${eventName} 2`,
      clientContactId: "",
    }))
      auto.set(k, v);
    expect(await createBooking(undefined, auto)).toBeUndefined();
    expect((await prisma.booking.findFirstOrThrow({ where: { agencyId, eventName: `${eventName} 2` } })).clientContactId).toBeNull();
  });
});
