import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { FEATURE_LABELS, PLAN_CATALOG, PLAN_ORDER, type FeatureKey, type QuotaKey } from "./planCatalog";
import { effectiveSubscription, type EffectiveSubscription } from "./subscriptions";
import { QuizError } from "./quizzes";

/**
 * Entitlements : ce qu'une boutique a le droit de faire. Point UNIQUE de décision pour les droits et quotas
 * (jamais de `if (plan === ...)` dans les routes). Lit l'abonnement effectif (subscriptions.ts) et le catalogue (planCatalog.ts).
 * Un futur webhook de facturation n'écrira que Subscription.
 */
type Db = Prisma.TransactionClient | typeof prisma;

export interface Entitlements {
  plan: string;
  limits: Record<QuotaKey, number | null>;
  features: Record<FeatureKey, boolean>;
  // Alias historiques lus par le client (/api/auth/me).
  maxCatalogs: number | null;
  maxPublishedExperiences: number | null;
  maxRecommendationsPerMonth: number | null;
}

/** Erreur métier structurée : `code` stable pour le client, `details` réservé aux routes authentifiées. */
export class EntitlementError extends QuizError {
  constructor(message: string, public code: "quota_exceeded" | "feature_not_included", public details: Record<string, unknown> = {}) {
    super(403, message);
    this.name = "EntitlementError";
  }
}

export function entitlementsOf(sub: EffectiveSubscription): Entitlements {
  const def = PLAN_CATALOG[sub.plan];
  return {
    plan: sub.plan, limits: def.limits, features: def.features,
    maxCatalogs: def.limits.catalogs, maxPublishedExperiences: def.limits.publishedExperiences,
    maxRecommendationsPerMonth: def.limits.recommendationsPerMonth,
  };
}

export async function entitlementsFor(tenantId: string, now = new Date(), db: Db = prisma): Promise<Entitlements> {
  return entitlementsOf(await effectiveSubscription(tenantId, now, db));
}

/** true si `current` atteint la limite (null = illimité). */
export function limitReached(limit: number | null, current: number): boolean {
  return limit !== null && current >= limit;
}

export async function assertFeature(tenantId: string, feature: FeatureKey, db: Db = prisma): Promise<void> {
  const ent = await entitlementsFor(tenantId, new Date(), db);
  if (!ent.features[feature]) {
    throw new EntitlementError(`« ${FEATURE_LABELS[feature]} » n'est pas inclus dans votre formule actuelle`, "feature_not_included", { feature, plan: ent.plan });
  }
}

/** Middleware de garde de fonctionnalité ; `methods` restreint la garde (les ressources existantes restent consultables). */
export const requireFeature = (feature: FeatureKey, methods: string[] = ["POST", "PUT", "PATCH", "DELETE"]) =>
  (req: { method: string; tenant?: { tenantId: string; isSuperAdmin?: boolean } }, _res: unknown, next: (err?: unknown) => void) => {
    if (!methods.includes(req.method) || !req.tenant || req.tenant.isSuperAdmin) return next();
    assertFeature(req.tenant.tenantId, feature).then(() => next(), next);
  };

const periodOf = (now: Date) => now.toISOString().slice(0, 7); // UTC « YYYY-MM »
export const nextPeriodStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

export async function countUsage(tenantId: string, db: Db = prisma, now = new Date()) {
  const [catalogs, publishedExperiences, counter] = await Promise.all([
    db.catalog.count({ where: { tenantId } }),
    db.quiz.count({ where: { tenantId, active: true } }),
    db.usageCounter.findUnique({ where: { tenantId_period: { tenantId, period: periodOf(now) } } }),
  ]);
  return { catalogs, publishedExperiences, recommendationsPerMonth: counter?.recommendations ?? 0 };
}

/**
 * Quota de ressources (catalogues, expériences publiées) : à appeler DANS la transaction qui crée/active la ressource,
 * après withTenantLock, pour que deux créations concurrentes ne dépassent pas la limite.
 */
export async function assertResourceQuota(db: Db, tenantId: string, quota: "catalogs" | "publishedExperiences"): Promise<void> {
  const ent = await entitlementsFor(tenantId, new Date(), db);
  const limit = ent.limits[quota];
  if (limit === null) return;
  const used = (await countUsage(tenantId, db))[quota];
  if (limitReached(limit, used)) {
    const what = quota === "catalogs" ? "de catalogues" : "d'expériences publiées";
    throw new EntitlementError(`Limite ${what} atteinte pour votre formule (${limit})`, "quota_exceeded", { quota, limit, used, plan: ent.plan });
  }
}

/** Sérialise les créations de ressources d'une même boutique (verrou de ligne Tenant, tenu jusqu'à la fin de la transaction). */
export async function withTenantLock<T>(tenantId: string, fn: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
    return fn(db);
  });
}

