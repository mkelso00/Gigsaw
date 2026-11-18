-- One booking's line-up changes: a member off the gig, or a stand-in on it.
CREATE TABLE "BookingLineup" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookingLineup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingLineup_bookingId_personId_key" ON "BookingLineup"("bookingId", "personId");
CREATE INDEX "BookingLineup_personId_idx" ON "BookingLineup"("personId");

ALTER TABLE "BookingLineup" ADD CONSTRAINT "BookingLineup_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingLineup" ADD CONSTRAINT "BookingLineup_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
