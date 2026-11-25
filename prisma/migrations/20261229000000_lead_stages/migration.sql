-- Leads: when the customer was first contacted, and why a lead is not going ahead.
ALTER TABLE "Enquiry" ADD COLUMN "contactedAt" TIMESTAMP(3);
ALTER TABLE "Enquiry" ADD COLUMN "closedReason" TEXT NOT NULL DEFAULT '';
