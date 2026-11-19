-- A link that opens the bill's invoice in Xero.
ALTER TABLE "MonthlyBill" ADD COLUMN "xeroUrl" TEXT NOT NULL DEFAULT '';
