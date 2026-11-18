-- Telling acts when a wedding's plan changes, and a contact for acts on every gig.
ALTER TABLE "Event" ADD COLUMN "planChangedAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN "planToldActs" JSONB;
ALTER TABLE "Settings" ADD COLUMN "actContactName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Settings" ADD COLUMN "actContactPhone" TEXT NOT NULL DEFAULT '';
