-- The agency's drawn signature for contracts.
ALTER TABLE "Settings" ADD COLUMN "signatureImage" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Settings" ADD COLUMN "signatureName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Settings" ADD COLUMN "signatureRole" TEXT NOT NULL DEFAULT '';
