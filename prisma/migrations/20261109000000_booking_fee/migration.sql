-- Booking fee: charged to the venue or client on top of the performance fee, kept in full by the agency.
ALTER TABLE "Booking" ADD COLUMN "bookingFeeMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Settings" ADD COLUMN "bookingFeeMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Settings" ADD COLUMN "bookingFeeFor" TEXT NOT NULL DEFAULT 'EVENTS';
