-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Venue_shareToken_key" ON "Venue"("shareToken");

