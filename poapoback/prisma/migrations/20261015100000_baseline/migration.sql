-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "GenderTarget" AS ENUM ('male', 'female', 'unisex');

-- CreateEnum
CREATE TYPE "PriceTier" AS ENUM ('entry', 'mid', 'luxury', 'niche');

-- CreateEnum
CREATE TYPE "Concentration" AS ENUM ('EDT', 'EDP', 'Parfum', 'EDC', 'other');

-- CreateEnum
CREATE TYPE "Season" AS ENUM ('spring', 'summer', 'autumn', 'winter');

-- CreateEnum
CREATE TYPE "Occasion" AS ENUM ('daily', 'evening', 'office', 'sport', 'special');

-- CreateEnum
CREATE TYPE "TimeOfDay" AS ENUM ('morning', 'afternoon', 'evening', 'night');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('single', 'multi', 'scale');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('positive', 'negative');

-- CreateEnum
CREATE TYPE "MetricType" AS ENUM ('quiz_start', 'quiz_complete', 'quiz_abandon', 'step_view', 'step_answer', 'buy_click', 'feedback', 'decision_time');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT,
    "primaryColor" TEXT DEFAULT '#0d9488',
    "logoUrl" TEXT,
    "quizTitle" TEXT DEFAULT 'Trouve ton parfum idéal',
    "ctaText" TEXT DEFAULT 'Commencer le quiz',
    "embedDomain" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "description" TEXT,
    "price" DOUBLE PRECISION,
    "priceTier" "PriceTier",
    "imageUrl" TEXT,
    "purchaseUrl" TEXT,
    "concentration" "Concentration",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "topNotes" TEXT[],
    "heartNotes" TEXT[],
    "baseNotes" TEXT[],
    "olfactoryFamily" TEXT,
    "subFamily" TEXT,
    "genderTarget" "GenderTarget",
    "tags" TEXT[],
    "freshness" DOUBLE PRECISION,
    "intensity" DOUBLE PRECISION,
    "sweetness" DOUBLE PRECISION,
    "seasons" "Season"[],
    "occasions" "Occasion"[],
    "timeOfDay" "TimeOfDay"[],
    "embedding" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "helpText" TEXT,
    "type" "QuestionType" NOT NULL DEFAULT 'single',
    "imageUrl" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "conditionAnswerId" TEXT,
    "abVariant" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "emoji" TEXT,
    "imageUrl" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "impacts" JSONB NOT NULL DEFAULT '{"freshness":0,"intensity":0,"sweetness":0}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "gender" "GenderTarget",
    "mood" TEXT,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "resultProductId" TEXT,
    "feedback" "FeedbackType",
    "feedbackReasons" TEXT[],
    "decisionTime" INTEGER,
    "abVariant" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Metric" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "MetricType" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Metric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_email_key" ON "Tenant"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MagicToken_tokenHash_key" ON "MagicToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MagicToken_tokenHash_idx" ON "MagicToken"("tokenHash");

-- CreateIndex
CREATE INDEX "Product_tenantId_idx" ON "Product"("tenantId");

-- CreateIndex
CREATE INDEX "Product_tenantId_active_idx" ON "Product"("tenantId", "active");

-- CreateIndex
CREATE INDEX "Question_tenantId_order_idx" ON "Question"("tenantId", "order");

-- CreateIndex
CREATE INDEX "Question_conditionAnswerId_idx" ON "Question"("conditionAnswerId");

-- CreateIndex
CREATE INDEX "Answer_questionId_idx" ON "Answer"("questionId");

-- CreateIndex
CREATE INDEX "QuizSession_tenantId_idx" ON "QuizSession"("tenantId");

-- CreateIndex
CREATE INDEX "QuizSession_tenantId_createdAt_idx" ON "QuizSession"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Metric_tenantId_type_idx" ON "Metric"("tenantId", "type");

-- CreateIndex
CREATE INDEX "Metric_tenantId_createdAt_idx" ON "Metric"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "MagicToken" ADD CONSTRAINT "MagicToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_conditionAnswerId_fkey" FOREIGN KEY ("conditionAnswerId") REFERENCES "Answer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_resultProductId_fkey" FOREIGN KEY ("resultProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Metric" ADD CONSTRAINT "Metric_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

