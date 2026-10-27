import { prisma } from "../lib/prisma";

/**
 * Entitlements : ce qu'une boutique a le droit de faire selon son plan. Aujourd'hui AUCUNE limite n'est appliquée
 * (null = illimité) et les plans ne sont pas une grille tarifaire : seul le point d'extension est posé.
 * Points d'application futurs (à appeler, jamais à dupliquer) :
 *  - maxCatalogs        → POST /api/catalogs (routes/catalogs.ts)
 *  - maxPublishedExperiences → publication (services/quizPublication.ts)
 *  - maxRecommendationsPerMonth → POST /api/quiz/submit (routes/quiz.ts), compteur sur QuizSession
 *  - features           → garde de route (ex. enrichissement IA, analytics avancés)
 * Un futur webhook de facturation n'aura qu'à écrire Tenant.plan.
 */
export interface Entitlements {
  plan: string;
  maxCatalogs: number | null;
  maxPublishedExperiences: number | null;
  maxRecommendationsPerMonth: number | null;
  features: Record<"aiEnrichment" | "advancedAnalytics" | "campaigns", boolean>;
}

const OPEN: Omit<Entitlements, "plan"> = {
  maxCatalogs: null, maxPublishedExperiences: null, maxRecommendationsPerMonth: null,
  features: { aiEnrichment: true, advancedAnalytics: true, campaigns: true },
};

/** Définitions par plan ; volontairement identiques tant que la grille tarifaire n'est pas décidée. */
const PLANS: Record<string, Omit<Entitlements, "plan">> = { FREE: OPEN };

export function resolveEntitlements(plan: string): Entitlements {
  return { plan, ...(PLANS[plan] ?? OPEN) };
}

export async function entitlementsFor(tenantId: string): Promise<Entitlements> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } });
  return resolveEntitlements(tenant?.plan ?? "FREE");
}

/** true si `current` atteint la limite (null = illimité). Aucune route ne l'applique encore. */
export function limitReached(limit: number | null, current: number): boolean {
  return limit !== null && current >= limit;
}
