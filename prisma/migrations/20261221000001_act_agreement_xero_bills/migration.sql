-- AlterTable
ALTER TABLE "ActInvoice" ADD COLUMN     "selfBillingAgreedAt" TIMESTAMP(3),
ADD COLUMN     "xeroBillId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "xeroBillStatus" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "xeroPaymentId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "xeroProblem" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "selfBillingAgreedAt" TIMESTAMP(3),
ADD COLUMN     "selfBillingAgreedText" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "selfBillingAgreedAt" TIMESTAMP(3),
ADD COLUMN     "selfBillingAgreedText" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "selfBillingAgreementText" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "XeroConnection" ADD COLUMN     "actBillsAuto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "actBillsAutoFrom" TIMESTAMP(3),
ADD COLUMN     "actFeesAccountCode" TEXT NOT NULL DEFAULT '310',
ADD COLUMN     "billStatus" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "payFromBankAccountCode" TEXT NOT NULL DEFAULT '';

