-- Monthly billing: one bill a month per paying company (or per venue), with its PO, invoice and payment steps.
-- Contact.billing says whether a company gets one bill for all its venues (COMBINED) or one per venue (PER_VENUE).

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "billing" TEXT NOT NULL DEFAULT 'COMBINED';

-- CreateTable
CREATE TABLE "MonthlyBill" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "contactId" TEXT,
    "venueId" TEXT,
    "poRequestedAt" TIMESTAMP(3),
    "poNumber" TEXT NOT NULL DEFAULT '',
    "poReceivedAt" TIMESTAMP(3),
    "invoicedAt" TIMESTAMP(3),
    "invoiceNumber" TEXT NOT NULL DEFAULT '',
    "invoicedTotalMinor" INTEGER,
    "paidAt" TIMESTAMP(3),
    "nothingToBill" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "xeroInvoiceId" TEXT NOT NULL DEFAULT '',
    "xeroStatus" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyBill_contactId_idx" ON "MonthlyBill"("contactId");

-- CreateIndex
CREATE INDEX "MonthlyBill_venueId_idx" ON "MonthlyBill"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyBill_agencyId_month_key_key" ON "MonthlyBill"("agencyId", "month", "key");

-- AddForeignKey
ALTER TABLE "MonthlyBill" ADD CONSTRAINT "MonthlyBill_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyBill" ADD CONSTRAINT "MonthlyBill_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyBill" ADD CONSTRAINT "MonthlyBill_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

