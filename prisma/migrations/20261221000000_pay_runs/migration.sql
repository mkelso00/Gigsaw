-- The weekly pay run: the week's gigs signed off (which makes the acts' invoices, when a business works that way),
-- what was sent to the business for its records each week (Monday to Sunday), an optional accounts email for the
-- records and the Monday reminder, and the bank file layout.

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "accountsEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankFile" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "actInvoiceMode" TEXT NOT NULL DEFAULT 'AUTO';

-- Data: every business moves to making act invoices when the week is signed off. The one business using act
-- invoices (Suave) asked for this; any other can switch back in Settings, General. New businesses start there too.
UPDATE "Settings" SET "actInvoiceMode" = 'SIGN_OFF';
ALTER TABLE "Settings" ALTER COLUMN "actInvoiceMode" SET DEFAULT 'SIGN_OFF';

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
    "signedOffAt" TIMESTAMP(3),
    "signedOffById" TEXT,
    "signedOffByName" TEXT NOT NULL DEFAULT '',
    "signedOffBookingIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "leftOut" JSONB NOT NULL DEFAULT '[]',
    "signOffs" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayRun_agencyId_weekStart_key" ON "PayRun"("agencyId", "weekStart");

-- AddForeignKey
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
