-- Contract types: several saved contracts (e.g. Wedding, Corporate, Musician hire for a small event)
-- in place of the one Settings.contractTerms. A proposal, booking, wedding or event, and a client,
-- can each name the type it uses.

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "contractTemplateId" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "contractTemplateId" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "contractTemplateId" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "contractTemplateId" TEXT;

-- CreateTable
CREATE TABLE "ContractTemplate" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "terms" TEXT NOT NULL DEFAULT '',
    "eventTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractTemplate_agencyId_idx" ON "ContractTemplate"("agencyId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_contractTemplateId_fkey" FOREIGN KEY ("contractTemplateId") REFERENCES "ContractTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_contractTemplateId_fkey" FOREIGN KEY ("contractTemplateId") REFERENCES "ContractTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_contractTemplateId_fkey" FOREIGN KEY ("contractTemplateId") REFERENCES "ContractTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_contractTemplateId_fkey" FOREIGN KEY ("contractTemplateId") REFERENCES "ContractTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractTemplate" ADD CONSTRAINT "ContractTemplate_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- data:start
-- Every business that had contract terms gets them as its one contract type, the default, so its
-- contracts and new proposals carry on with the same wording. Settings.contractTerms stays, unread.
INSERT INTO "ContractTemplate" ("id", "agencyId", "name", "terms", "eventTypes", "isDefault", "sort", "createdAt", "updatedAt")
SELECT 'ct' || md5(random()::text || s."agencyId"), s."agencyId", 'Standard contract', btrim(s."contractTerms", E' \t\r\n'), ARRAY[]::TEXT[], true, 0, NOW(), NOW()
FROM "Settings" s
WHERE btrim(s."contractTerms", E' \t\r\n') <> ''
  AND NOT EXISTS (SELECT 1 FROM "ContractTemplate" t WHERE t."agencyId" = s."agencyId");
-- data:end
