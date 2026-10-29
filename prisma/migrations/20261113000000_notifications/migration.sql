-- Per-user notification choices, and switched-off or reworded automatic messages.
-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "messageTemplates" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyPrefs" JSONB NOT NULL DEFAULT '{}';

