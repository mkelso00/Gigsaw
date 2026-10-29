// Sample agency data: artists, venues, promoters and about 80 bookings spread over the past
// six months, today and the next three months, with arrivals and payments.
// Used by the "Load demo data" button in Settings and by the local seed script.
// Every record is flagged `demo: true` so removeDemoData can take it all out again.

import { randomBytes } from "node:crypto";
import type { Artist, Contact, PrismaClient, Venue } from "@prisma/client";
import bcrypt from "bcryptjs";
import { distanceMetres } from "./arrival";
import { VENUE_PALETTE } from "./rota";
import { addDaysToKey, localDateKey, zonedToUtc } from "./time";

const MIN = 60_000;
const DAY = 86_400_000;

export async function hasDemoData(prisma: PrismaClient, agencyId: string) {
  return (await prisma.artist.count({ where: { agencyId, demo: true } })) > 0;
}

/**
 * Add the sample data. `leadAgentId` looks after some of the artists. If `secondAgentId` is
 * not given, a demo agent who cannot sign in is created to look after the rest.
 */
export async function addDemoData(prisma: PrismaClient, opts: { agencyId: string; leadAgentId: string; secondAgentId?: string }) {
  const agencyId = opts.agencyId;
  // Seeded random numbers so the demo looks the same each time.
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

  const lead = opts.leadAgentId;
  const second =
    opts.secondAgentId ??
    (
      await prisma.user.create({
        data: {
          email: `sam.patel.${randomBytes(4).toString("hex")}@demo.invalid`,
          name: "Sam Patel (demo)",
          role: "AGENT",
          agencyId,
          demo: true,
          // Random password nobody knows, so this demo agent can never sign in.
          passwordHash: await bcrypt.hash(randomBytes(24).toString("hex"), 10),
        },
      })
    ).id;

  const artistSeed = [
    { name: "Maya Okafor Trio", phone: "07700 900201", genre: "Jazz", colour: "#7c3aed", agentId: lead },
    { name: "The Velvet Owls", phone: "07700 900202", genre: "Indie rock", colour: "#0ea5e9", agentId: second },
    { name: "DJ Kestrel", phone: "07700 900203", genre: "House", colour: "#f97316", agentId: second, defaultCommission: 12 },
    { name: "Brass Tacks Collective", phone: "07700 900204", genre: "Brass / funk", colour: "#16a34a", agentId: lead },
    { name: "Elena Ruiz", phone: "07700 900205", genre: "Singer-songwriter", colour: "#e11d48", agentId: lead },
  ];
  const artists: Artist[] = [];
  for (const a of artistSeed) {
    const slug = a.name
      .toLowerCase()
      .replace(/[^a-z]+/g, ".")
      .replace(/^\.|\.$/g, "");
    artists.push(await prisma.artist.create({ data: { ...a, agencyId, email: `${slug}@example.com`, demo: true } }));
  }

  const venueSeed = [
    { name: "Jazz Cafe", city: "London", country: "UK", latitude: 51.5392, longitude: -0.1426, capacity: 440, address: "5 Parkway, Camden" },
    { name: "Band on the Wall", city: "Manchester", country: "UK", latitude: 53.4851, longitude: -2.2353, capacity: 500, address: "25 Swan Street" },
    { name: "Thekla", city: "Bristol", country: "UK", latitude: 51.4493, longitude: -2.5927, capacity: 400, address: "The Grove, East Mud Dock" },
    { name: "King Tut's Wah Wah Hut", city: "Glasgow", country: "UK", latitude: 55.8622, longitude: -4.2654, capacity: 300, address: "272a St Vincent Street" },
    { name: "Brudenell Social Club", city: "Leeds", country: "UK", latitude: 53.8146, longitude: -1.5737, capacity: 400, address: "33 Queens Road" },
    { name: "Concorde 2", city: "Brighton", country: "UK", latitude: 50.8167, longitude: -0.1197, capacity: 600, address: "Madeira Drive" },
    {
      name: "Whelan's",
      city: "Dublin",
      country: "Ireland",
      latitude: 53.3361,
      longitude: -6.2655,
      capacity: 450,
      address: "25 Wexford Street",
      timezone: "Europe/Dublin",
    },
    {
      name: "Paradiso",
      city: "Amsterdam",
      country: "Netherlands",
      latitude: 52.3622,
      longitude: 4.8838,
      capacity: 1500,
      address: "Weteringschans 6-8",
      timezone: "Europe/Amsterdam",
    },
    { name: "The Village Hall", city: "Hebden Bridge", country: "UK", latitude: null, longitude: null, capacity: 120, address: "Market Street" },
  ];
  const venues: Venue[] = [];
  for (const [i, v] of venueSeed.entries()) {
    venues.push(
      await prisma.venue.create({ data: { timezone: "Europe/London", ...v, colour: VENUE_PALETTE[i % VENUE_PALETTE.length], agencyId, demo: true } }),
    );
  }

  const promoterSeed = [
    { name: "Priya Shah", company: "Lantern Live", tags: "uk, jazz", email: "priya@lantern.example", phone: "07700 900111" },
    { name: "Tom Fletcher", company: "Fletcher Promotions", tags: "uk, rock", email: "tom@fletcher.example", phone: "07700 900222" },
    { name: "Aoife Byrne", company: "Liffey Sounds", tags: "ireland", email: "aoife@liffey.example", phone: "+353 1 555 0100" },
    { name: "Jasper de Vries", company: "Canal Concerts", tags: "europe, festival", email: "jasper@canal.example", phone: "+31 20 555 0199" },
    { name: "Hannah Brooks", company: "Private client", tags: "private, wedding", email: "hannah@example.com", phone: "07700 900333" },
  ];
  const promoters: Contact[] = [];
  for (const p of promoterSeed) {
    promoters.push(
      await prisma.contact.create({
        data: { ...p, type: p.company === "Private client" ? "CLIENT" : "PROMOTER", address: "1 Example Road\nExample Town", agencyId, demo: true },
      }),
    );
  }
  await prisma.contact.create({
    data: { type: "COLLABORATOR", name: "Chris Lowe", company: "Lowe Sound Hire", tags: "production", phone: "07700 900444", agencyId, demo: true },
  });
  await prisma.contactNote.create({
    data: { contactId: promoters[0].id, authorId: lead, body: "Keen on a second Maya date in the spring. Prefers contracts by email." },
  });

  // People: the members of two bands (Tom plays in both, so clashes are checked across them),
  // and a manager at three venues.
  const person = (firstName: string, surname: string, extra: Record<string, string | null> = {}) =>
    prisma.person.create({ data: { agencyId, firstName, surname, demo: true, ...extra } });
  const mayaP = await person("Maya", "Okafor", { phone: "07700 900211", email: "maya.okafor@example.com", pronouns: "she/her" });
  const tomP = await person("Tom", "Price", { phone: "07700 900212", email: "tom.price@example.com" });
  const adeP = await person("Ade", "Bello", { phone: "07700 900213" });
  const lucyP = await person("Lucy", "Hart", { phone: "07700 900214", alias: "Lucy Owl" });
  await prisma.personAct.createMany({
    data: [
      { personId: mayaP.id, artistId: artists[0].id, jobTitle: "Lead vocals" },
      { personId: tomP.id, artistId: artists[0].id, jobTitle: "Piano" },
      { personId: adeP.id, artistId: artists[0].id, jobTitle: "Double bass" },
      { personId: lucyP.id, artistId: artists[1].id, jobTitle: "Vocals, guitar" },
      { personId: tomP.id, artistId: artists[1].id, jobTitle: "Keys" },
    ],
  });
  for (const [i, [first, last, title]] of [
    ["Sam", "Whitaker", "General manager"],
    ["Rosie", "Adams", "Bar manager"],
    ["Callum", "Reid", "Venue manager"],
  ].entries()) {
    await person(first, last, { venueId: venues[i].id, jobTitle: title, phone: `07700 9003${10 + i}`, email: `${first.toLowerCase()}@venue.example` });
  }

  // Weekly music schedules for three venues, so the rota has something to show.
  const [elena, maya, kestrel, owls] = [artists[4], artists[0], artists[2], artists[1]];
  const slotRows: { v: Venue; days: number[]; label: string; arrive: string; start: string; end: string; fee: number; artist: Artist | null }[] = [
    { v: venues[0], days: [1, 2, 4], label: "Solo", arrive: "18:30", start: "19:00", end: "21:00", fee: 150, artist: elena },
    { v: venues[0], days: [3], label: "Solo", arrive: "17:30", start: "18:00", end: "20:00", fee: 150, artist: elena },
    { v: venues[0], days: [5], label: "Duo", arrive: "15:30", start: "16:00", end: "19:00", fee: 220, artist: maya },
    { v: venues[0], days: [5], label: "Band", arrive: "18:30", start: "19:00", end: "22:00", fee: 450, artist: owls },
    { v: venues[1], days: [4, 5, 6], label: "Solo", arrive: "18:30", start: "19:00", end: "22:00", fee: 180, artist: null },
    { v: venues[5], days: [6], label: "DJ", arrive: "21:30", start: "22:00", end: "02:00", fee: 300, artist: kestrel },
  ];
  for (const r of slotRows) {
    await prisma.venueSlot.createMany({
      data: r.days.map((weekday) => ({
        agencyId,
        venueId: r.v.id,
        weekday,
        label: r.label,
        arriveTime: r.arrive,
        startTime: r.start,
        endTime: r.end,
        feeMinor: r.fee * 100,
        currency: "GBP",
        eventType: r.label === "DJ" ? "CLUB_NIGHT" : "GIG",
        promoterId: promoters[0].id,
        artistId: r.artist?.id ?? null,
      })),
    });
  }

  // Carry on numbering after any real bookings.
  const last = await prisma.booking.findFirst({ where: { agencyId }, orderBy: { reference: "desc" }, select: { reference: true } });
  let refN = last ? Number(last.reference.replace(/\D/g, "")) : 0;
  const nextRef = () => `GS-${String(++refN).padStart(4, "0")}`;

  const now = new Date();

  async function book(o: {
    artist: Artist;
    venue: Venue;
    status: string;
    fee: number;
    /** Local date and times, or an exact call time for today's gigs. */
    date?: string;
    arrive?: string;
    set?: string;
    arriveAt?: Date;
    arrival?: { offsetMin: number; onSite: boolean; byAgent?: boolean } | "none";
    onTheWay?: { at: Date; eta: number };
  }) {
    const tz = o.venue.timezone;
    const arriveBy = o.arriveAt ?? zonedToUtc(o.date!, o.arrive!, tz);
    const setStart = o.arriveAt ? new Date(arriveBy.getTime() + 180 * MIN) : zonedToUtc(localDateKey(arriveBy, tz), o.set!, tz);
    const setEnd = new Date(setStart.getTime() + 90 * MIN);
    const promoter = pick(promoters);
    const festival = rand() > 0.7;
    const eventType =
      promoter.type === "CLIENT" ? pick(["WEDDING", "PRIVATE_PARTY", "CORPORATE"]) : o.artist.genre === "House" ? "CLUB_NIGHT" : festival ? "FESTIVAL" : "GIG";
    const commissionPct = o.artist.defaultCommission ?? 15;
    const b = await prisma.booking.create({
      data: {
        reference: nextRef(),
        agencyId,
        demo: true,
        artistId: o.artist.id,
        venueId: o.venue.id,
        promoterId: promoter.id,
        agentId: o.artist.agentId,
        createdById: o.artist.agentId,
        status: o.status,
        eventType,
        timezone: tz,
        arriveBy,
        soundcheckAt: new Date(arriveBy.getTime() + 60 * MIN),
        setStart,
        setEnd,
        currency: tz === "Europe/London" ? "GBP" : "EUR",
        feeMinor: o.fee * 100,
        commissionPct,
        depositMinor: Math.round(o.fee * 0.5) * 100,
        depositDueDate: new Date(arriveBy.getTime() - 30 * DAY),
        travel: "Train from home station. Tickets in the shared folder.",
        accommodation: rand() > 0.5 ? "Premier Inn, 5 minutes' walk. Booked under the artist's name." : "",
        dayContact: `${promoter.name} · ${promoter.phone}`,
        hospitality: "Rider: hot meal for the band, 12 bottles of water, 1 bottle of red.",
        tags: eventType === "FESTIVAL" ? "festival" : "",
      },
    });

    // Payments: deposits and settlements for past shows, some deposits for future ones.
    if ((o.status === "SETTLED" || o.status === "CONFIRMED") && arriveBy < now) {
      await prisma.payment.create({
        data: { bookingId: b.id, direction: "IN", kind: "DEPOSIT", amountMinor: b.depositMinor, paidAt: new Date(arriveBy.getTime() - 40 * DAY) },
      });
      if (o.status === "SETTLED") {
        await prisma.payment.create({
          data: { bookingId: b.id, direction: "IN", kind: "BALANCE", amountMinor: b.feeMinor - b.depositMinor, paidAt: arriveBy },
        });
        const artistShare = b.feeMinor - Math.round((b.feeMinor * commissionPct) / 100);
        await prisma.payment.create({
          data: { bookingId: b.id, direction: "OUT", kind: "SETTLEMENT", amountMinor: artistShare, paidAt: new Date(arriveBy.getTime() + 7 * DAY) },
        });
      }
    } else if (o.status === "CONFIRMED" && rand() > 0.4) {
      await prisma.payment.create({
        data: {
          bookingId: b.id,
          direction: "IN",
          kind: "DEPOSIT",
          amountMinor: b.depositMinor,
          paidAt: new Date(Math.min(now.getTime(), arriveBy.getTime() - 35 * DAY)),
        },
      });
    }

    if (o.onTheWay) {
      await prisma.checkIn.create({
        data: { bookingId: b.id, artistId: o.artist.id, kind: "ON_THE_WAY", source: "APP", at: o.onTheWay.at, etaMinutes: o.onTheWay.eta },
      });
    }
    if (o.arrival && o.arrival !== "none") {
      const at = new Date(arriveBy.getTime() + o.arrival.offsetMin * MIN);
      if (at <= now) {
        const v = o.venue;
        // Put the phone either at the venue or a couple of km away.
        const lat = v.latitude !== null ? v.latitude + (o.arrival.onSite ? 0.0008 : 0.02) : null;
        const lng = v.longitude !== null ? v.longitude + (o.arrival.onSite ? 0.0005 : 0.01) : null;
        const byAgent = o.arrival.byAgent ?? false;
        await prisma.checkIn.create({
          data: {
            bookingId: b.id,
            artistId: o.artist.id,
            kind: "ARRIVED",
            source: byAgent ? "AGENT" : "APP",
            userId: byAgent ? o.artist.agentId : null,
            at,
            latitude: byAgent ? null : lat,
            longitude: byAgent ? null : lng,
            accuracyM: byAgent ? null : 12,
            distanceM:
              !byAgent && lat !== null && lng !== null && v.latitude !== null && v.longitude !== null
                ? distanceMetres(lat, lng, v.latitude, v.longitude)
                : null,
            note: byAgent ? "Promoter rang to confirm" : "",
          },
        });
        if (setEnd < now) {
          await prisma.checkIn.create({
            data: { bookingId: b.id, artistId: o.artist.id, kind: "DEPARTED", source: "APP", at: new Date(setEnd.getTime() + 45 * MIN) },
          });
        }
      }
    }
  }

  const todayKey = localDateKey(now, "Europe/London");
  const times = { arrive: ["16:00", "17:00", "17:30", "18:00"], set: ["20:00", "20:30", "21:00"], fee: [800, 1200, 1500, 2000, 2500, 3500] };

  // Past six months: mostly on time, some late, a few with no check-in.
  // Each artist has a different timekeeping habit.
  const lateBias = [0.05, 0.25, 0.4, 0.1, 0.15];
  for (let i = 0; i < 45; i++) {
    const artist = artists[i % artists.length];
    const daysAgo = 3 + Math.floor(rand() * 180);
    const r = rand();
    const late = r < 0.08 + lateBias[i % artists.length];
    const arrival =
      r < 0.08 ? ("none" as const) : { offsetMin: late ? 8 + Math.floor(rand() * 40) : -Math.floor(rand() * 45), onSite: rand() > 0.1, byAgent: rand() > 0.9 };
    await book({
      artist,
      venue: pick(venues),
      date: addDaysToKey(todayKey, -daysAgo),
      arrive: pick(times.arrive),
      set: pick(times.set),
      status: rand() > 0.2 ? "SETTLED" : "CONFIRMED",
      fee: pick(times.fee),
      arrival,
    });
  }

  // Today: one of each live arrival state for the board.
  const at = (mins: number) => new Date(Math.round((now.getTime() + mins * MIN) / (5 * MIN)) * 5 * MIN);
  await book({ artist: artists[0], venue: venues[0], status: "CONFIRMED", fee: 1800, arriveAt: at(-90), arrival: { offsetMin: -12, onSite: true } });
  await book({ artist: artists[1], venue: venues[1], status: "CONFIRMED", fee: 2200, arriveAt: at(-60), arrival: { offsetMin: 22, onSite: true } });
  await book({ artist: artists[2], venue: venues[5], status: "CONFIRMED", fee: 1500, arriveAt: at(-25) });
  await book({
    artist: artists[3],
    venue: venues[2],
    status: "CONFIRMED",
    fee: 3000,
    arriveAt: at(50),
    onTheWay: { at: new Date(now.getTime() - 15 * MIN), eta: 45 },
  });
  await book({ artist: artists[4], venue: venues[4], status: "CONFIRMED", fee: 900, arriveAt: at(240) });

  // Next three months.
  for (let i = 0; i < 28; i++) {
    await book({
      artist: artists[i % artists.length],
      venue: pick(venues),
      date: addDaysToKey(todayKey, 2 + Math.floor(rand() * 90)),
      arrive: pick(times.arrive),
      set: pick(times.set),
      status: pick(["HOLD", "HOLD", "PENDING", "CONFIRMED", "CONFIRMED", "CONFIRMED", "ENQUIRY"]),
      fee: pick(times.fee),
    });
  }
  // A gig tomorrow so the artist app has something to show, and one cancelled show.
  await book({ artist: artists[0], venue: venues[1], date: addDaysToKey(todayKey, 1), arrive: "17:00", set: "20:30", status: "CONFIRMED", fee: 2000 });
  await book({ artist: artists[2], venue: venues[7], date: addDaysToKey(todayKey, 20), arrive: "22:00", set: "23:59", status: "CANCELLED", fee: 2500 });

  return { artists, venues: venues.length, bookings: await prisma.booking.count({ where: { agencyId, demo: true } }) };
}

