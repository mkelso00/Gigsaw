-- The client's lead contact (src/lib/client-recipient.ts): the person at the venue or the paying company who deals with
-- the bookings, so the client's messages go to them rather than the owners. Set on a booking, or as the usual one on a
-- venue or a company. Plus, per company, whether day-to-day emails may go to the company's own email (on for everyone
-- already here, so nothing changes until a business says so).
ALTER TABLE "Booking" ADD COLUMN     "clientContactId" TEXT;

ALTER TABLE "Contact" ADD COLUMN     "leadContactId" TEXT,
ADD COLUMN     "notifyOwner" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Venue" ADD COLUMN     "leadContactId" TEXT;

CREATE INDEX "Booking_clientContactId_idx" ON "Booking"("clientContactId");

ALTER TABLE "Contact" ADD CONSTRAINT "Contact_leadContactId_fkey" FOREIGN KEY ("leadContactId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Venue" ADD CONSTRAINT "Venue_leadContactId_fkey" FOREIGN KEY ("leadContactId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_clientContactId_fkey" FOREIGN KEY ("clientContactId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
