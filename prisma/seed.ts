// Local development: wipe the database and load the demo agency with known logins.
// Run with: npm run setup or npm run db:reset. On a live site, use Settings → Load demo data instead.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDemoData } from "../src/lib/demo";

const prisma = new PrismaClient();

async function main() {
  // The demo wipes everything, so never run it over real data by accident.
  if ((await prisma.user.count()) > 0 && !process.argv.includes("--force")) {
    console.error("This database already has data. The demo seed would delete it all.");
    console.error("If you really want that, run: npx tsx prisma/seed.ts --force");
    process.exit(1);
  }
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

  const demo = await addDemoData(prisma, { leadAgentId: admin.id, secondAgentId: agent.id });
  // Maya can sign in to the artist app.
  await prisma.user.create({ data: { email: "maya@gigsaw.test", name: "Maya Okafor", role: "ARTIST", artistId: demo.artists[0].id, passwordHash: hash } });

  await prisma.activity.create({ data: { userId: admin.id, entity: "SETTINGS", entityId: "1", action: "set up Gigsaw with demo data" } });

  console.log(`Seeded ${demo.artists.length} artists, ${demo.venues} venues, ${demo.bookings} bookings.`);
  console.log("Sign in with admin@gigsaw.test, agent@gigsaw.test or maya@gigsaw.test (artist app). Password: gigsaw123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