/** Remove every demo record, plus anything hanging off the demo artists. Real data is left alone. */
export async function removeDemoData(prisma: PrismaClient, agencyId: string) {
  const artistIds = (await prisma.artist.findMany({ where: { agencyId, demo: true }, select: { id: true } })).map((a) => a.id);
  const bookingIds = (await prisma.booking.findMany({ where: { agencyId, OR: [{ demo: true }, { artistId: { in: artistIds } }] }, select: { id: true } })).map(
    (b) => b.id,
  );
  const contactIds = (await prisma.contact.findMany({ where: { agencyId, demo: true }, select: { id: true } })).map((c) => c.id);
  const venueIds = (await prisma.venue.findMany({ where: { agencyId, demo: true }, select: { id: true } })).map((v) => v.id);
  const personIds = (await prisma.person.findMany({ where: { agencyId, demo: true }, select: { id: true } })).map((p) => p.id);

  await prisma.$transaction([
    // Payments and check-ins go with their bookings.
    prisma.booking.deleteMany({ where: { id: { in: bookingIds } } }),
    // Demo agents, and any app logins made for demo artists.
    prisma.user.deleteMany({ where: { agencyId, OR: [{ demo: true }, { artistId: { in: artistIds } }, { personId: { in: personIds } }] } }),
    prisma.person.deleteMany({ where: { id: { in: personIds } } }),
    prisma.artist.deleteMany({ where: { id: { in: artistIds } } }),
    prisma.contact.deleteMany({ where: { id: { in: contactIds } } }),
    prisma.venue.deleteMany({ where: { id: { in: venueIds } } }),
    prisma.activity.deleteMany({
      where: {
        OR: [
          { entity: "BOOKING", entityId: { in: bookingIds } },
          { entity: "ARTIST", entityId: { in: artistIds } },
          { entity: "CONTACT", entityId: { in: contactIds } },
          { entity: "VENUE", entityId: { in: venueIds } },
          { entity: "PERSON", entityId: { in: personIds } },
        ],
      },
    }),
  ]);
  return { bookings: bookingIds.length, artists: artistIds.length };
}
