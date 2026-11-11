-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "occasion" "CampaignOccasion",
ADD COLUMN     "occasionLabel" TEXT,
ADD COLUMN     "startsAt" TIMESTAMP(3);
