-- VAT on sales starts at 20% (UK standard rate), so new proposal lines and bookings show it unless changed.
ALTER TABLE "Settings" ALTER COLUMN "defaultVatPct" SET DEFAULT 20;

-- data:start
-- Businesses that never set it (still 0) get 20%. Anyone who isn't VAT registered can set it back to 0 in Settings.
UPDATE "Settings" SET "defaultVatPct" = 20 WHERE "defaultVatPct" = 0;
-- data:end
