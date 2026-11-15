import { softDegrees, type EffectProduct, type SelectedAnswer } from "./effectsEngine";

/**
 * Récupération des candidats pour le re-classement des préférences souples (lot 10D-2B.1).
 * Le moteur Python ne renvoie que ses 10 meilleurs produits par appel : le premier appel (tous les candidats autorisés) est
 * complété par des appels sur des sous-ensembles choisis ICI, sans score. Aucune stratégie ne retire un produit du premier appel,
 * aucune n'envoie un produit non autorisé (les `candidates` fournis sont déjà filtrés par les contraintes strictes), aucune ne
 * transforme une préférence souple en contrainte.
 *
 * Stratégies :
 *  - exact          : produits qui répondent à TOUTES les préférences (stratégie du lot 10D-2B, référence) — 1 appel.
 *  - union_single   : produits qui répondent à AU MOINS UNE préférence — 1 appel (une préférence fréquente peut monopoliser le Top 10).
 *  - union_quota    : un appel par préférence (règle) — chaque préférence garde ses 10 meilleurs, fréquente ou rare.
 *  - weighted       : produits les mieux couverts (degrés de correspondance moyens), par paliers complets jusqu'à `poolSize`.
 *  - exact+weighted : exact puis weighted — 2 appels supplémentaires.
 *  - adaptive       : exact seul tant qu'il y a au moins `minExact` correspondances complètes ; sinon exact + un appel par préférence (compromis).
 *  - exact+quota    : exact (correspondances complètes) puis un appel par préférence (compromis) — jusqu'à 4 appels supplémentaires.
 */
export type RetrievalStrategy = "exact" | "union_single" | "union_quota" | "weighted" | "exact+weighted" | "exact+quota" | "adaptive";

/** Stratégie utilisée en production tant qu'une autre n'est pas validée. */
export const DEFAULT_RETRIEVAL: RetrievalStrategy = "exact";
export const RETRIEVAL_STRATEGIES: readonly RetrievalStrategy[] = ["exact", "union_single", "union_quota", "weighted", "exact+weighted", "exact+quota", "adaptive"];

export const RETRIEVAL_LIMITS = {
  /** Taille cible de l'ensemble « mieux couverts » (paliers complets : jamais coupé au milieu d'un palier). */
  poolSize: 40,
  /** Sous ce nombre de correspondances complètes, la stratégie « adaptive » ajoute les compromis (un appel par préférence). */
  minExact: 3,
  /** Appels supplémentaires au plus (en plus de l'appel général). */
  maxExtraCalls: 4,
} as const;

export interface RetrievalPlan {
  /** Un ensemble de productIds par appel supplémentaire, triés, sans doublon, sous-ensembles des candidats. */
  calls: string[][];
}

const EPS = 1e-9;

export function planCandidateSets(
  strategy: RetrievalStrategy,
  candidates: readonly EffectProduct[],
  answers: readonly SelectedAnswer[],
  options: { poolSize?: number; maxExtraCalls?: number } = {},
): RetrievalPlan {
  const poolSize = options.poolSize ?? RETRIEVAL_LIMITS.poolSize;
  const maxExtra = options.maxExtraCalls ?? RETRIEVAL_LIMITS.maxExtraCalls;
  const { criteria, rules, byProduct } = softDegrees(candidates, answers);
  if (!criteria.length) return { calls: [] };
  const ids = (predicate: (d: { perCriterion: number[]; perRule: number[] }) => boolean) =>
    candidates.filter((p) => predicate(byProduct.get(p.id)!)).map((p) => p.id).sort();

  const exact = () => ids((d) => d.perCriterion.every((x) => x >= 1 - EPS));
  const any = () => ids((d) => d.perRule.some((x) => x >= 1 - EPS));
  const weighted = () => {
    const coverage = (id: string) => { const d = byProduct.get(id)!.perCriterion; return d.reduce((s, x) => s + x, 0) / d.length; };
    const ranked = candidates.map((p) => ({ id: p.id, m: coverage(p.id) })).filter((x) => x.m > 0).sort((a, b) => b.m - a.m || a.id.localeCompare(b.id));
    if (!ranked.length) return [];
    let end = Math.min(poolSize, ranked.length);
    while (end < ranked.length && ranked[end].m >= ranked[end - 1].m - EPS) end++; // palier complet
    return ranked.slice(0, end).map((x) => x.id).sort();
  };
  const quota = () => {
    // Une préférence par appel, les plus rares d'abord ; au-delà de la limite, le reste est regroupé dans un dernier appel.
    const sets = rules.map((_, i) => ids((d) => d.perRule[i] >= 1 - EPS)).filter((s) => s.length);
    const unique = [...new Map(sets.map((s) => [s.join(","), s])).values()].sort((a, b) => a.length - b.length || a.join(",").localeCompare(b.join(",")));
    if (unique.length <= maxExtra) return unique;
    const kept = unique.slice(0, maxExtra - 1);
    const rest = [...new Set(unique.slice(maxExtra - 1).flat())].sort();
    return [...kept, rest];
  };

  let calls: string[][];
  switch (strategy) {
    case "exact": calls = [exact()]; break;
    case "union_single": calls = [any()]; break;
    case "union_quota": calls = quota(); break;
    case "weighted": calls = [weighted()]; break;
    case "exact+weighted": calls = [exact(), weighted()]; break;
    case "exact+quota": calls = [exact(), ...quota()]; break;
    case "adaptive": { const full = exact(); calls = full.length >= RETRIEVAL_LIMITS.minExact ? [full] : [full, ...quota()]; break; }
  }
  // Un ensemble vide ou déjà vu n'apporte rien ; hors stratégie « exact » (conservée à l'identique), un ensemble égal à tous les candidats répète l'appel général.
  const seen = new Set<string>();
  const filtered = calls.filter((set) => {
    const key = set.join(",");
    if (!set.length || seen.has(key) || (strategy !== "exact" && set.length === candidates.length)) return false;
    seen.add(key);
    return true;
  });
  return { calls: filtered.slice(0, maxExtra) };
}
