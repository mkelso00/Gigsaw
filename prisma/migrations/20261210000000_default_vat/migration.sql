-- VAT % on the sale of every new booking (0 = no VAT). Bookings already made keep their own.
ALTER TABLE "Settings" ADD COLUMN "defaultVatPct" DOUBLE PRECISION NOT NULL DEFAULT 0;
