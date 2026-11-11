-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_tenantId_quizId_fkey";

-- DropTable
DROP TABLE "Campaign";

-- DropEnum
DROP TYPE "CampaignStatus";

