ALTER TABLE "Tenant" ALTER COLUMN "primaryColor" SET DEFAULT '#6C47FF';

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_tenantId_catalogId_fingerprint_idx" ON "ImportBatch"("tenantId", "catalogId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_tenantId_catalogId_key_key" ON "ImportBatch"("tenantId", "catalogId", "key");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_tenantId_catalogId_fkey" FOREIGN KEY ("tenantId", "catalogId") REFERENCES "Catalog"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

