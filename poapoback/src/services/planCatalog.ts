import type { SubscriptionPlan } from "@prisma/client";

/**
 * Catalogue des formules : LE fichier à modifier pour changer limites ou fonctionnalités (valeurs provisoires du pilote).
 * null = illimité. Aucune fonctionnalité non développée ne doit y figurer.
 * Aucun prix ici : la facturation est hors périmètre (voir docs/subscriptions.md).
 */
export type FeatureKey = "aiEnrichment" | "advancedAnalytics" | "campaigns";
export type QuotaKey = "catalogs" | "publishedExperiences" | "recommendationsPerMonth";

export interface PlanDefinition {
  label: string;
  limits: Record<QuotaKey, number | null>;
  features: Record<FeatureKey, boolean>;
}

export const PLAN_ORDER: SubscriptionPlan[] = ["STARTER", "PRO", "BUSINESS"];
export const DEFAULT_PLAN: SubscriptionPlan = "STARTER";

export const PLAN_CATALOG: Record<SubscriptionPlan, PlanDefinition> = {
  STARTER: {
    label: "Starter",
    limits: { catalogs: 1, publishedExperiences: 1, recommendationsPerMonth: 100 },
    features: { aiEnrichment: false, advancedAnalytics: false, campaigns: false },
  },
  PRO: {
    label: "Pro",
    limits: { catalogs: 5, publishedExperiences: 10, recommendationsPerMonth: 5000 },
    features: { aiEnrichment: true, advancedAnalytics: true, campaigns: true },
  },
  BUSINESS: {
    label: "Business",
    limits: { catalogs: null, publishedExperiences: null, recommendationsPerMonth: null },
    features: { aiEnrichment: true, advancedAnalytics: true, campaigns: true },
  },
};

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  aiEnrichment: "Enrichissement IA des produits",
  advancedAnalytics: "Analytics avancés",
  campaigns: "Campagnes",
};
