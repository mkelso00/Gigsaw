-- Only book acts who've signed up to Gigsaw (src/lib/book-signed-up.ts). A switch in Settings, General, off for new
-- businesses; and on each act, when an admin approved it to be booked before signing up, and who.
ALTER TABLE "Artist" ADD COLUMN     "bookBeforeSignupAt" TIMESTAMP(3),
ADD COLUMN     "bookBeforeSignupById" TEXT;

ALTER TABLE "Settings" ADD COLUMN     "bookOnlySignedUp" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Artist" ADD CONSTRAINT "Artist_bookBeforeSignupById_fkey" FOREIGN KEY ("bookBeforeSignupById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- data:start
-- On for every business already on Gigsaw: Suave Agency asked for it, and they're the only real customer so far.
-- Any business can turn it off in Settings, General.
UPDATE "Settings" SET "bookOnlySignedUp" = true;
-- data:end
