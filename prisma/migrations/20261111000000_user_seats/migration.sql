-- Internal users: a number included per business, and a yearly price for each extra one.
-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "extraUserYearlyMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "includedUsers" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "BillingStatement" ADD COLUMN     "extraUsers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "userChargeMinor" INTEGER NOT NULL DEFAULT 0;

