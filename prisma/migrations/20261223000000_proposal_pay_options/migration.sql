-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "vatOnShare" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "payNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "payOptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "payPlan" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "cashAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "payNote" TEXT NOT NULL DEFAULT '';

-- Wedding drafts not yet sent offer both ways to pay the balance. Proposals already sent, and anything that
-- isn't a wedding, keep none, so they're paid as they were offered.
UPDATE "Quote" SET "payOptions" = ARRAY['CASH', 'TRANSFER']::TEXT[] WHERE "status" = 'DRAFT' AND "eventType" = 'WEDDING';
