-- Address and National Insurance number on acts (for self-billing invoices and the agency's records),
-- and when the act last completed their details.
ALTER TABLE "Artist" ADD COLUMN "address" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Artist" ADD COLUMN "niNumber" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Artist" ADD COLUMN "detailsCompletedAt" TIMESTAMP(3);
