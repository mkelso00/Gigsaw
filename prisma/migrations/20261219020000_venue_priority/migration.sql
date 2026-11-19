-- A priority venue is listed first wherever venues are picked.
ALTER TABLE "Venue" ADD COLUMN "priority" BOOLEAN NOT NULL DEFAULT false;
