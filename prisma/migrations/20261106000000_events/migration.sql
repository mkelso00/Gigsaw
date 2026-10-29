-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "eventEmails" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reviewLink" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "eventId" TEXT;

-- AlterTable
ALTER TABLE "VenueSlot" ADD COLUMN     "costMinor" INTEGER;

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'WEDDING',
    "date" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/London',
    "customerId" TEXT,
    "venueId" TEXT,
    "venueText" TEXT NOT NULL DEFAULT '',
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT NOT NULL DEFAULT '',
    "guestCount" INTEGER,
    "timeline" TEXT NOT NULL DEFAULT '',
    "dayContact" TEXT NOT NULL DEFAULT '',
    "arrivalInfo" TEXT NOT NULL DEFAULT '',
    "dressCode" TEXT NOT NULL DEFAULT '',
    "meals" TEXT NOT NULL DEFAULT '',
    "songRequests" TEXT NOT NULL DEFAULT '',
    "specialNotes" TEXT NOT NULL DEFAULT '',
    "plannerToken" TEXT,
    "plannerSentAt" TIMESTAMP(3),
    "plannerDoneAt" TIMESTAMP(3),
    "autoEmails" BOOLEAN NOT NULL DEFAULT true,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTask" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "dueDate" TEXT,
    "doneAt" TIMESTAMP(3),
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EventTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActLink" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ActLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Event_plannerToken_key" ON "Event"("plannerToken");

-- CreateIndex
CREATE INDEX "Event_agencyId_date_idx" ON "Event"("agencyId", "date");

-- CreateIndex
CREATE INDEX "EventTask_eventId_idx" ON "EventTask"("eventId");

-- CreateIndex
CREATE INDEX "ActLink_childId_idx" ON "ActLink"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "ActLink_parentId_childId_key" ON "ActLink"("parentId", "childId");

-- CreateIndex
CREATE INDEX "Booking_eventId_idx" ON "Booking"("eventId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTask" ADD CONSTRAINT "EventTask_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActLink" ADD CONSTRAINT "ActLink_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActLink" ADD CONSTRAINT "ActLink_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

