ALTER TABLE "Tenant"
ADD COLUMN "industry" TEXT NOT NULL DEFAULT 'perfume';

ALTER TABLE "Product"
ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '{}'::jsonb;
