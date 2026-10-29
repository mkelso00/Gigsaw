-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "colour" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "slotId" TEXT;

-- CreateTable
CREATE TABLE "VenueSlot" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "arriveTime" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "feeMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "eventType" TEXT NOT NULL DEFAULT 'GIG',
    "bookingStatus" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "promoterId" TEXT,
    "artistId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VenueSlot_agencyId_weekday_idx" ON "VenueSlot"("agencyId", "weekday");

-- CreateIndex
CREATE INDEX "VenueSlot_venueId_idx" ON "VenueSlot"("venueId");

-- CreateIndex
CREATE INDEX "Booking_slotId_idx" ON "Booking"("slotId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "VenueSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueSlot" ADD CONSTRAINT "VenueSlot_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueSlot" ADD CONSTRAINT "VenueSlot_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueSlot" ADD CONSTRAINT "VenueSlot_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueSlot" ADD CONSTRAINT "VenueSlot_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

