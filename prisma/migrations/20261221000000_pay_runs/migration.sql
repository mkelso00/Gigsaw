-- The weekly pay run: what was sent to the business for its records each week (Monday to Sunday), an optional
-- accounts email for the records and the Monday "ready to check" reminder, and the bank file layout.

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "accountsEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankFile" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "PayRun" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,
    "sentByName" TEXT NOT NULL DEFAULT '',
    "sentInvoiceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentTotalMinor" INTEGER NOT NULL DEFAULT 0,
    "sends" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayRun_agencyId_weekStart_key" ON "PayRun"("agencyId", "weekStart");

-- AddForeignKey
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
