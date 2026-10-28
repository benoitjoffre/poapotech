-- Abonnements sans paiement : additif uniquement (Tenant.plan est conservé mais n'est plus lu).
CREATE TYPE "SubscriptionPlan" AS ENUM ('STARTER', 'PRO', 'BUSINESS');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELED');
CREATE TYPE "SubscriptionSource" AS ENUM ('SIGNUP', 'PROMO', 'LEGACY', 'STRIPE');

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'STARTER',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "SubscriptionSource" NOT NULL DEFAULT 'SIGNUP',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubscriptionEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromPlan" "SubscriptionPlan",
    "toPlan" "SubscriptionPlan" NOT NULL,
    "fromSource" "SubscriptionSource",
    "toSource" "SubscriptionSource" NOT NULL,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageCounter" (
    "tenantId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "recommendations" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("tenantId", "period")
);

CREATE TABLE "RecommendationRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecommendationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");
CREATE INDEX "SubscriptionEvent_tenantId_createdAt_idx" ON "SubscriptionEvent"("tenantId", "createdAt");
CREATE UNIQUE INDEX "RecommendationRequest_tenantId_idempotencyKey_key" ON "RecommendationRequest"("tenantId", "idempotencyKey");
CREATE INDEX "RecommendationRequest_createdAt_idx" ON "RecommendationRequest"("createdAt");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationRequest" ADD CONSTRAINT "RecommendationRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenants existants : BUSINESS / LEGACY sans échéance (préserve les pilotes). Idempotent.
INSERT INTO "Subscription" ("id", "tenantId", "plan", "status", "source", "updatedAt")
SELECT 'sub_' || t."id", t."id", 'BUSINESS', 'ACTIVE', 'LEGACY', CURRENT_TIMESTAMP FROM "Tenant" t
ON CONFLICT ("tenantId") DO NOTHING;

INSERT INTO "SubscriptionEvent" ("id", "tenantId", "actor", "action", "toPlan", "toSource")
SELECT 'evt_' || t."id", t."id", 'system', 'CREATED', 'BUSINESS', 'LEGACY' FROM "Tenant" t
ON CONFLICT ("id") DO NOTHING;
