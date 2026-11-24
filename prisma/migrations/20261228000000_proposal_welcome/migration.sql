-- The opening message at the top of every proposal (blank: the default wording).
ALTER TABLE "Settings" ADD COLUMN "proposalWelcome" TEXT NOT NULL DEFAULT '';
