-- Campaign Studio (Sprint 1) : migration purement additive, aucune donnée existante n'est modifiée.

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CampaignOccasion" AS ENUM ('CHRISTMAS', 'VALENTINES_DAY', 'SPRING', 'MOTHERS_DAY', 'BACK_TO_SCHOOL', 'BLACK_FRIDAY', 'PROMOTION', 'PERMANENT', 'CUSTOM');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "occasion" "CampaignOccasion" NOT NULL,
    "occasionLabel" TEXT,
    "description" TEXT,
    "objectives" TEXT[],
    "imageUrl" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_tenantId_status_idx" ON "Campaign"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_quizId_idx" ON "Campaign"("tenantId", "quizId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_quizId_fkey" FOREIGN KEY ("tenantId", "quizId") REFERENCES "Quiz"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

