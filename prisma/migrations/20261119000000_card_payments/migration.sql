-- Card payments: agencies take deposits and invoices by card into their own Stripe account (Connect).
-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeDetailsDone" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cardPaymentId" TEXT;

-- CreateTable
CREATE TABLE "PayLink" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "bookingId" TEXT,
    "eventId" TEXT,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardPayment" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "payLinkId" TEXT,
    "stripeSessionId" TEXT NOT NULL,
    "stripePaymentId" TEXT NOT NULL DEFAULT '',
    "stripeAccountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayLink_token_key" ON "PayLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PayLink_bookingId_kind_key" ON "PayLink"("bookingId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PayLink_eventId_kind_key" ON "PayLink"("eventId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CardPayment_stripeSessionId_key" ON "CardPayment"("stripeSessionId");

-- CreateIndex
CREATE INDEX "CardPayment_agencyId_paidAt_idx" ON "CardPayment"("agencyId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Agency_stripeAccountId_key" ON "Agency"("stripeAccountId");

-- CreateIndex
CREATE INDEX "Payment_cardPaymentId_idx" ON "Payment"("cardPaymentId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cardPaymentId_fkey" FOREIGN KEY ("cardPaymentId") REFERENCES "CardPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayLink" ADD CONSTRAINT "PayLink_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayLink" ADD CONSTRAINT "PayLink_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayLink" ADD CONSTRAINT "PayLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardPayment" ADD CONSTRAINT "CardPayment_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardPayment" ADD CONSTRAINT "CardPayment_payLinkId_fkey" FOREIGN KEY ("payLinkId") REFERENCES "PayLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

