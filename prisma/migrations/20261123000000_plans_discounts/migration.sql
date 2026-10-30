-- Plans move from src/lib/plans.ts into the database so the owner can edit them (Owner area → Plans),
-- with the trial length and extra-user prices alongside, and discount codes (Stripe coupons and
-- promotion codes). The plans are seeded with exactly what was in plans.ts, keys unchanged, so
-- nothing changes for businesses already on them.

-- CreateTable
CREATE TABLE "Plan" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "monthlyMinor" INTEGER NOT NULL,
    "yearlyMinor" INTEGER NOT NULL,
    "gigsPerMonth" INTEGER,
    "includedUsers" INTEGER NOT NULL DEFAULT 2,
    "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "public" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "BillingSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "trialDays" INTEGER NOT NULL DEFAULT 30,
    "extraUserMonthlyMinor" INTEGER NOT NULL DEFAULT 2000,
    "extraUserYearlyMinor" INTEGER NOT NULL DEFAULT 20000,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "percentOff" DOUBLE PRECISION,
    "amountOffMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "duration" TEXT NOT NULL,
    "durationMonths" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "planKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stripeCouponId" TEXT NOT NULL,
    "stripePromotionCodeId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_code_key" ON "DiscountCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_stripePromotionCodeId_key" ON "DiscountCode"("stripePromotionCodeId");

-- The plans as they were in src/lib/plans.ts.
INSERT INTO "Plan" ("key", "name", "tagline", "monthlyMinor", "yearlyMinor", "gigsPerMonth", "includedUsers", "highlights", "public", "sortOrder") VALUES
  ('STARTER', 'Starter', 'For a small roster getting organised', 4900, 49000, 50, 2,
    ARRAY['Up to 50 bookings a month', '2 internal users', 'Unlimited acts, venues and customers', 'Act app with check-in'], true, 10),
  ('GROWTH', 'Growth', 'For busy bar circuits and wedding work', 9900, 99000, 200, 2,
    ARRAY['Up to 200 bookings a month', '2 internal users', 'Weddings, planners and automatic emails', 'Venue statements and reports'], true, 20),
  ('AGENCY', 'Agency', 'For agencies running hundreds of bookings', 19900, 199000, NULL, 3,
    ARRAY['Unlimited bookings', '3 internal users', 'Everything in Growth', 'Help moving across from Overture'], true, 30)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "BillingSettings" ("id", "trialDays", "extraUserMonthlyMinor", "extraUserYearlyMinor") VALUES ('default', 30, 2000, 20000)
ON CONFLICT ("id") DO NOTHING;
