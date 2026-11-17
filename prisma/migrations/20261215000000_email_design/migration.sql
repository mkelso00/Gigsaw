-- How a business's emails look, and its logo for them.
ALTER TABLE "Settings" ADD COLUMN "emailDesign" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "BrandLogo" (
    "agencyId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrandLogo_pkey" PRIMARY KEY ("agencyId")
);

ALTER TABLE "BrandLogo" ADD CONSTRAINT "BrandLogo_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
