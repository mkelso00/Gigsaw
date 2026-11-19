-- CreateTable
CREATE TABLE "XeroConnection" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "tenantName" TEXT NOT NULL DEFAULT '',
    "shortCode" TEXT NOT NULL DEFAULT '',
    "tenants" JSONB NOT NULL DEFAULT '[]',
    "refreshTokenEnc" TEXT NOT NULL DEFAULT '',
    "accessTokenEnc" TEXT NOT NULL DEFAULT '',
    "accessTokenExpiresAt" TIMESTAMP(3),
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3),
    "needsReconnect" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT NOT NULL DEFAULT '',
    "salesAccountCode" TEXT NOT NULL DEFAULT '200',
    "taxType" TEXT NOT NULL DEFAULT 'OUTPUT2',
    "dueDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XeroConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "XeroConnection_agencyId_key" ON "XeroConnection"("agencyId");

-- CreateIndex
CREATE INDEX "XeroConnection_connectedById_idx" ON "XeroConnection"("connectedById");

-- AddForeignKey
ALTER TABLE "XeroConnection" ADD CONSTRAINT "XeroConnection_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XeroConnection" ADD CONSTRAINT "XeroConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

