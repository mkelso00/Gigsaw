// Local development: wipe the database and load the demo agency with known logins.
// Run with: npm run setup or npm run db:reset. On a live site, use Settings → Load demo data instead.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { addDemoData } from "../src/lib/demo";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  // The demo wipes everything, so never run it over real data by accident.
  if ((await prisma.user.count()) > 0 && !process.argv.includes("--force")) {
    console.error("This database already has data. The demo seed would delete it all.");
    console.error("If you really want that, run: npx tsx prisma/seed.ts --force");
    process.exit(1);
  }
  await prisma.$transaction([
    prisma.billingStatement.deleteMany(),
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
    prisma.agency.deleteMany(),
  ]);

  const hash = await bcrypt.hash("gigsaw123", 10);
  const contractTerms =
    "1. The Promoter will provide the hospitality and technical requirements in the Artist's rider.\n2. Cancellation by the Promoter within 30 days of the engagement means the full fee is payable.\n3. The balance is payable in cleared funds no later than the night of the performance.";

  // Agency one: the owner also runs this one.
  const northern = await prisma.agency.create({
    data: { name: "Northern Lights Agency", pricePerGigMinor: 300, billingCurrency: "GBP", billingEmail: "accounts@northernlights.example" },
  });
  await prisma.settings.create({
    data: { agencyId: northern.id, agencyName: northern.name, agencyEmail: "bookings@northernlights.example", agencyAddress: "12 Example Street\nManchester M1 1AA", contractTerms },
  });
  const admin = await prisma.user.create({
    data: { email: "admin@gigsaw.test", name: "Alex Morgan", role: "ADMIN", isOwner: true, agencyId: northern.id, passwordHash: hash },
  });
  const agent = await prisma.user.create({ data: { email: "agent@gigsaw.test", name: "Sam Patel", role: "AGENT", agencyId: northern.id, passwordHash: hash } });
  const demo = await addDemoData(prisma, { agencyId: northern.id, leadAgentId: admin.id, secondAgentId: agent.id });
  // Maya can sign in to the artist app.
  await prisma.user.create({
    data: { email: "maya@gigsaw.test", name: "Maya Okafor", role: "ARTIST", agencyId: northern.id, artistId: demo.artists[0].id, passwordHash: hash },
  });

  // Agency two: a separate customer, to show agencies can't see each other.
  const harbour = await prisma.agency.create({ data: { name: "Harbour Music", pricePerGigMinor: 250, billingCurrency: "GBP" } });
  await prisma.settings.create({ data: { agencyId: harbour.id, agencyName: harbour.name, agencyEmail: "hello@harbour.example", contractTerms } });
  const harbourAdmin = await prisma.user.create({
    data: { email: "harbour@gigsaw.test", name: "Jo Rivers", role: "ADMIN", agencyId: harbour.id, passwordHash: hash },
  });
  const demo2 = await addDemoData(prisma, { agencyId: harbour.id, leadAgentId: harbourAdmin.id });

  console.log(`Seeded 2 agencies: ${demo.bookings} and ${demo2.bookings} bookings.`);
  console.log("Owner + Northern Lights admin: admin@gigsaw.test · Agent: agent@gigsaw.test · Artist app: maya@gigsaw.test");
  console.log("Harbour Music admin: harbour@gigsaw.test · Password for all: gigsaw123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
