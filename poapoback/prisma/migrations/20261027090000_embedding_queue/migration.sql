-- CreateEnum
CREATE TYPE "EmbeddingStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Product"
  ADD COLUMN "embeddingStatus" "EmbeddingStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "embeddingVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "embeddingAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "embeddingError" TEXT,
  ADD COLUMN "embeddingNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "embeddingLockedUntil" TIMESTAMP(3),
  ADD COLUMN "embeddingUpdatedAt" TIMESTAMP(3);

-- Produits existants : un embedding déjà calculé est prêt, les autres entrent dans la file.
UPDATE "Product"
SET "embeddingStatus" = 'READY', "embeddingUpdatedAt" = "updatedAt"
WHERE jsonb_typeof("embedding") = 'array' AND jsonb_array_length("embedding") > 0;

-- CreateIndex
CREATE INDEX "Product_embeddingStatus_embeddingNextAttemptAt_idx" ON "Product"("embeddingStatus", "embeddingNextAttemptAt");
