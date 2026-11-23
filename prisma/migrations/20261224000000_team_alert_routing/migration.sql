-- Team alert routing: shared inboxes for weddings and events, and for venue gigs, and where each team alert goes.
-- Businesses already here get an empty map, so every alert keeps going where it goes today (the lead agent, or the
-- business email with no agent). Their own choices are left for them to make in Settings, Notifications.
ALTER TABLE "Settings" ADD COLUMN     "alertRouting" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "eventsEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "gigsEmail" TEXT NOT NULL DEFAULT '';

-- New businesses start with the shared defaults: wedding and event alerts go to the events inbox once it's set.
ALTER TABLE "Settings" ALTER COLUMN "alertRouting" SET DEFAULT '{"_defaults":"SHARED"}';
