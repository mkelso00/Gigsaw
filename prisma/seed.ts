// Demo data so Gigsaw has something to show on first run.
// Run with: npm run db:seed (it clears existing data first).

import { PrismaClient, type Artist, type Contact, type Venue } from "@prisma/client";
import bcrypt from "bcryptjs";
import { distanceMetres } from "../src/lib/arrival";
import { addDaysToKey, localDateKey, zonedToUtc } from "../src/lib/time";

const prisma = new PrismaClient();

// Small seeded random generator so the demo looks the same each time.
let seed = 42;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

const MIN = 60_000;

async function main() {
  await prisma.$transaction([
    prisma.activity.deleteMany(),
    prisma.checkIn.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.contactNote.deleteMany(),
    prisma.contact.deleteMany(),
    prisma.venue.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
    prisma.artist.deleteMany(),
    prisma.settings.deleteMany(),
  ]);

  await prisma.settings.create({
    data: {
      id: 1,
      agencyName: "Northern Lights Agency",
      agencyEmail: "bookings@northernlights.example",
      agencyAddress: "12 Example Street\nManchester M1 1AA",
      defaultTimezone: "Europe/London",
      defaultCurrency: "GBP",
      defaultCommission: 15,
      lateGraceMinutes: 5,
      geofenceMetres: 500,
      contractTerms:
        "1. The Promoter will provide the hospitality and technical requirements in the Artist's rider.\n2. Cancellation by the Promoter within 30 days of the engagement means the full fee is payable.\n3. The balance is payable in cleared funds no later than the night of the performance.",
    },
  });

  const hash = await bcrypt.hash("gigsaw123", 10);
  const admin = await prisma.user.create({ data: { email: "admin@gigsaw.test", name: "Alex Morgan", role: "ADMIN", passwordHash: hash } });
  const agent = await prisma.user.create({ data: { email: "agent@gigsaw.test", name: "Sam Patel", role: "AGENT", passwordHash: hash } });

  const artistSeed = [
    { name: "Maya Okafor Trio", genre: "Jazz", colour: "#7c3aed", agentId: admin.id },
    { name: "The Velvet Owls", genre: "Indie rock", colour: "#0ea5e9", agentId: agent.id },
    { name: "DJ Kestrel", genre: "House", colour: "#f97316", agentId: agent.id, defaultCommission: 12 },
    { name: "Brass Tacks Collective", genre: "Brass / funk", colour: "#16a34a", agentId: admin.id },
    { name: "Elena Ruiz", genre: "Singer-songwriter", colour: "#e11d48", agentId: admin.id },
  ];
  const artists: Artist[] = [];
  for (const a of artistSeed) {
    const slug = a.name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
    artists.push(await prisma.artist.create({ data: { ...a, email: `${slug}@example.com` } }));
  }
  // Maya can sign in to the artist app.
  await prisma.user.create({ data: { email: "maya@gigsaw.test", name: "Maya Okafor", role: "ARTIST", artistId: artists[0].id, passwordHash: hash } });

  const venueSeed = [
    { name: "Jazz Cafe", city: "London", country: "UK", latitude: 51.5392, longitude: -0.1426, capacity: 440, address: "5 Parkway, Camden" },
    { name: "Band on the Wall", city: "Manchester", country: "UK", latitude: 53.4851, longitude: -2.2353, capacity: 500, address: "25 Swan Street" },
    { name: "Thekla", city: "Bristol", country: "UK", latitude: 51.4493, longitude: -2.5927, capacity: 400, address: "The Grove, East Mud Dock" },
    { name: "King Tut's Wah Wah Hut", city: "Glasgow", country: "UK", latitude: 55.8622, longitude: -4.2654, capacity: 300, address: "272a St Vincent Street" },
    { name: "Brudenell Social Club", city: "Leeds", country: "UK", latitude: 53.8146, longitude: -1.5737, capacity: 400, address: "33 Queens Road" },
    { name: "Concorde 2", city: "Brighton", country: "UK", latitude: 50.8167, longitude: -0.1197, capacity: 600, address: "Madeira Drive" },
    { name: "Whelan's", city: "Dublin", country: "Ireland", latitude: 53.3361, longitude: -6.2655, capacity: 450, address: "25 Wexford Street", timezone: "Europe/Dublin" },
    { name: "Paradiso", city: "Amsterdam", country: "Netherlands", latitude: 52.3622, longitude: 4.8838, capacity: 1500, address: "Weteringschans 6-8", timezone: "Europe/Amsterdam" },
    { name: "The Village Hall", city: "Hebden Bridge", country: "UK", latitude: null, longitude: null, capacity: 120, address: "Market Street" },
  ];
  const venues: Venue[] = [];
  for (const v of venueSeed) venues.push(await prisma.venue.create({ data: { timezone: "Europe/London", ...v } }));

  const promoterSeed = [
    { name: "Priya Shah", company: "Lantern Live", tags: "uk, jazz", email: "priya@lantern.example", phone: "07700 900111" },
    { name: "Tom Fletcher", company: "Fletcher Promotions", tags: "uk, rock", email: "tom@fletcher.example", phone: "07700 900222" },
    { name: "Aoife Byrne", company: "Liffey Sounds", tags: "ireland", email: "aoife@liffey.example", phone: "+353 1 555 0100" },
    { name: "Jasper de Vries", company: "Canal Concerts", tags: "europe, festival", email: "jasper@canal.example", phone: "+31 20 555 0199" },
    { name: "Hannah Brooks", company: "Private client", tags: "private, wedding", email: "hannah@example.com", phone: "07700 900333" },
  ];
  const promoters: Contact[] = [];
  for (const p of promoterSeed) {
    promoters.push(await prisma.contact.create({ data: { ...p, type: p.company === "Private client" ? "CLIENT" : "PROMOTER", address: "1 Example Road\nExample Town" } }));
  }
  await prisma.contact.create({ data: { type: "COLLABORATOR", name: "Chris Lowe", company: "Lowe Sound Hire", tags: "production", phone: "07700 900444" } });
  await prisma.contactNote.create({ data: { contactId: promoters[0].id, authorId: admin.id, body: "Keen on a second Maya date in the spring. Prefers contracts by email." } });

  const now = new Date();
  const tzOf = (v: Venue) => v.timezone;
  let refN = 0;
  const nextRef = () => `GS-${String(++refN).padStart(4, "0")}`;

  async function book(opts: {
    artist: Artist;
    venue: Venue;
    date: string;
    arrive: string;
    sound?: string;
    set: string;
    end?: string;
    status: string;
    fee: number;
    promoter?: Contact;
    arrival?: { offsetMin: number; onSite: boolean; byAgent?: boolean } | "none";
    onTheWay?: { at: Date; eta: number };
    arriveByOverride?: Date;
  }) {
    const tz = tzOf(opts.venue);
    const arriveBy = opts.arriveByOverride ?? zonedToUtc(opts.date, opts.arrive, tz);
    const d = localDateKey(arriveBy, tz);
    const setStart = new Date(arriveBy.getTime() + (opts.arriveByOverride ? 180 * MIN : zonedToUtc(d, opts.set, tz).getTime() - arriveBy.getTime()));
    const setEnd = new Date(setStart.getTime() + 90 * MIN);
    const soundcheckAt = new Date(arriveBy.getTime() + 60 * MIN);
    const promoter = opts.promoter ?? pick(promoters);
    const commissionPct = opts.artist.defaultCommission ?? 15;
    const b = await prisma.booking.create({
      data: {
        reference: nextRef(),
        artistId: opts.artist.id,
        venueId: opts.venue.id,
        promoterId: promoter.id,
        agentId: opts.artist.agentId,
        createdById: opts.artist.agentId,
        status: opts.status,
        timezone: tz,
        arriveBy,
        soundcheckAt,
        setStart,
        setEnd,
        currency: tz === "Europe/London" ? "GBP" : "EUR",
        feeMinor: opts.fee * 100,
        commissionPct,
        depositMinor: Math.round(opts.fee * 0.5) * 100,
        depositDueDate: new Date(arriveBy.getTime() - 30 * 86_400_000),
        travel: "Train from home station. Tickets in the shared folder.",
        accommodation: rand() > 0.5 ? "Premier Inn, 5 minutes' walk. Booked under the artist's name." : "",
        dayContact: `${promoter.name} · ${promoter.phone}`,
        hospitality: "Rider: hot meal for the band, 12 bottles of water, 1 bottle of red.",
        tags: rand() > 0.7 ? "festival" : "",
      },
    });

    // Money for confirmed / settled shows in the past.
    if ((opts.status === "SETTLED" || opts.status === "CONFIRMED") && arriveBy < now) {
      await prisma.payment.create({ data: { bookingId: b.id, direction: "IN", kind: "DEPOSIT", amountMinor: b.depositMinor, paidAt: new Date(arriveBy.getTime() - 40 * 86_400_000) } });
      if (opts.status === "SETTLED") {
        await prisma.payment.create({ data: { bookingId: b.id, direction: "IN", kind: "BALANCE", amountMinor: b.feeMinor - b.depositMinor, paidAt: arriveBy } });
        const artistShare = b.feeMinor - Math.round((b.feeMinor * commissionPct) / 100);
        await prisma.payment.create({ data: { bookingId: b.id, direction: "OUT", kind: "SETTLEMENT", amountMinor: artistShare, paidAt: new Date(arriveBy.getTime() + 7 * 86_400_000) } });
      }
    } else if (opts.status === "CONFIRMED" && rand() > 0.4) {
      await prisma.payment.create({ data: { bookingId: b.id, direction: "IN", kind: "DEPOSIT", amountMinor: b.depositMinor, paidAt: new Date(Math.min(now.getTime(), arriveBy.getTime() - 35 * 86_400_000)) } });
    }

    if (opts.onTheWay) {
      await prisma.checkIn.create({
        data: { bookingId: b.id, artistId: opts.artist.id, kind: "ON_THE_WAY", source: "APP", at: opts.onTheWay.at, etaMinutes: opts.onTheWay.eta },
      });
    }
    if (opts.arrival && opts.arrival !== "none") {
      const at = new Date(arriveBy.getTime() + opts.arrival.offsetMin * MIN);
      if (at <= now) {
        const v = opts.venue;
        // Place the phone either at the venue or a couple of km away.
        const lat = v.latitude !== null ? v.latitude + (opts.arrival.onSite ? 0.0008 : 0.02) : null;
        const lng = v.longitude !== null ? v.longitude + (opts.arrival.onSite ? 0.0005 : 0.01) : null;
        const byAgent = opts.arrival.byAgent ?? false;
        await prisma.checkIn.create({
          data: {
            bookingId: b.id,
            artistId: opts.artist.id,
            kind: "ARRIVED",
            source: byAgent ? "AGENT" : "APP",
            userId: byAgent ? opts.artist.agentId : null,
            at,
            latitude: byAgent ? null : lat,
            longitude: byAgent ? null : lng,
            accuracyM: byAgent ? null : 12,
            distanceM: !byAgent && lat !== null && lng !== null && v.latitude !== null && v.longitude !== null ? distanceMetres(lat, lng, v.latitude, v.longitude) : null,
            note: byAgent ? "Promoter rang to confirm" : "",
          },
        });
        if (setEnd < now) {
          await prisma.checkIn.create({ data: { bookingId: b.id, artistId: opts.artist.id, kind: "DEPARTED", source: "APP", at: new Date(setEnd.getTime() + 45 * MIN) } });
        }
      }
    }
    return b;
  }

  const todayKey = localDateKey(now, "Europe/London");

  // Past six months: mostly on time, some late, a few with no check-in.
  for (let i = 0; i < 45; i++) {
    const artist = artists[i % artists.length];
    const daysAgo = 3 + Math.floor(rand() * 180);
    const r = rand();
    // Each artist has a different timekeeping habit.
    const lateBias = [0.05, 0.25, 0.4, 0.1, 0.15][artists.indexOf(artist)];
    const arrival =
      r < 0.08 ? ("none" as const) : { offsetMin: r < 0.08 + lateBias ? 8 + Math.floor(rand() * 40) : -Math.floor(rand() * 45), onSite: rand() > 0.1, byAgent: rand() > 0.9 };
    await book({
      artist,
      venue: pick(venues),
      date: addDaysToKey(todayKey, -daysAgo),
      arrive: pick(["16:00", "17:00", "17:30", "18:00"]),
      set: pick(["20:00", "20:30", "21:00"]),
      status: rand() > 0.2 ? "SETTLED" : "CONFIRMED",
      fee: pick([800, 1200, 1500, 2000, 2500, 3500]),
      arrival,
    });
  }

  // Today: a spread of live arrival states for the board.
  const round5 = (d: Date) => new Date(Math.round(d.getTime() / (5 * MIN)) * 5 * MIN);
  await book({ artist: artists[0], venue: venues[0], date: todayKey, arrive: "", set: "", status: "CONFIRMED", fee: 1800, arriveByOverride: round5(new Date(now.getTime() - 90 * MIN)), arrival: { offsetMin: -12, onSite: true } });
  await book({ artist: artists[1], venue: venues[1], date: todayKey, arrive: "", set: "", status: "CONFIRMED", fee: 2200, arriveByOverride: round5(new Date(now.getTime() - 60 * MIN)), arrival: { offsetMin: 22, onSite: true } });
  await book({ artist: artists[2], venue: venues[5], date: todayKey, arrive: "", set: "", status: "CONFIRMED", fee: 1500, arriveByOverride: round5(new Date(now.getTime() - 25 * MIN)) });
  await book({ artist: artists[3], venue: venues[2], date: todayKey, arrive: "", set: "", status: "CONFIRMED", fee: 3000, arriveByOverride: round5(new Date(now.getTime() + 50 * MIN)), onTheWay: { at: new Date(now.getTime() - 15 * MIN), eta: 45 } });
  await book({ artist: artists[4], venue: venues[4], date: todayKey, arrive: "", set: "", status: "CONFIRMED", fee: 900, arriveByOverride: round5(new Date(now.getTime() + 4 * 60 * MIN)) });

  // Upcoming three months.
  for (let i = 0; i < 28; i++) {
    const artist = artists[i % artists.length];
    const daysAhead = 2 + Math.floor(rand() * 90);
    const status = pick(["HOLD", "HOLD", "PENDING", "CONFIRMED", "CONFIRMED", "CONFIRMED", "ENQUIRY"]);
    await book({
      artist,
      venue: pick(venues),
      date: addDaysToKey(todayKey, daysAhead),
      arrive: pick(["16:00", "17:00", "17:30", "18:00"]),
      set: pick(["20:00", "20:30", "21:00"]),
      status,
      fee: pick([800, 1200, 1500, 2000, 2500, 3500]),
    });
  }
  // Maya's next gig is tomorrow so the artist app has something to show.
  await book({ artist: artists[0], venue: venues[1], date: addDaysToKey(todayKey, 1), arrive: "17:00", set: "20:30", status: "CONFIRMED", fee: 2000 });
  // One cancelled show.
  await book({ artist: artists[2], venue: venues[7], date: addDaysToKey(todayKey, 20), arrive: "22:00", set: "23:59", status: "CANCELLED", fee: 2500 });

  await prisma.activity.create({ data: { userId: admin.id, entity: "SETTINGS", entityId: "1", action: "set up Gigsaw with demo data" } });

  const count = await prisma.booking.count();
  console.log(`Seeded ${artists.length} artists, ${venues.length} venues, ${count} bookings.`);
  console.log("Sign in with admin@gigsaw.test, agent@gigsaw.test or maya@gigsaw.test (artist app). Password: gigsaw123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
