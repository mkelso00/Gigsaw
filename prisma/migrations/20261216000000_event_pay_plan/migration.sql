-- How a wedding or event's customer pays: all to the business, or the deposit to the business and the acts paid direct.
ALTER TABLE "Event" ADD COLUMN "payPlan" TEXT NOT NULL DEFAULT 'FULL';
