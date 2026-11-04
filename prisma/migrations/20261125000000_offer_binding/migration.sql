-- Offer links are bound to the act they were sent to. The /o page, "Accept all" and answering
-- only work while the booking's act is still that act, so an old link stops working when the
-- booking moves to another act. Links already out are bound to the booking's current act, so
-- they keep working.

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "offeredArtistId" TEXT;

UPDATE "Booking" SET "offeredArtistId" = "artistId" WHERE "offerToken" IS NOT NULL AND "artistId" IS NOT NULL;
