-- Multi-catalogue : migration additive avec reprise des données.
-- Chaque tenant reçoit un catalogue par défaut ; ses produits et quiz existants y sont rattachés.
-- Aucune ligne existante n'est supprimée.

BEGIN;

-- Contrôle préalable : une sélection QuizProduct ne doit pas mélanger deux tenants.
-- Ces lignes violeraient les nouvelles contraintes : la migration s'arrête au lieu de les supprimer.
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM "QuizProduct" qp
  JOIN "Quiz" q ON q."id" = qp."quizId"
  JOIN "Product" p ON p."id" = qp."productId"
  WHERE q."tenantId" <> p."tenantId";

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'add_catalogs : % sélection(s) QuizProduct associent un quiz et un produit de tenants différents. Corrigez-les avant de migrer.', invalid_count;
  END IF;
END $$;

-- CreateTable
CREATE TABLE "Catalog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Catalog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Catalog_tenantId_idx" ON "Catalog"("tenantId");
CREATE UNIQUE INDEX "Catalog_tenantId_id_key" ON "Catalog"("tenantId", "id");
CREATE UNIQUE INDEX "Catalog_tenantId_name_key" ON "Catalog"("tenantId", "name");
-- Un seul catalogue par défaut par tenant (index partiel non représentable dans schema.prisma).
CREATE UNIQUE INDEX "Catalog_one_default_per_tenant" ON "Catalog"("tenantId") WHERE "isDefault" = true;

ALTER TABLE "Catalog" ADD CONSTRAINT "Catalog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise : un catalogue par défaut pour chaque tenant existant.
INSERT INTO "Catalog" ("id", "tenantId", "name", "isDefault", "createdAt", "updatedAt")
SELECT 'catalog_' || "id", "id", 'Catalogue principal', true, "createdAt", CURRENT_TIMESTAMP
FROM "Tenant";

-- Product et Quiz : colonne ajoutée, remplie avec le catalogue par défaut, puis rendue obligatoire.
ALTER TABLE "Product" ADD COLUMN "catalogId" TEXT;
ALTER TABLE "Quiz" ADD COLUMN "catalogId" TEXT;

UPDATE "Product" SET "catalogId" = 'catalog_' || "tenantId";
UPDATE "Quiz" SET "catalogId" = 'catalog_' || "tenantId";

ALTER TABLE "Product" ALTER COLUMN "catalogId" SET NOT NULL;
ALTER TABLE "Quiz" ALTER COLUMN "catalogId" SET NOT NULL;

CREATE INDEX "Product_tenantId_catalogId_active_idx" ON "Product"("tenantId", "catalogId", "active");
CREATE UNIQUE INDEX "Product_catalogId_id_key" ON "Product"("catalogId", "id");
CREATE INDEX "Quiz_tenantId_catalogId_idx" ON "Quiz"("tenantId", "catalogId");
CREATE UNIQUE INDEX "Quiz_catalogId_id_key" ON "Quiz"("catalogId", "id");

-- Le catalogue d'un produit ou d'un quiz appartient forcément au même tenant.
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_tenantId_catalogId_fkey" FOREIGN KEY ("tenantId", "catalogId") REFERENCES "Catalog"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_catalogId_fkey" FOREIGN KEY ("tenantId", "catalogId") REFERENCES "Catalog"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- QuizProduct : le catalogue est repris du quiz, puis deux clés composites imposent
-- que le quiz et le produit sélectionné partagent ce même catalogue.
ALTER TABLE "QuizProduct" ADD COLUMN "catalogId" TEXT;
UPDATE "QuizProduct" qp SET "catalogId" = q."catalogId" FROM "Quiz" q WHERE q."id" = qp."quizId";
ALTER TABLE "QuizProduct" ALTER COLUMN "catalogId" SET NOT NULL;

ALTER TABLE "QuizProduct" DROP CONSTRAINT "QuizProduct_productId_fkey";
ALTER TABLE "QuizProduct" DROP CONSTRAINT "QuizProduct_quizId_fkey";

ALTER TABLE "QuizProduct" ADD CONSTRAINT "QuizProduct_catalogId_quizId_fkey" FOREIGN KEY ("catalogId", "quizId") REFERENCES "Quiz"("catalogId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuizProduct" ADD CONSTRAINT "QuizProduct_catalogId_productId_fkey" FOREIGN KEY ("catalogId", "productId") REFERENCES "Product"("catalogId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
