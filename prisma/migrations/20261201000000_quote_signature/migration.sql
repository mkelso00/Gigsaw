-- The customer's drawn signature when they accept a quote.
ALTER TABLE "Quote" ADD COLUMN "answerSignature" TEXT NOT NULL DEFAULT '';
