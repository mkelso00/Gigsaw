-- New acts join through a private link; the agency approves them. Acts get profile and bank details.
-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "joinToken" TEXT;

-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "actType" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankAccountName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankAccountNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankSortCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "instagram" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "photoUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "setList" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "town" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "usualFeeMinor" INTEGER,
ADD COLUMN     "vatNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "videoUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "website" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ActApplication" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "artistId" TEXT,
    "actName" TEXT NOT NULL,
    "actType" TEXT NOT NULL DEFAULT 'SOLO',
    "genre" TEXT NOT NULL DEFAULT '',
    "town" TEXT NOT NULL DEFAULT '',
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "members" JSONB NOT NULL DEFAULT '[]',
    "photoUrl" TEXT NOT NULL DEFAULT '',
    "videoUrl" TEXT NOT NULL DEFAULT '',
    "instagram" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "setList" TEXT NOT NULL DEFAULT '',
    "usualFeeMinor" INTEGER,
    "bankAccountName" TEXT NOT NULL DEFAULT '',
    "bankSortCode" TEXT NOT NULL DEFAULT '',
    "bankAccountNumber" TEXT NOT NULL DEFAULT '',
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "vatNumber" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "passwordHash" TEXT NOT NULL,

    CONSTRAINT "ActApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActApplication_agencyId_status_idx" ON "ActApplication"("agencyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_joinToken_key" ON "Settings"("joinToken");

-- AddForeignKey
ALTER TABLE "ActApplication" ADD CONSTRAINT "ActApplication_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

