-- The business's own wedding and event plan fields (Settings) and their values on each event.
ALTER TABLE "Settings" ADD COLUMN "planExtraFields" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Event" ADD COLUMN "planExtras" JSONB NOT NULL DEFAULT '{}';
