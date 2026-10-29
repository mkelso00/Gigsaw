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
    data: {
      agencyId: northern.id,
      agencyName: northern.name,
      agencyEmail: "bookings@northernlights.example",
      agencyAddress: "12 Example Street\nManchester M1 1AA",
      contractTerms,
    },
  });
  const admin = await prisma.user.create({
    data: { email: "admin@gigsaw.test", name: "Alex Morgan", role: "ADMIN", isOwner: true, agencyId: northern.id, passwordHash: hash },
  });
  const agent = await prisma.user.create({ data: { email: "agent@gigsaw.test", name: "Sam Patel", role: "AGENT", agencyId: northern.id, passwordHash: hash } });
  const demo = await addDemoData(prisma, { agencyId: northern.id, leadAgentId: admin.id, secondAgentId: agent.id });
  // Ellie Rose (a solo act) can sign in to the artist app with the act's own login.
  const ellie = demo.artists.find((a) => a.name === "Ellie Rose")!;
  await prisma.user.create({
    data: { email: "ellie@gigsaw.test", name: "Ellie Rose", role: "ARTIST", agencyId: northern.id, artistId: ellie.id, passwordHash: hash },
  });
  // Graham signs in as himself: he sees his solo gigs and Wonderlust's (a band built from his act and Jo's).
  const graham = await prisma.person.findFirstOrThrow({ where: { agencyId: northern.id, firstName: "Graham", surname: "McKee" } });
  await prisma.user.create({
    data: { email: "graham@gigsaw.test", name: "Graham McKee", role: "ARTIST", agencyId: northern.id, personId: graham.id, passwordHash: hash },
  });

  // Agency two: a separate customer, to show agencies can't see each other.
  const harbour = await prisma.agency.create({ data: { name: "Harbour Music", pricePerGigMinor: 250, billingCurrency: "GBP" } });
  await prisma.settings.create({ data: { agencyId: harbour.id, agencyName: harbour.name, agencyEmail: "hello@harbour.example", contractTerms } });
  const harbourAdmin = await prisma.user.create({
    data: { email: "harbour@gigsaw.test", name: "Jo Rivers", role: "ADMIN", agencyId: harbour.id, passwordHash: hash },
  });
  const demo2 = await addDemoData(prisma, { agencyId: harbour.id, leadAgentId: harbourAdmin.id });

  console.log(`Seeded 2 agencies: ${demo.bookings} and ${demo2.bookings} bookings.`);
  console.log(
    "Owner + Northern Lights admin: admin@gigsaw.test · Agent: agent@gigsaw.test · Artist app: ellie@gigsaw.test (a solo act), graham@gigsaw.test (a person whose act is in a band)",
  );
  console.log("Harbour Music admin: harbour@gigsaw.test · Password for all: gigsaw123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
