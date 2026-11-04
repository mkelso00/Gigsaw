-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'WEBSITE',
ADD COLUMN     "endTime" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "supersededById" TEXT,
    "enquiryId" TEXT,
    "contactId" TEXT,
    "eventId" TEXT,
    "agentId" TEXT,
    "createdById" TEXT,
    "title" TEXT NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT 'WEDDING',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/London',
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "bookingFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "depositMinor" INTEGER NOT NULL DEFAULT 0,
    "depositDue" TEXT,
    "validUntil" TEXT,
    "message" TEXT NOT NULL DEFAULT '',
    "terms" TEXT NOT NULL DEFAULT '',
    "token" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "sentTo" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "answerName" TEXT NOT NULL DEFAULT '',
    "answerNote" TEXT NOT NULL DEFAULT '',
    "answerIp" TEXT NOT NULL DEFAULT '',
    "answerAgent" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "artistId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "date" TEXT NOT NULL,
    "arriveTime" TEXT NOT NULL DEFAULT '',
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL DEFAULT '',
    "venueId" TEXT,
    "place" TEXT NOT NULL DEFAULT '',
    "saleMinor" INTEGER NOT NULL DEFAULT 0,
    "costMinor" INTEGER,
    "vatPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bookingId" TEXT,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_supersededById_key" ON "Quote"("supersededById");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_token_key" ON "Quote"("token");

-- CreateIndex
CREATE INDEX "Quote_agencyId_status_idx" ON "Quote"("agencyId", "status");

-- CreateIndex
CREATE INDEX "Quote_enquiryId_idx" ON "Quote"("enquiryId");

-- CreateIndex
CREATE INDEX "Quote_contactId_idx" ON "Quote"("contactId");

-- CreateIndex
CREATE INDEX "Quote_eventId_idx" ON "Quote"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_agencyId_number_version_key" ON "Quote"("agencyId", "number", "version");

-- CreateIndex
CREATE INDEX "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");

-- CreateIndex
CREATE INDEX "QuoteLine_bookingId_idx" ON "QuoteLine"("bookingId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
