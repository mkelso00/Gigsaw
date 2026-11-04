import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Tenant isolation: staff at one agency must never read or change another agency's records,
// even with the right ids. Every action looks its record up with the user's agencyId (the
// ownBooking, ownArtist, ownContact, ownPerson, ownEvent, ownVenue, ownSlot and ownRequest
// helpers in src/actions), and treats anything else as not found. Signed in as agency A, each
// action is pointed at agency B's ids; B's records must come out exactly as they went in.
// Runs only against the test database (see tests/helpers/db.ts).

const staff = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireStaff: async () => staff.user,
  requireAdmin: async () => staff.user,
  requireUser: async () => staff.user,
}));

type Db = typeof import("@/lib/db");

describeDb("tenant isolation (database)", () => {
  let prisma: Db["prisma"];
  let agencyA = "";
  let agencyB = "";
  const empty = undefined as never;
  const day = 24 * 3_600_000;

  // One of each kind of record, for each agency.
  type Records = { booking: string; artist: string; contact: string; person: string; venue: string; slot: string; event: string; request: string };
  let a: Records;
  let b: Records;

  const form = (fields: Record<string, string | string[]> = {}) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
    return f;
  };

  const makeRecords = async (agencyId: string, tag: string): Promise<Records> => {
    const artist = await prisma.artist.create({ data: { agencyId, name: `Act ${tag}`, demo: true } });
    const contact = await prisma.contact.create({ data: { agencyId, name: `Contact ${tag}`, demo: true } });
    const person = await prisma.person.create({ data: { agencyId, firstName: `Person ${tag}`, demo: true } });
    const venue = await prisma.venue.create({ data: { agencyId, name: `Venue ${tag}`, demo: true } });
    const slot = await prisma.venueSlot.create({
      data: { agencyId, venueId: venue.id, weekday: 5, arriveTime: "18:30", startTime: "19:00", endTime: "21:00" },
    });
    const event = await prisma.event.create({ data: { agencyId, name: `Wedding ${tag}`, date: "2027-06-12" } });
    const setStart = new Date(Date.now() + 10 * day);
    // Demo bookings, so nothing is ever sent.
    const booking = await prisma.booking.create({
      data: {
        agencyId,
        reference: `ISO-${tag}`,
        artistId: artist.id,
        venueId: venue.id,
        promoterId: contact.id,
        status: "PENDING",
        arriveBy: setStart,
        setStart,
        demo: true,
      },
    });
    const request = await prisma.availabilityRequest.create({
      data: {
        agencyId,
        date: "2027-06-12",
        place: `Barn ${tag}`,
        replies: { create: { artistId: artist.id, token: `iso-${tag}-${Date.now().toString(36)}` } },
      },
    });
    return {
      booking: booking.id,
      artist: artist.id,
      contact: contact.id,
      person: person.id,
      venue: venue.id,
      slot: slot.id,
      event: event.id,
      request: request.id,
    };
  };

  /** Everything about agency B's records that an action could change. */
  const snapshot = async (r: Records) => ({
    booking: await prisma.booking.findUnique({ where: { id: r.booking }, include: { payments: true, checkIns: true } }),
    artist: await prisma.artist.findUnique({ where: { id: r.artist } }),
    contact: await prisma.contact.findUnique({ where: { id: r.contact }, include: { notes: true } }),
    person: await prisma.person.findUnique({ where: { id: r.person }, include: { acts: true } }),
    venue: await prisma.venue.findUnique({ where: { id: r.venue }, include: { slots: { orderBy: { id: "asc" } } } }),
    slot: await prisma.venueSlot.findUnique({ where: { id: r.slot } }),
    event: await prisma.event.findUnique({ where: { id: r.event }, include: { tasks: true } }),
    request: await prisma.availabilityRequest.findUnique({ where: { id: r.request }, include: { replies: { orderBy: { id: "asc" } } } }),
    bookings: await prisma.booking.count({ where: { agencyId: agencyB, archivedAt: undefined } }),
  });
  let before: Awaited<ReturnType<typeof snapshot>>;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const one = await createTestAgency(prisma, "iso-a");
    const two = await createTestAgency(prisma, "iso-b");
    agencyA = one.agency.id;
    agencyB = two.agency.id;
    staff.user = one.user;
    a = await makeRecords(agencyA, `A-${one.stamp}`);
    b = await makeRecords(agencyB, `B-${two.stamp}`);
    before = await snapshot(b);
  });

  afterAll(async () => {
    await removeTestAgency(prisma, agencyA);
    await removeTestAgency(prisma, agencyB);
    await prisma.$disconnect();
  });

  it("refuses another agency's bookings", async () => {
    const actions = await import("@/actions/bookings");
    const notFound = { error: "Booking not found" };
    expect(await actions.updateBooking(b.booking, empty, form({ status: "CONFIRMED" }))).toEqual(notFound);
    expect(await actions.setBookingStatus(b.booking, empty, form({ status: "CANCELLED" }))).toEqual(notFound);
    expect(await actions.resendOffer(b.booking, empty)).toEqual(notFound);
    expect(await actions.addPayment(b.booking, empty, form({ direction: "IN", amount: "100" }))).toEqual(notFound);
    expect(await actions.logCheckInForArtist(b.booking, empty, form({ kind: "ARRIVED" }))).toEqual(notFound);
    await expect(actions.setBookingArchived(b.booking, true)).rejects.toThrow("Booking not found");
    await expect(actions.deleteBooking(b.booking)).rejects.toThrow("Booking not found");
    await expect(actions.copyBooking(b.booking, ["2027-01-01"], "PENDING", true)).rejects.toThrow("Booking not found");
    await actions.archiveBookings(form({ ids: [b.booking] }));
  });

  it("refuses another agency's acts and contacts", async () => {
    const crm = await import("@/actions/crm");
    expect(await crm.updateArtist(b.artist, empty, form({ name: "Taken over" }))).toEqual({ error: "Artist not found" });
    expect(await crm.deleteArtist(b.artist, empty)).toEqual({ error: "Artist not found" });
    expect(await crm.setArtistLogin(b.artist, empty, form({ email: "x@gigsaw.invalid", password: "password123" }))).toEqual({ error: "Artist not found" });
    expect(await crm.updateContact(b.contact, empty, form({ name: "Taken over" }))).toEqual({ error: "Contact not found" });
    expect(await crm.addContactNote(b.contact, empty, form({ body: "Hello from agency A" }))).toEqual({ error: "Contact not found" });
    await crm.deleteContact(b.contact);
  });

  it("refuses another agency's people", async () => {
    const people = await import("@/actions/people");
    expect(await people.updatePerson(b.person, empty, form({ firstName: "Taken over" }))).toEqual({ error: "Person not found" });
    expect(await people.setPersonLogin(b.person, empty, form({ email: "x@gigsaw.invalid", password: "password123" }))).toEqual({ error: "Person not found" });
    await people.deletePerson(b.person);
  });

  it("refuses another agency's weddings and events", async () => {
    const events = await import("@/actions/events");
    const notFound = { error: "Wedding or event not found" };
    expect(await events.updateEvent(b.event, empty, form({ name: "Taken over", date: "2027-06-13" }))).toEqual(notFound);
    expect(await events.updateEventPlan(b.event, empty, form({ guestCount: "10" }))).toEqual(notFound);
    expect(await events.addEventAct(b.event, empty, form({ artistId: a.artist }))).toEqual(notFound);
    expect(await events.addEventTask(b.event, empty, form({ title: "From agency A" }))).toEqual(notFound);
    expect(await events.recordEventPayment(b.event, empty, form({ amount: "100" }))).toEqual(notFound);
    await events.deleteEvent(b.event);
  });

  it("refuses another agency's venues and schedule slots", async () => {
    const slots = await import("@/actions/slots");
    expect(await slots.createSlots(b.venue, empty, form({ weekdays: "1", arriveTime: "18:30", startTime: "19:00", endTime: "21:00" }))).toEqual({
      error: "Venue not found",
    });
    expect(await slots.updateSlot(b.slot, empty, form({ arriveTime: "17:00", startTime: "18:00", endTime: "20:00" }))).toEqual({ error: "Slot not found" });
    expect(await slots.assignSlot(b.slot, "2027-06-11", empty, form({ artistId: a.artist }))).toEqual({ error: "Slot not found" });
    await slots.deleteSlot(b.slot);
  });

  it("refuses another agency's availability requests", async () => {
    const availability = await import("@/actions/availability");
    expect(await availability.askMoreActs(b.request, empty, form({ artistIds: a.artist }))).toEqual({ error: "Request not found" });
    expect(await availability.remindAvailability(b.request, empty)).toEqual({ error: "Request not found" });
    await availability.setRequestClosed(b.request, true);
  });

  it("leaves the other agency's records exactly as they were", async () => {
    expect(await snapshot(b)).toEqual(before);
  });

  it("still works on the user's own records", async () => {
    // So the refusals above are down to the agency, not a broken test user.
    const crm = await import("@/actions/crm");
    const events = await import("@/actions/events");
    const slots = await import("@/actions/slots");
    const availability = await import("@/actions/availability");
    const bookings = await import("@/actions/bookings");
    expect(await crm.addContactNote(a.contact, empty, form({ body: "Our own note" }))).toEqual({ ok: "Note added." });
    expect(await events.addEventTask(a.event, empty, form({ title: "Our own task" }))).toEqual({ ok: "Added." });
    await availability.setRequestClosed(a.request, true);
    await slots.deleteSlot(a.slot);
    await bookings.setBookingArchived(a.booking, true);
    expect(await prisma.contactNote.count({ where: { contactId: a.contact } })).toBe(1);
    expect(await prisma.eventTask.count({ where: { eventId: a.event } })).toBe(1);
    expect((await prisma.availabilityRequest.findUniqueOrThrow({ where: { id: a.request } })).closedAt).not.toBeNull();
    expect(await prisma.venueSlot.count({ where: { id: a.slot } })).toBe(0);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: a.booking } })).archivedAt).not.toBeNull();
  });
});
