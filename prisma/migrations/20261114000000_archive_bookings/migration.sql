-- Bookings can be archived instead of deleted.
-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "archivedAt" TIMESTAMP(3);

