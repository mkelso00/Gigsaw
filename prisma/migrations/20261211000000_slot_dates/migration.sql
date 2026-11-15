-- A weekly slot's first and last dates ("YYYY-MM-DD"). Existing slots have neither, so they run as before.
ALTER TABLE "VenueSlot" ADD COLUMN "startsOn" TEXT;
ALTER TABLE "VenueSlot" ADD COLUMN "endsOn" TEXT;
