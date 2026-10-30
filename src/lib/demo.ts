// Sample agency data, shaped like a busy bar-circuit agency: solo singers, duos, a DJ, a party
// band with its own members and a band built from two solo acts; venues with weekly music
// schedules (sale and cost), managers and the pub companies that pay; six weeks of gigs played
// (with check-ins and payments), live arrivals today, the next fortnight mostly confirmed with
// offers out (one declined) and some gigs still needing an act, and two weddings, a birthday
// party and a staff party.
// Used by the "Load demo data" button in Settings and by the local seed script.
// Every record is flagged `demo: true` so removeDemoData can take it all out again, and demo
// data is never billed or messaged.

import { randomBytes } from "node:crypto";
import type { Artist, Contact, Prisma, PrismaClient, Venue, VenueSlot } from "@prisma/client";
import type { prisma as appPrisma } from "./db";

/** Works with the app's client (which hides archived bookings) or a plain one (the seed script). */
type Db = PrismaClient | typeof appPrisma;
import bcrypt from "bcryptjs";
import { distanceMetres } from "./arrival";
import { defaultTasks } from "./event-plan";
import { VENUE_PALETTE, dateInWeek, weekStartOf, weekdayOf } from "./rota";
import { buildSchedule } from "./schedule";
import { addDaysToKey, localDateKey } from "./time";

const MIN = 60_000;
const DAY = 86_400_000;
const TZ = "Europe/London";

export async function hasDemoData(prisma: Db, agencyId: string) {
  return (await prisma.artist.count({ where: { agencyId, demo: true } })) > 0;
}

/**
 * Add the sample data. `leadAgentId` looks after most acts. If `secondAgentId` is not given, a
 * demo agent who cannot sign in is created to look after the rest.
 */
