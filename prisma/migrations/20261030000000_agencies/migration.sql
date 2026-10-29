-- Multi-agency support.
-- Existing data (from before agencies existed) is moved into one agency, named after the
-- old Settings, and the earliest admin becomes the platform owner so nobody is locked out.

-- 1. Agencies and billing statements.
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "pricePerGigMinor" INTEGER NOT NULL DEFAULT 0,
    "billingCurrency" TEXT NOT NULL DEFAULT 'GBP',
    "billingEmail" TEXT NOT NULL DEFAULT '',
    "ownerNotes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingStatement" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "gigCount" INTEGER NOT NULL,
    "pricePerGigMinor" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "references" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "BillingStatement_pkey" PRIMARY KEY ("id")
);

-- 2. One agency for any data that already exists.
INSERT INTO "Agency" ("id", "name", "billingEmail")
SELECT 'agency_original',
       COALESCE((SELECT "agencyName" FROM "Settings" LIMIT 1), 'My Agency'),
       COALESCE((SELECT "agencyEmail" FROM "Settings" LIMIT 1), '')
WHERE EXISTS (SELECT 1 FROM "User") OR EXISTS (SELECT 1 FROM "Settings")
   OR EXISTS (SELECT 1 FROM "Artist") OR EXISTS (SELECT 1 FROM "Contact")
   OR EXISTS (SELECT 1 FROM "Venue") OR EXISTS (SELECT 1 FROM "Booking");

-- 3. Add the agency columns, fill them, then make them required.
ALTER TABLE "User" ADD COLUMN "agencyId" TEXT, ADD COLUMN "isOwner" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Artist" ADD COLUMN "agencyId" TEXT;
ALTER TABLE "Contact" ADD COLUMN "agencyId" TEXT;
ALTER TABLE "Venue" ADD COLUMN "agencyId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "agencyId" TEXT;
ALTER TABLE "Activity" ADD COLUMN "agencyId" TEXT;
ALTER TABLE "Settings" ADD COLUMN "agencyId" TEXT;

UPDATE "User" SET "agencyId" = 'agency_original';
UPDATE "Artist" SET "agencyId" = 'agency_original';
UPDATE "Contact" SET "agencyId" = 'agency_original';
UPDATE "Venue" SET "agencyId" = 'agency_original';
UPDATE "Booking" SET "agencyId" = 'agency_original';
UPDATE "Activity" SET "agencyId" = 'agency_original';
UPDATE "Settings" SET "agencyId" = 'agency_original';

-- The first admin (the person who set Gigsaw up) runs the platform.
UPDATE "User" SET "isOwner" = true
WHERE "id" = (SELECT "id" FROM "User" WHERE "role" = 'ADMIN' AND "demo" = false ORDER BY "createdAt" ASC LIMIT 1);

ALTER TABLE "Artist" ALTER COLUMN "agencyId" SET NOT NULL;
ALTER TABLE "Contact" ALTER COLUMN "agencyId" SET NOT NULL;
ALTER TABLE "Venue" ALTER COLUMN "agencyId" SET NOT NULL;
ALTER TABLE "Booking" ALTER COLUMN "agencyId" SET NOT NULL;

-- 4. Settings are now one row per agency.
ALTER TABLE "Settings" DROP CONSTRAINT "Settings_pkey";
ALTER TABLE "Settings" DROP COLUMN "id";
ALTER TABLE "Settings" ALTER COLUMN "agencyId" SET NOT NULL;
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_pkey" PRIMARY KEY ("agencyId");

-- 5. Booking references are unique within an agency, not across the platform.
DROP INDEX "Booking_reference_key";
DROP INDEX "Booking_setStart_idx";
CREATE UNIQUE INDEX "Booking_agencyId_reference_key" ON "Booking"("agencyId", "reference");
CREATE INDEX "Booking_agencyId_setStart_idx" ON "Booking"("agencyId", "setStart");
CREATE UNIQUE INDEX "BillingStatement_agencyId_month_key" ON "BillingStatement"("agencyId", "month");
CREATE INDEX "Artist_agencyId_idx" ON "Artist"("agencyId");
CREATE INDEX "Contact_agencyId_idx" ON "Contact"("agencyId");
CREATE INDEX "Venue_agencyId_idx" ON "Venue"("agencyId");

-- 6. Foreign keys.
ALTER TABLE "BillingStatement" ADD CONSTRAINT "BillingStatement_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Artist" ADD CONSTRAINT "Artist_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
