-- DropForeignKey
ALTER TABLE "Reminder" DROP CONSTRAINT "Reminder_artistId_fkey";

-- DropIndex
DROP INDEX "Reminder_kind_artistId_key_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "personId" TEXT;

-- Reminders are now addressed to a recipient ("act:<id>" or "person:<id>").
-- Keep the reminders already sent so none goes twice.
ALTER TABLE "Reminder" ADD COLUMN "recipient" TEXT;
UPDATE "Reminder" SET "recipient" = 'act:' || "artistId";
ALTER TABLE "Reminder" ALTER COLUMN "recipient" SET NOT NULL;
ALTER TABLE "Reminder" DROP COLUMN "artistId";

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "surname" TEXT NOT NULL DEFAULT '',
    "alias" TEXT NOT NULL DEFAULT '',
    "pronouns" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "social" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "venueId" TEXT,
    "companyId" TEXT,
    "jobTitle" TEXT NOT NULL DEFAULT '',
    "calendarToken" TEXT NOT NULL,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonAct" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PersonAct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_calendarToken_key" ON "Person"("calendarToken");

-- CreateIndex
CREATE INDEX "Person_agencyId_idx" ON "Person"("agencyId");

-- CreateIndex
CREATE INDEX "Person_venueId_idx" ON "Person"("venueId");

-- CreateIndex
CREATE INDEX "PersonAct_artistId_idx" ON "PersonAct"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonAct_personId_artistId_key" ON "PersonAct"("personId", "artistId");

-- CreateIndex
CREATE UNIQUE INDEX "User_personId_key" ON "User"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_kind_recipient_key_key" ON "Reminder"("kind", "recipient", "key");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonAct" ADD CONSTRAINT "PersonAct_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonAct" ADD CONSTRAINT "PersonAct_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

