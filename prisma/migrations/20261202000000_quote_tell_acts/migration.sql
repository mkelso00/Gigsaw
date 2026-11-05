-- Whether the acts are emailed and texted when the customer accepts the quote.
ALTER TABLE "Quote" ADD COLUMN "tellActs" BOOLEAN NOT NULL DEFAULT true;