export async function addDemoData(prisma: Db, opts: { agencyId: string; leadAgentId: string; secondAgentId?: string }) {
  const agencyId = opts.agencyId;
  // Seeded random numbers so the demo looks the same each time.
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

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

  // ---------- Acts ----------
  const act = (name: string, genre: string, colour: string, phone: string, agentId = lead, extra: Partial<Prisma.ArtistUncheckedCreateInput> = {}) =>
    prisma.artist.create({
      data: {
        agencyId,
        name,
        genre,
        colour,
        phone,
        email: `${name
          .toLowerCase()
          .replace(/[^a-z]+/g, ".")
          .replace(/^\.|\.$/g, "")}@example.com`,
        agentId,
        demo: true,
        ...extra,
      },
    });
  const graham = await act("Graham McKee", "Acoustic covers", "#0d9488", "07700 900206");
  const jo = await act("Jo Drummond", "Acoustic covers", "#ca8a04", "07700 900207");
  const ellie = await act("Ellie Rose", "Pop and soul", "#db2777", "07700 900208");
  const sean = await act("Sean Reaves", "Indie acoustic", "#2563eb", "07700 900209", second);
  const diarmuid = await act("Diarmuid Byrne", "Irish and folk", "#16a34a", "07700 900210", second);
  const finn = await act("Finn Carter", "Acoustic covers", "#ea580c", "07700 900211");
  const jade = await act("Jade Duncan", "Soul and Motown", "#7c3aed", "07700 900212", second);
  const rogues = await act("The Rogues Duo", "Acoustic duo", "#0891b2", "07700 900213");
  const sunset = await act("Sunset Sessions Duo", "Chilled acoustic duo", "#c2410c", "07700 900214", second);
  const kestrel = await act("DJ Kestrel", "House and party", "#f97316", "07700 900215", second, { defaultCommission: 12 });
  const partyBand = await act("The Ultimate Party Band", "Party band", "#9333ea", "07700 900216");
  const wonderlust = await act("Wonderlust", "Party band", "#4f46e5", "07700 900217");
  // Wonderlust is built from two solo acts: each sees the band's gigs, and clashes are checked
  // between the band and their solo gigs.
  await prisma.actLink.createMany({
    data: [
      { parentId: wonderlust.id, childId: graham.id, role: "Lead vocals, guitar" },
      { parentId: wonderlust.id, childId: jo.id, role: "Vocals, drums" },
    ],
  });
  const artists: Artist[] = [graham, jo, ellie, sean, diarmuid, finn, jade, rogues, sunset, kestrel, partyBand, wonderlust];
  const solos = [graham, jo, ellie, sean, diarmuid, finn, jade];
  const duos = [rogues, sunset];

  // ---------- Who pays: pub companies, and private customers ----------
  const company = (name: string, contact: string, email: string, phone: string, tags = "") =>
    prisma.contact.create({
      data: { agencyId, type: "COMPANY", name: contact, company: name, email, phone, tags, address: "1 Example Road\nBristol BS1 1AA", demo: true },
    });
  const crownCo = await company("Harbourside Inns", "Rachel Green", "accounts@harbourside.example", "0117 496 0001", "pub group");
  const bonniesCo = await company("Bonnies Bars Ltd", "Michael Shaw", "invoices@bonnies.example", "0121 496 0002", "pub group");
  const bathCo = await company("Old Bank Taverns", "Hannah Lee", "hello@oldbank.example", "01225 496003");
  const bridgeCo = await company("Bridge Inns Cardiff", "Owen Davies", "owen@bridgeinns.example", "029 2049 6004");
  const lanternCo = await company("Lantern Group", "Priya Shah", "priya@lantern.example", "0161 496 0005", "nightlife");
  await prisma.contactNote.create({
    data: { contactId: bonniesCo.id, authorId: lead, body: "Pays monthly on invoice. Wants the party band every other Saturday from November." },
  });
  const client = (name: string, email: string, phone: string, tags: string) =>
    prisma.contact.create({ data: { agencyId, type: "CLIENT", name, company: "Private client", email, phone, tags, demo: true } });
  const hannah = await client("Hannah Brooks", "hannah@example.com", "07700 900333", "wedding");
  const priyaDev = await client("Priya Mistry", "priya.mistry@example.com", "07700 900334", "wedding");
  const sophie = await client("Sophie Turner", "sophie@example.com", "07700 900335", "party");
  await prisma.contact.create({
    data: { agencyId, type: "COLLABORATOR", name: "Chris Lowe", company: "Lowe Sound Hire", tags: "PA hire", phone: "07700 900444", demo: true },
  });

  // ---------- Venues, their managers and who pays for them ----------
  const venueSeed: {
    name: string;
    city: string;
    address: string;
    lat: number | null;
    lng: number | null;
    capacity: number;
    payer: Contact;
    manager?: [string, string, string];
  }[] = [
    {
      name: "The Crown",
      city: "Bristol",
      address: "12 Corn Street",
      lat: 51.4545,
      lng: -2.5928,
      capacity: 180,
      payer: crownCo,
      manager: ["Sam", "Whitaker", "General manager"],
    },
    {
      name: "The Swan",
      city: "Bristol",
      address: "4 Park Street",
      lat: 51.4553,
      lng: -2.6031,
      capacity: 140,
      payer: crownCo,
      manager: ["Rosie", "Adams", "Bar manager"],
    },
    {
      name: "Bonnies",
      city: "Birmingham",
      address: "88 Broad Street",
      lat: 52.4776,
      lng: -1.9112,
      capacity: 400,
      payer: bonniesCo,
      manager: ["Callum", "Reid", "Venue manager"],
    },
    {
      name: "The Old Bank",
      city: "Bath",
      address: "1 Milsom Street",
      lat: 51.3846,
      lng: -2.3612,
      capacity: 220,
      payer: bathCo,
      manager: ["Amy", "Fox", "Manager"],
    },
    { name: "The Bridge Inn", city: "Cardiff", address: "20 Mill Lane", lat: 51.4766, lng: -3.1762, capacity: 260, payer: bridgeCo },
    {
      name: "The Lantern",
      city: "Manchester",
      address: "5 Peter Street",
      lat: 53.4778,
      lng: -2.2475,
      capacity: 500,
      payer: lanternCo,
      manager: ["Dan", "Howe", "Events manager"],
    },
    { name: "Hollins Hall", city: "Harrogate", address: "Hollins Lane", lat: 53.9921, lng: -1.5418, capacity: 200, payer: hannah },
    { name: "The Village Hall", city: "Hebden Bridge", address: "Market Street", lat: null, lng: null, capacity: 120, payer: sophie },
  ];
  const venues: Venue[] = [];
  const payerOf = new Map<string, Contact>();
  for (const [i, v] of venueSeed.entries()) {
    const venue = await prisma.venue.create({
      data: {
        agencyId,
        demo: true,
        name: v.name,
        city: v.city,
        country: "UK",
        address: v.address,
        latitude: v.lat,
        longitude: v.lng,
        capacity: v.capacity,
        timezone: TZ,
        colour: VENUE_PALETTE[i % VENUE_PALETTE.length],
      },
    });
    venues.push(venue);
    payerOf.set(venue.id, v.payer);
    if (v.manager) {
      const [first, last, title] = v.manager;
      await prisma.person.create({
        data: {
          agencyId,
          demo: true,
          firstName: first,
          surname: last,
          jobTitle: title,
          venueId: venue.id,
          phone: `07700 9003${String(10 + i).padStart(2, "0")}`,
          email: `${first.toLowerCase()}@${v.name.toLowerCase().replace(/[^a-z]+/g, "")}.example`,
        },
      });
    }
  }
  const [crown, swan, bonnies, oldBank, bridge, lantern, hollins, villageHall] = venues;
  // People at the pub companies (Overture-style: a person works at a company).
  await prisma.person.create({
    data: {
      agencyId,
      demo: true,
      firstName: "Rachel",
      surname: "Green",
      jobTitle: "Area manager",
      companyId: crownCo.id,
      phone: "07700 900401",
      email: "rachel@harbourside.example",
    },
  });
  await prisma.person.create({
    data: {
      agencyId,
      demo: true,
      firstName: "Michael",
      surname: "Shaw",
      jobTitle: "Operations director",
      companyId: bonniesCo.id,
      phone: "07700 900402",
      email: "michael@bonnies.example",
    },
  });

  // ---------- People in acts ----------
  const person = (firstName: string, surname: string, extra: Partial<Prisma.PersonUncheckedCreateInput> = {}) =>
    prisma.person.create({ data: { agencyId, firstName, surname, demo: true, ...extra } });
  const grahamP = await person("Graham", "McKee", { phone: "07700 900501", email: "graham.mckee@example.com", pronouns: "he/him" });
  const joP = await person("Jo", "Drummond", { phone: "07700 900502", email: "jo.drummond@example.com", pronouns: "she/her" });
  const michaelP = await person("Michael", "White", { phone: "07700 900503", email: "michael.white@example.com" });
  const kerryP = await person("Kerry", "Lane", { phone: "07700 900504", alias: "Kez" });
  const devP = await person("Dev", "Sharma", { phone: "07700 900505" });
  await prisma.personAct.createMany({
    data: [
      { personId: grahamP.id, artistId: graham.id, jobTitle: "Vocals, guitar" },
      { personId: joP.id, artistId: jo.id, jobTitle: "Vocals" },
      { personId: michaelP.id, artistId: partyBand.id, jobTitle: "Lead vocals (main contact)" },
      { personId: kerryP.id, artistId: partyBand.id, jobTitle: "Bass" },
      { personId: devP.id, artistId: partyBand.id, jobTitle: "Drums" },
      // Dev also plays in a duo, so the duo's gigs are checked against the party band's.
      { personId: devP.id, artistId: rogues.id, jobTitle: "Guitar" },
    ],
  });

  // ---------- Weekly music schedules (the bulk of the work) ----------
  // [venue, weekdays, label, arrive, start, end, sale, cost, regular act]
  const slotSeed: [Venue, number[], string, string, string, string, number, number, Artist | null][] = [
    [crown, [1, 2, 3, 4], "Solo", "18:30", "19:00", "21:00", 180, 130, graham],
    [crown, [5], "Solo", "18:30", "19:00", "21:00", 200, 140, graham],
    [crown, [6], "Duo", "20:00", "20:30", "23:00", 320, 240, rogues],
    [swan, [3, 5], "Solo", "19:30", "20:00", "22:00", 180, 130, ellie],
    [swan, [6], "Solo", "15:30", "16:00", "18:00", 160, 120, null],
    [swan, [7], "Solo", "16:30", "17:00", "19:00", 160, 120, diarmuid],
    [bonnies, [4], "Solo", "18:30", "19:00", "21:00", 200, 140, sean],
    [bonnies, [5], "Solo", "16:30", "17:00", "19:00", 200, 140, jade],
    [bonnies, [5], "Duo", "18:30", "19:00", "22:00", 340, 250, sunset],
    [bonnies, [5], "Band", "21:30", "22:00", "01:00", 950, 750, wonderlust],
    [bonnies, [6], "Solo", "18:30", "19:00", "21:00", 200, 140, null],
    [bonnies, [6], "Band", "21:00", "21:30", "00:30", 1100, 850, partyBand],
    [oldBank, [5, 6], "Duo", "19:30", "20:00", "23:00", 340, 250, null],
    [bridge, [6], "Band", "20:30", "21:00", "00:00", 900, 700, partyBand],
    [lantern, [5, 6], "DJ", "21:30", "22:00", "02:00", 380, 280, kestrel],
  ];
  const slots: (VenueSlot & { venue: Venue })[] = [];
  for (const [venue, days, label, arrive, start, end, sale, cost, regular] of slotSeed) {
    for (const weekday of days) {
      const s = await prisma.venueSlot.create({
        data: {
          agencyId,
          venueId: venue.id,
          weekday,
          label,
          arriveTime: arrive,
          startTime: start,
          endTime: end,
          feeMinor: sale * 100,
          costMinor: cost * 100,
          currency: "GBP",
          eventType: label === "DJ" ? "CLUB_NIGHT" : "GIG",
          bookingStatus: "CONFIRMED",
          promoterId: payerOf.get(venue.id)!.id,
          artistId: regular?.id ?? null,
        },
      });
      slots.push({ ...s, venue });
    }
  }

  // ---------- Gigs ----------
  // Carry on numbering after any real bookings.
  // Archived bookings keep their numbers too, so count them (raw SQL: the client hides archived ones).
  const [top] = await prisma.$queryRaw<{ n: number | null }[]>`
    SELECT MAX(NULLIF(regexp_replace(reference, '[^0-9]', '', 'g'), '')::bigint)::int AS n FROM "Booking" WHERE "agencyId" = ${agencyId}`;
  let refN = top?.n ?? 0;
  const nextRef = () => `GS-${String(++refN).padStart(4, "0")}`;
  const now = new Date();
  const todayKey = localDateKey(now, TZ);

  type Arrival = { offsetMin: number; onSite?: boolean; byAgent?: boolean } | "none" | null;
  async function gig(o: {
    venue: Venue | null;
    date?: string;
    arrive?: string;
    start?: string;
    end?: string;
    /** Or exact times, for today's live arrivals. */
    arriveAt?: Date;
    act: Artist | null;
    status: string;
    sale: number;
    cost: number | null;
    /** Booking fee on top, all the agency's (once per wedding). */
    bookingFee?: number;
    promoter?: Contact | null;
    eventType?: string;
    slotId?: string;
    eventId?: string;
    eventName?: string;
    offer?: "open" | "declined";
    arrival?: Arrival;
    onTheWay?: { at: Date; eta: number };
    paid?: { in?: number; out?: number; deposit?: number };
    customerTold?: boolean;
    vatPct?: number;
  }) {
    const tz = TZ;
    const sched = o.arriveAt
      ? { arriveBy: o.arriveAt, soundcheckAt: null, setStart: new Date(o.arriveAt.getTime() + 30 * MIN), setEnd: new Date(o.arriveAt.getTime() + 150 * MIN) }
      : buildSchedule(o.date!, { arrive: o.arrive!, setStart: o.start!, setEnd: o.end ?? null }, tz);
    const checkIns: Prisma.CheckInCreateWithoutBookingInput[] = [];
    if (o.act && o.onTheWay)
      checkIns.push({ artist: { connect: { id: o.act.id } }, kind: "ON_THE_WAY", source: "APP", at: o.onTheWay.at, etaMinutes: o.onTheWay.eta });
    if (o.act && o.arrival && o.arrival !== "none") {
      const at = new Date(sched.arriveBy.getTime() + o.arrival.offsetMin * MIN);
      if (at <= now) {
        const v = o.venue;
        const onSite = o.arrival.onSite ?? true;
        const lat = v?.latitude != null ? v.latitude + (onSite ? 0.0008 : 0.02) : null;
        const lng = v?.longitude != null ? v.longitude + (onSite ? 0.0005 : 0.01) : null;
        const byAgent = o.arrival.byAgent ?? false;
        checkIns.push({
          artist: { connect: { id: o.act.id } },
          kind: "ARRIVED",
          source: byAgent ? "AGENT" : "APP",
          ...(byAgent ? { user: { connect: { id: lead } }, note: "Venue rang to confirm" } : {}),
          at,
          latitude: byAgent ? null : lat,
          longitude: byAgent ? null : lng,
          accuracyM: byAgent ? null : 12,
          distanceM:
            !byAgent && lat !== null && lng !== null && v?.latitude != null && v.longitude != null ? distanceMetres(lat, lng, v.latitude, v.longitude) : null,
        });
        if (sched.setEnd && sched.setEnd < now) {
          checkIns.push({ artist: { connect: { id: o.act.id } }, kind: "DEPARTED", source: "APP", at: new Date(sched.setEnd.getTime() + 30 * MIN) });
        }
      }
    }
    const payments: Prisma.PaymentCreateWithoutBookingInput[] = [];
    if (o.paid?.deposit)
      payments.push({
        direction: "IN",
        kind: "DEPOSIT",
        amountMinor: o.paid.deposit * 100,
        paidAt: new Date(Math.min(now.getTime(), sched.arriveBy.getTime() - 30 * DAY)),
      });
    if (o.paid?.in)
      payments.push({
        direction: "IN",
        kind: "BALANCE",
        amountMinor: o.paid.in,
        paidAt: new Date(Math.min(now.getTime(), sched.arriveBy.getTime() + 10 * DAY)),
      });
    if (o.paid?.out)
      payments.push({
        direction: "OUT",
        kind: "SETTLEMENT",
        amountMinor: o.paid.out,
        paidAt: new Date(Math.min(now.getTime(), sched.arriveBy.getTime() + 7 * DAY)),
      });
    const promoter = o.promoter === undefined ? (o.venue ? (payerOf.get(o.venue.id) ?? null) : null) : o.promoter;
    return prisma.booking.create({
      data: {
        reference: nextRef(),
        agencyId,
        demo: true,
        artistId: o.act?.id ?? null,
        venueId: o.venue?.id ?? null,
        promoterId: promoter?.id ?? null,
        agentId: o.act?.agentId ?? lead,
        createdById: lead,
        status: o.status,
        eventType: o.eventType ?? "GIG",
        eventName: o.eventName ?? "",
        eventId: o.eventId ?? null,
        slotId: o.slotId ?? null,
        timezone: tz,
        ...sched,
        currency: "GBP",
        feeMinor: o.sale * 100,
        vatPct: o.vatPct ?? 0,
        bookingFeeMinor: (o.bookingFee ?? 0) * 100,
        dealType: "BUY_SELL",
        artistFeeMinor: o.cost != null ? o.cost * 100 : null,
        dayContact: o.venue ? `${o.venue.name}: ask for the manager on duty` : "",
        hospitality: "Two drinks each from the bar, and a meal if you're on for 3 hours or more.",
        notifyClientOnArrival: false,
        ...(o.offer
          ? {
              offerToken: randomBytes(18).toString("base64url"),
              offeredAt: new Date(now.getTime() - (o.offer === "declined" ? 26 : 5) * 3_600_000),
              ...(o.offer === "declined" ? { offerResponse: "DECLINED", respondedAt: new Date(now.getTime() - 2 * 3_600_000) } : {}),
            }
          : {}),
        ...(o.customerTold ? { customerToldAt: new Date(now.getTime() - 3 * DAY) } : {}),
        checkIns: { create: checkIns },
        payments: { create: payments },
      },
    });
  }

  // An act for a slot on a date: the regular, or someone suitable for that kind of slot.
  const actFor = (s: VenueSlot) => {
    const regular = artists.find((a) => a.id === s.artistId);
    if (regular && rand() > 0.15) return regular;
    return s.label === "Duo" ? pick(duos) : s.label === "Band" ? pick([partyBand, wonderlust]) : s.label === "DJ" ? kestrel : pick(solos);
  };

  // The weekly slots, from six weeks ago to four weeks ahead.
  const thisMonday = weekStartOf(todayKey);
  // Each act's timekeeping habit: how often they're late.
  const lateness = new Map(artists.map((a, i) => [a.id, [0.05, 0.25, 0.1, 0.4, 0.15, 0.05, 0.2, 0.1, 0.3, 0.2, 0.1, 0.15][i]]));
  let declinedDone = false;
  for (let w = -6; w <= 3; w++) {
    const monday = addDaysToKey(thisMonday, w * 7);
    for (const s of slots) {
      const date = dateInWeek(monday, s.weekday);
      const daysAhead = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${todayKey}T12:00:00Z`)) / DAY);
      const base = {
        venue: s.venue,
        date,
        arrive: s.arriveTime,
        start: s.startTime,
        end: s.endTime,
        sale: s.feeMinor / 100,
        cost: (s.costMinor ?? 0) / 100,
        slotId: s.id,
        eventType: s.eventType,
      };
      if (daysAhead < 0) {
        // Played: settled once a fortnight old (venue paid, act paid), otherwise confirmed and still to invoice.
        const a = actFor(s);
        const old = daysAhead < -14;
        const r = rand();
        const lateP = lateness.get(a.id) ?? 0.1;
        const arrival: Arrival =
          r < 0.04
            ? "none"
            : { offsetMin: r < 0.04 + lateP ? 6 + Math.floor(rand() * 35) : -Math.floor(rand() * 40), onSite: rand() > 0.08, byAgent: rand() > 0.93 };
        await gig({
          ...base,
          act: a,
          status: old ? "SETTLED" : "CONFIRMED",
          arrival,
          paid: old ? { in: s.feeMinor, out: s.costMinor ?? 0 } : rand() > 0.5 ? { out: s.costMinor ?? 0 } : undefined,
        });
      } else if (daysAhead === 0) {
        // Today's regular gigs: anyone whose call time has passed has checked in (the live
        // board's other states come from the gigs added below).
        await gig({ ...base, act: actFor(s), status: "CONFIRMED", arrival: { offsetMin: -Math.floor(rand() * 20) } });
      } else if (daysAhead <= 13) {
        // The next fortnight: mostly confirmed, some offers out (one declined), a few with no act yet.
        const r = rand();
        if (r < 0.7) await gig({ ...base, act: actFor(s), status: "CONFIRMED" });
        else if (r < 0.85) {
          const offer = !declinedDone && daysAhead > 3 ? "declined" : "open";
          if (offer === "declined") declinedDone = true;
          await gig({ ...base, act: actFor(s), status: "AWAITING", offer });
        } else await gig({ ...base, act: null, status: "PENDING" });
      } else {
        // Weeks three and four: in the calendar, most still to sort.
        const r = rand();
        if (r < 0.3) await gig({ ...base, act: actFor(s), status: "CONFIRMED" });
        else if (r < 0.55) await gig({ ...base, act: actFor(s), status: "AWAITING", offer: "open" });
        else await gig({ ...base, act: null, status: "PENDING" });
      }
    }
  }

  // Today on the arrivals board: one of each live state, at times around now.
  const at = (mins: number) => new Date(Math.round((now.getTime() + mins * MIN) / (5 * MIN)) * 5 * MIN);
  // (Acts with no other gig today, so the demo doesn't double-book anyone.)
  const busyToday = new Set(slots.filter((sl) => sl.weekday === weekdayOf(todayKey)).map((sl) => sl.artistId));
  const free = [ellie, jo, finn, diarmuid, jade, sean].filter((a) => !busyToday.has(a.id));
  const [onTime, late, overdue, onTheWay] = [free[0] ?? ellie, free[1] ?? jo, free[2] ?? finn, free[3] ?? diarmuid];
  await gig({
    venue: swan,
    arriveAt: at(-90),
    act: onTime,
    status: "CONFIRMED",
    sale: 180,
    cost: 130,
    eventName: "Afternoon session",
    arrival: { offsetMin: -12 },
  });
  await gig({
    venue: oldBank,
    arriveAt: at(-60),
    act: late,
    status: "CONFIRMED",
    sale: 180,
    cost: 130,
    eventName: "Afternoon session",
    arrival: { offsetMin: 22 },
  });
  await gig({ venue: bridge, arriveAt: at(-30), act: overdue, status: "CONFIRMED", sale: 200, cost: 140, eventName: "Afternoon session" });
  await gig({
    venue: lantern,
    arriveAt: at(45),
    act: onTheWay,
    status: "CONFIRMED",
    sale: 200,
    cost: 140,
    eventName: "Early evening",
    onTheWay: { at: new Date(now.getTime() - 15 * MIN), eta: 40 },
  });

  // ---------- Weddings and private events ----------
  // A wedding six weeks away, nearly all sorted: three acts on one booking for the couple.
  const weddingDate = addDaysToKey(todayKey, 45);
  const w1 = await prisma.event.create({
    data: {
      agencyId,
      demo: true,
      name: "Hannah & Sam's wedding",
      type: "WEDDING",
      date: weddingDate,
      timezone: TZ,
      customerId: hannah.id,
      venueId: hollins.id,
      agentId: lead,
      plannerToken: `demo-${agencyId}-hannah-sam`,
      plannerSentAt: new Date(now.getTime() - 10 * DAY),
      plannerDoneAt: new Date(now.getTime() - 4 * DAY),
      guestCount: 120,
      timeline: "13:30 Ceremony\n14:15 Drinks reception\n16:00 Wedding breakfast\n18:00 Speeches\n19:30 First dance, then the band\n23:00 DJ until 00:30",
      dayContact: "Kate (best friend), 07700 900555",
      arrivalInfo: "Park behind the hall. Load in through the side door from 17:30.",
      dressCode: "Smart, dark colours",
      meals: "Hot meal for all acts at 17:00 in the snug",
      songRequests: "First dance: At Last (Etta James). Last song: Mr Brightside. No Macarena, please!",
      tasks: { create: defaultTasks("WEDDING", weddingDate).map((t) => ({ ...t, doneAt: t.key === "CONTRACT" ? new Date(now.getTime() - 20 * DAY) : null })) },
    },
  });
  await gig({
    venue: hollins,
    date: weddingDate,
    arrive: "12:45",
    start: "13:30",
    end: "14:15",
    act: ellie,
    status: "CONFIRMED",
    sale: 450,
    cost: 320,
    bookingFee: 150,
    promoter: hannah,
    eventType: "WEDDING",
    eventId: w1.id,
    eventName: w1.name,
    paid: { deposit: 450 },
    customerTold: true,
  });
  await gig({
    venue: hollins,
    date: weddingDate,
    arrive: "17:30",
    start: "19:30",
    end: "23:00",
    act: partyBand,
    status: "CONFIRMED",
    sale: 2200,
    cost: 1700,
    promoter: hannah,
    eventType: "WEDDING",
    eventId: w1.id,
    eventName: w1.name,
    paid: { deposit: 500 },
    customerTold: true,
  });
  await gig({
    venue: hollins,
    date: weddingDate,
    arrive: "22:30",
    start: "23:00",
    end: "00:30",
    act: kestrel,
    status: "AWAITING",
    sale: 600,
    cost: 420,
    promoter: hannah,
    eventType: "WEDDING",
    eventId: w1.id,
    eventName: w1.name,
    offer: "open",
  });

  // A wedding later in the year, early days: one act offered, one still to find.
  const wedding2 = addDaysToKey(todayKey, 150);
  const w2 = await prisma.event.create({
    data: {
      agencyId,
      demo: true,
      name: "Priya & Dev's wedding",
      type: "WEDDING",
      date: wedding2,
      timezone: TZ,
      customerId: priyaDev.id,
      venueText: "Marquee at Lower Farm, Hebden Bridge HX7 6AA",
      agentId: second,
      plannerToken: `demo-${agencyId}-priya-dev`,
      notes: "Wants a sax player with the DJ if we can find one.",
      tasks: { create: defaultTasks("WEDDING", wedding2) },
    },
  });
  await gig({
    venue: null,
    date: wedding2,
    arrive: "13:00",
    start: "14:00",
    end: "15:00",
    act: sunset,
    status: "AWAITING",
    sale: 550,
    cost: 400,
    bookingFee: 150,
    promoter: priyaDev,
    eventType: "WEDDING",
    eventId: w2.id,
    eventName: w2.name,
    offer: "open",
  });
  await gig({
    venue: null,
    date: wedding2,
    arrive: "19:00",
    start: "20:00",
    end: "23:30",
    act: null,
    status: "PENDING",
    sale: 1900,
    cost: 1450,
    promoter: priyaDev,
    eventType: "WEDDING",
    eventId: w2.id,
    eventName: w2.name,
  });

  // A 40th birthday party (one act, so just a booking) and a staff party on hold.
  await gig({
    venue: villageHall,
    date: addDaysToKey(todayKey, 20),
    arrive: "19:00",
    start: "20:00",
    end: "23:00",
    act: wonderlust,
    status: "CONFIRMED",
    sale: 1200,
    cost: 900,
    bookingFee: 75,
    promoter: sophie,
    eventType: "PRIVATE_PARTY",
    eventName: "Sophie's 40th",
    paid: { deposit: 300 },
    customerTold: true,
  });
  await gig({
    venue: lantern,
    date: addDaysToKey(todayKey, 34),
    arrive: "18:30",
    start: "19:30",
    end: "22:30",
    act: rogues,
    status: "HOLD",
    sale: 650,
    cost: 480,
    promoter: lanternCo,
    eventType: "CORPORATE",
    eventName: "Lantern Group staff party",
  });
  // An enquiry, and a gig that was called off.
  await gig({
    venue: bridge,
    date: addDaysToKey(todayKey, 60),
    arrive: "19:00",
    start: "20:00",
    end: "23:00",
    act: null,
    status: "ENQUIRY",
    sale: 900,
    cost: null,
    eventName: "St David's Day",
  });
  await gig({
    venue: oldBank,
    date: addDaysToKey(todayKey, 9),
    arrive: "19:30",
    start: "20:00",
    end: "23:00",
    act: sunset,
    status: "CANCELLED",
    sale: 340,
    cost: 250,
    eventName: "Venue closed for refurbishment",
  });
  // Days acts can't play: Ellie's holiday (from her app), and a day Jo is busy, which makes Wonderlust away too.
  await prisma.artistUnavailability.createMany({
    data: [
      { agencyId, artistId: ellie.id, startDate: addDaysToKey(todayKey, 22), endDate: addDaysToKey(todayKey, 28), note: "Holiday", source: "ACT" },
      { agencyId, artistId: jo.id, startDate: addDaysToKey(todayKey, 12), endDate: addDaysToKey(todayKey, 12), note: "Session work", source: "AGENCY" },
    ],
  });

  return { artists, venues: venues.length, bookings: await prisma.booking.count({ where: { agencyId, demo: true } }) };
}

/** Remove every demo record, plus anything hanging off the demo artists. Real data is left alone. */
export async function removeDemoData(prisma: Db, agencyId: string) {
  const artistIds = (await prisma.artist.findMany({ where: { agencyId, demo: true }, select: { id: true } })).map((a) => a.id);
  const bookingIds = (await prisma.booking.findMany({ where: { agencyId, OR: [{ demo: true }, { artistId: { in: artistIds } }] }, select: { id: true } })).map(
    (b) => b.id,
  );
  const contactIds = (await prisma.contact.findMany({ where: { agencyId, demo: true }, select: { id: true } })).map((c) => c.id);
  const venueIds = (await prisma.venue.findMany({ where: { agencyId, demo: true }, select: { id: true } })).map((v) => v.id);
  const personIds = (await prisma.person.findMany({ where: { agencyId, demo: true }, select: { id: true } })).map((p) => p.id);
  const eventIds = (await prisma.event.findMany({ where: { agencyId, demo: true }, select: { id: true } })).map((e) => e.id);

  await prisma.$transaction([
    // Payments and check-ins go with their bookings.
    prisma.booking.deleteMany({ where: { id: { in: bookingIds } } }),
    // Demo agents, and any app logins made for demo artists.
    prisma.user.deleteMany({ where: { agencyId, OR: [{ demo: true }, { artistId: { in: artistIds } }, { personId: { in: personIds } }] } }),
    prisma.person.deleteMany({ where: { id: { in: personIds } } }),
    prisma.event.deleteMany({ where: { id: { in: eventIds } } }),
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
          { entity: "EVENT", entityId: { in: eventIds } },
        ],
      },
    }),
  ]);
  return { bookings: bookingIds.length, artists: artistIds.length };
}
