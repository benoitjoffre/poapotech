BEGIN;

CREATE TABLE "Quiz" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "industry" TEXT NOT NULL DEFAULT 'perfume',
  "quizTitle" TEXT NOT NULL,
  "ctaText" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "useAllProducts" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Quiz_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Quiz_tenantId_id_key" ON "Quiz"("tenantId", "id");
CREATE UNIQUE INDEX "Quiz_one_default_per_tenant" ON "Quiz"("tenantId") WHERE "isDefault" = true;
CREATE INDEX "Quiz_tenantId_idx" ON "Quiz"("tenantId");

INSERT INTO "Quiz" ("id", "tenantId", "name", "industry", "quizTitle", "ctaText", "isDefault", "createdAt", "updatedAt")
SELECT 'default_' || "id", "id", 'Quiz par défaut', "industry",
  CASE WHEN "industry" = 'coffee' AND ("quizTitle" IS NULL OR "quizTitle" = 'Trouve ton parfum idéal')
    THEN 'Trouve ton café idéal' ELSE COALESCE("quizTitle", 'Trouve ton parfum idéal') END,
  CASE WHEN "industry" = 'coffee' AND ("ctaText" IS NULL OR "ctaText" IN ('Voir ce parfum', 'Commencer le quiz'))
    THEN 'Découvrir ma sélection' ELSE COALESCE("ctaText", 'Commencer le quiz') END,
  true, "createdAt", CURRENT_TIMESTAMP
FROM "Tenant";

ALTER TABLE "Question" ADD COLUMN "quizId" TEXT;
ALTER TABLE "QuizSession" ADD COLUMN "quizId" TEXT;
ALTER TABLE "Metric" ADD COLUMN "quizId" TEXT;

UPDATE "Question" SET "quizId" = 'default_' || "tenantId";
UPDATE "QuizSession" SET "quizId" = 'default_' || "tenantId";
UPDATE "Metric" SET "quizId" = 'default_' || "tenantId";

ALTER TABLE "Question" ALTER COLUMN "quizId" SET NOT NULL;
ALTER TABLE "QuizSession" ALTER COLUMN "quizId" SET NOT NULL;
ALTER TABLE "Metric" ALTER COLUMN "quizId" SET NOT NULL;

ALTER TABLE "Question" ADD CONSTRAINT "Question_tenantId_quizId_fkey"
  FOREIGN KEY ("tenantId", "quizId") REFERENCES "Quiz"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_tenantId_quizId_fkey"
  FOREIGN KEY ("tenantId", "quizId") REFERENCES "Quiz"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Metric" ADD CONSTRAINT "Metric_tenantId_quizId_fkey"
  FOREIGN KEY ("tenantId", "quizId") REFERENCES "Quiz"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Question_quizId_order_idx" ON "Question"("quizId", "order");
CREATE INDEX "QuizSession_quizId_createdAt_idx" ON "QuizSession"("quizId", "createdAt");
CREATE INDEX "Metric_quizId_type_createdAt_idx" ON "Metric"("quizId", "type", "createdAt");

CREATE TABLE "QuizProduct" (
  "quizId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  CONSTRAINT "QuizProduct_pkey" PRIMARY KEY ("quizId", "productId"),
  CONSTRAINT "QuizProduct_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QuizProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "QuizProduct_productId_idx" ON "QuizProduct"("productId");

COMMIT;
