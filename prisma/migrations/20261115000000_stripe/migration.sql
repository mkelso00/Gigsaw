-- Self-service subscriptions through Stripe: plan, trial and subscription state per business.
-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "billingInterval" TEXT NOT NULL DEFAULT 'month',
ADD COLUMN     "billingMode" TEXT NOT NULL DEFAULT 'INVOICE',
ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "plan" TEXT,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "subscriptionStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Agency_stripeCustomerId_key" ON "Agency"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Agency_stripeSubscriptionId_key" ON "Agency"("stripeSubscriptionId");

