-- Self-billing invoices for acts' fees (ActInvoice). liveBookingId is unique, so a booking never has two live invoices.
-- CreateTable
CREATE TABLE "ActInvoice" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "artistId" TEXT,
    "bookingId" TEXT,
    "liveBookingId" TEXT,
    "seq" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "netMinor" INTEGER NOT NULL,
    "vatPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "bookingRef" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "gigDate" TIMESTAMP(3) NOT NULL,
    "actName" TEXT NOT NULL,
    "actAddress" TEXT NOT NULL DEFAULT '',
    "actVatNumber" TEXT NOT NULL DEFAULT '',
    "bankAccountName" TEXT NOT NULL DEFAULT '',
    "bankSortCode" TEXT NOT NULL DEFAULT '',
    "bankAccountNumber" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActInvoice_liveBookingId_key" ON "ActInvoice"("liveBookingId");

-- CreateIndex
CREATE INDEX "ActInvoice_agencyId_status_idx" ON "ActInvoice"("agencyId", "status");

-- CreateIndex
CREATE INDEX "ActInvoice_artistId_issuedAt_idx" ON "ActInvoice"("artistId", "issuedAt");

-- CreateIndex
CREATE INDEX "ActInvoice_bookingId_idx" ON "ActInvoice"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "ActInvoice_agencyId_seq_key" ON "ActInvoice"("agencyId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ActInvoice_agencyId_number_key" ON "ActInvoice"("agencyId", "number");

-- AddForeignKey
ALTER TABLE "ActInvoice" ADD CONSTRAINT "ActInvoice_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActInvoice" ADD CONSTRAINT "ActInvoice_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActInvoice" ADD CONSTRAINT "ActInvoice_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

