-- Indexes for the busiest lists, the dashboard's activity feed and wedding email checks.
-- DropIndex
DROP INDEX "Booking_slotId_idx";

-- CreateIndex
CREATE INDEX "Booking_agencyId_arriveBy_idx" ON "Booking"("agencyId", "arriveBy");

-- CreateIndex
CREATE INDEX "Booking_slotId_arriveBy_idx" ON "Booking"("slotId", "arriveBy");

-- CreateIndex
CREATE INDEX "Activity_agencyId_createdAt_idx" ON "Activity"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "Reminder_recipient_idx" ON "Reminder"("recipient");

