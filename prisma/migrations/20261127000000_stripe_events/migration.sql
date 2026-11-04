-- Stripe webhooks: remember which events have been handled so a repeat is skipped, and keep card
-- payments that can't be matched to a booking (instead of dropping them) until someone puts them
-- against one. A card payment can now be kept before Gigsaw knows which business it's for.

-- AlterTable
ALTER TABLE "CardPayment" ADD COLUMN     "problem" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "refundedMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'MATCHED',
ALTER COLUMN "agencyId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StripeEvent_receivedAt_idx" ON "StripeEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "CardPayment_status_idx" ON "CardPayment"("status");

-- CreateIndex
CREATE INDEX "CardPayment_stripePaymentId_idx" ON "CardPayment"("stripePaymentId");
