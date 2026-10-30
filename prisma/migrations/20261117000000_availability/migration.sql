-- Act availability: dates an act can't play, and "Are you free?" requests with each act's answer.
-- CreateTable
CREATE TABLE "ArtistUnavailability" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'AGENCY',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistUnavailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityRequest" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/London',
    "arriveTime" TEXT NOT NULL DEFAULT '',
    "startTime" TEXT NOT NULL DEFAULT '',
    "endTime" TEXT NOT NULL DEFAULT '',
    "venueId" TEXT,
    "place" TEXT NOT NULL DEFAULT '',
    "eventType" TEXT NOT NULL DEFAULT 'GIG',
    "costMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "note" TEXT NOT NULL DEFAULT '',
    "bookingId" TEXT,
    "createdById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityReply" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "answer" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtistUnavailability_agencyId_endDate_idx" ON "ArtistUnavailability"("agencyId", "endDate");

-- CreateIndex
CREATE INDEX "ArtistUnavailability_artistId_endDate_idx" ON "ArtistUnavailability"("artistId", "endDate");

-- CreateIndex
CREATE INDEX "AvailabilityRequest_agencyId_date_idx" ON "AvailabilityRequest"("agencyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityReply_token_key" ON "AvailabilityReply"("token");

-- CreateIndex
CREATE INDEX "AvailabilityReply_artistId_idx" ON "AvailabilityReply"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityReply_requestId_artistId_key" ON "AvailabilityReply"("requestId", "artistId");

-- AddForeignKey
ALTER TABLE "ArtistUnavailability" ADD CONSTRAINT "ArtistUnavailability_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistUnavailability" ADD CONSTRAINT "ArtistUnavailability_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityRequest" ADD CONSTRAINT "AvailabilityRequest_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityRequest" ADD CONSTRAINT "AvailabilityRequest_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityRequest" ADD CONSTRAINT "AvailabilityRequest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityReply" ADD CONSTRAINT "AvailabilityReply_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AvailabilityRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityReply" ADD CONSTRAINT "AvailabilityReply_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityReply" ADD CONSTRAINT "AvailabilityReply_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