// ── Recommandations ─────────────────────────────────────────────────────────────────────────────────────────
// Consomme UNE unité = une recommandation effectivement servie : session créée dans la même transaction que
// l'incrément. Rien n'est consommé si le calcul échoue, si la soumission est invalide, ni pour /track, /feedback
// ou un retry portant la même clé d'idempotence. Remise à zéro : nouvelle période UTC « YYYY-MM » (nouvelle ligne).

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,100}$/;

export function parseIdempotencyKey(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !IDEMPOTENCY_KEY.test(raw)) throw new QuizError(400, "Clé d'idempotence invalide");
  return raw;
}

/** Empreinte du contenu logique d'une soumission (quiz + réponses), indépendante de l'ordre et du temps de décision. */
export function submissionFingerprint(quizId: string, answers: { questionId: string; answerId: string }[]): string {
  const canon = answers.map((a) => `${a.questionId}:${a.answerId}`).sort().join("|");
  return createHash("sha256").update(`${quizId}#${canon}`).digest("hex");
}

const keyConflict = () => new QuizError(422, "Cette clé d'idempotence a déjà été utilisée avec un contenu différent");

/** Retry d'une soumission déjà servie : renvoie la réponse stockée sans rien consommer (null si clé inconnue). */
export async function findReplay<T>(tenantId: string, key: string | null, fingerprint: string): Promise<T | null> {
  if (!key) return null;
  const row = await prisma.recommendationRequest.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } } });
  if (!row) return null;
  if (row.fingerprint !== fingerprint) throw keyConflict();
  return (row.response as T | null) ?? null;
}

export async function recordServedRecommendation<T>(p: {
  tenantId: string; key: string | null; fingerprint: string; now?: Date;
  create: (tx: Prisma.TransactionClient) => Promise<T>;
}): Promise<{ response: T; replayed: boolean }> {
  const now = p.now ?? new Date();
  const ent = await entitlementsFor(p.tenantId, now);
  const limit = ent.limits.recommendationsPerMonth;
  const exceeded = (used: number | null) => new EntitlementError(
    "Le quota mensuel de recommandations est atteint", "quota_exceeded", { quota: "recommendationsPerMonth", limit, used, plan: ent.plan });
  if (limit === 0) throw exceeded(0);

  return prisma.$transaction(async (tx) => {
    if (p.key) {
      // Une requête concurrente portant la même clé attend ici la fin de la première transaction.
      const inserted = await tx.$executeRaw`
        INSERT INTO "RecommendationRequest" ("id", "tenantId", "idempotencyKey", "fingerprint")
        VALUES (${randomUUID()}, ${p.tenantId}, ${p.key}, ${p.fingerprint})
        ON CONFLICT ("tenantId", "idempotencyKey") DO NOTHING`;
      if (inserted === 0) {
        const row = await tx.recommendationRequest.findUniqueOrThrow({ where: { tenantId_idempotencyKey: { tenantId: p.tenantId, idempotencyKey: p.key } } });
        if (row.fingerprint !== p.fingerprint) throw keyConflict();
        return { response: row.response as T, replayed: true };
      }
    }
    // Incrément conditionnel atomique : le verrou de ligne sérialise les appels concurrents, la limite ne peut être dépassée.
    const rows = await tx.$queryRaw<{ recommendations: number }[]>`
      INSERT INTO "UsageCounter" ("tenantId", "period", "recommendations")
      VALUES (${p.tenantId}, ${periodOf(now)}, 1)
      ON CONFLICT ("tenantId", "period") DO UPDATE SET "recommendations" = "UsageCounter"."recommendations" + 1
      WHERE ${limit}::int IS NULL OR "UsageCounter"."recommendations" < ${limit}::int
      RETURNING "recommendations"`;
    if (!rows.length) throw exceeded(limit);
    const response = await p.create(tx);
    if (p.key) {
      await tx.recommendationRequest.update({
        where: { tenantId_idempotencyKey: { tenantId: p.tenantId, idempotencyKey: p.key } },
        data: { response: response as unknown as Prisma.InputJsonValue },
      });
    }
    return { response, replayed: false };
  });
}

// ── Vue commerçant ──────────────────────────────────────────────────────────────────────────────────────────
export async function subscriptionOverview(tenantId: string, now = new Date()) {
  const sub = await effectiveSubscription(tenantId, now);
  const ent = entitlementsOf(sub);
  const usage = await countUsage(tenantId, prisma, now);
  return {
    plan: sub.plan, planLabel: PLAN_CATALOG[sub.plan].label, status: sub.status, source: sub.source,
    promotional: sub.promotional, startsAt: sub.startsAt, endsAt: sub.endsAt, previousPlan: sub.storedPlan,
    limits: ent.limits, features: ent.features, usage,
    usagePeriod: { period: periodOf(now), resetsAt: nextPeriodStart(now) },
    plans: PLAN_ORDER.map((id) => ({ id, label: PLAN_CATALOG[id].label, limits: PLAN_CATALOG[id].limits, features: PLAN_CATALOG[id].features })),
    featureLabels: FEATURE_LABELS,
  };
}
