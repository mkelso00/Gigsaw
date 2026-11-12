// Test data made straight in the database, for what a test needs but isn't about: its own act,
// venue, booking or wedding. Every name carries a unique stamp, so tests never share rows and can
// run side by side, and again and again on the same database. Everything goes in the seeded
// Northern Lights agency, where the admin login can see it.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { defaultTasks } from "../../../src/lib/event-plan";
import { AGENCY_NAME, ADMIN, checkDatabaseUrl, databaseUrl } from "./env";

let client: PrismaClient | null = null;

/** One client per test worker, on the end-to-end database only. */
export function db() {
  if (!client) {
    checkDatabaseUrl();
    client = new PrismaClient({ datasourceUrl: databaseUrl });
  }
  return client;
}

/** A short tag that no other test or run will have, e.g. "offer m3k9x2-4f7a". */
export function stamp(tag: string) {
  return `${tag} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** "YYYY-MM-DD" for a day `days` from today (UTC), for date inputs. */
export function dayFromToday(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** A day well in the future with some spread, so parallel tests rarely pick the same one. */
export function someFutureDay() {
  return dayFromToday(60 + Math.floor(Math.random() * 300));
}

export async function seededAgency() {
  const admin = await db().user.findUnique({ where: { email: ADMIN.email }, include: { agency: true } });
  if (!admin?.agencyId || admin.agency?.name !== AGENCY_NAME) {
    throw new Error("The demo data isn't in the end-to-end database. Run the seed first: npx tsx prisma/seed.ts (see README, Checks).");
  }
  return { agencyId: admin.agencyId, adminId: admin.id };
}

/** A new act of our own, so no other booking can clash with it. */
export async function createAct(name: string) {
  const { agencyId } = await seededAgency();
  return db().artist.create({ data: { agencyId, name, genre: "Test act", colour: "#2563eb" } });
}

/** A venue with a position, so a check-in there can be verified. Defaults to central Manchester. */
export async function createVenue(name: string, at = { latitude: 53.4794, longitude: -2.2453 }) {
  const { agencyId } = await seededAgency();
  return db().venue.create({ data: { agencyId, name, city: "Manchester", country: "United Kingdom", timezone: "Europe/London", ...at } });
}

/** A login for the act's own app. */
export async function createActLogin(artistId: string, name: string) {
  const { agencyId } = await seededAgency();
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@e2e.gigsaw.invalid`;
  const password = "e2e-password-123";
  await db().user.create({ data: { email, name, role: "ARTIST", agencyId, artistId, passwordHash: await bcrypt.hash(password, 10) } });
  return { email, password };
}

/** A booking made the way the app numbers them (GS-0001 and up), trying again if a parallel test takes the number. */
export async function createBooking(data: {
  artistId: string;
  venueId: string;
  status: string;
  arriveBy: Date;
  setStart: Date;
  setEnd: Date;
  feeMinor?: number;
  artistFeeMinor?: number;
}) {
  const { agencyId, adminId } = await seededAgency();
  for (let attempt = 0; attempt < 10; attempt++) {
    const [row] = await db().$queryRaw<{ n: number | null }[]>`
      SELECT MAX(NULLIF(regexp_replace(reference, '[^0-9]', '', 'g'), '')::bigint)::int AS n FROM "Booking" WHERE "agencyId" = ${agencyId}`;
    const reference = `GS-${String((row?.n ?? 0) + 1).padStart(4, "0")}`;
    try {
      return await db().booking.create({
        data: { agencyId, reference, timezone: "Europe/London", currency: "GBP", agentId: adminId, createdById: adminId, ...data },
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  throw new Error("Couldn't find a free booking reference");
}

/** A wedding with the standard checklist, as a new one from the app gets. */
export async function createWedding(name: string, date = someFutureDay()) {
  const { agencyId, adminId } = await seededAgency();
  return db().event.create({
    data: { agencyId, name, type: "WEDDING", date, timezone: "Europe/London", agentId: adminId, venueText: "Home Farm, near York", tasks: { create: defaultTasks("WEDDING", date) } },
  });
}
