-- When each act login first had its gigs in a calendar (adding the calendar is now a required step in the act app).
ALTER TABLE "User" ADD COLUMN "calendarAddedAt" TIMESTAMP(3);
-- Logins that already have Google or Outlook connected count as done.
UPDATE "User" SET "calendarAddedAt" = NOW() WHERE "id" IN (SELECT "userId" FROM "CalendarConnection");
