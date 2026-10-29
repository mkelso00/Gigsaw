-- Imported records remember their id in the old system (e.g. Overture), so importing again updates instead of duplicating.
-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "importRef" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "importRef" TEXT;

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "importRef" TEXT;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "importRef" TEXT;

-- CreateIndex
CREATE INDEX "Artist_agencyId_importRef_idx" ON "Artist"("agencyId", "importRef");

-- CreateIndex
CREATE INDEX "Contact_agencyId_importRef_idx" ON "Contact"("agencyId", "importRef");

-- CreateIndex
CREATE INDEX "Venue_agencyId_importRef_idx" ON "Venue"("agencyId", "importRef");

-- CreateIndex
CREATE INDEX "Person_agencyId_importRef_idx" ON "Person"("agencyId", "importRef");

