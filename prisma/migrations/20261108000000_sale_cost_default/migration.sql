-- New bookings use sale and cost (what the venue pays, what the act is paid) unless told otherwise.
ALTER TABLE "Booking" ALTER COLUMN "dealType" SET DEFAULT 'BUY_SELL';
