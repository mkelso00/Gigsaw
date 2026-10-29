-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "customerConfirmations" TEXT NOT NULL DEFAULT 'EVENTS';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "customerToldAt" TIMESTAMP(3),
ADD COLUMN     "offerResponse" TEXT,
ADD COLUMN     "offerToken" TEXT,
ADD COLUMN     "offeredAt" TIMESTAMP(3),
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ALTER COLUMN "status" SET DEFAULT 'PENDING',
ALTER COLUMN "artistId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Booking_offerToken_key" ON "Booking"("offerToken");

