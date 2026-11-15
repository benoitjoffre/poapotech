/**
 * Moteur de recommandation simulé pour les tests Node : mêmes règles que poapoai/main.py /recommend (vérifiées par
 * poapoai/test_recommend_comparability.py) — score propre à chaque produit (0,6 sémantique + 0,4 axes), `productIds` = filtre strict,
 * topN ≤ 10, ensemble vide = erreur. La partie sémantique est un nombre reproductible dérivé de l'identifiant.
 */
import type { EngineRecommendation, EngineRequest } from "../../src/services/quizRecommendations";
import type { EffectProduct } from "../../src/services/effectsEngine";
import { QuizError } from "../../src/services/quizzes";

export function semantic(id: string, sigma = 0.1): number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return 0.5 + (((h >>> 0) / 4294967296) - 0.5) * 2 * sigma * Math.sqrt(3);
}

export function axialScore(profile: Record<string, number>, attributes: unknown): number {
  const attrs = (attributes && typeof attributes === "object" ? attributes : {}) as Record<string, unknown>;
  const shared = Object.entries(profile).filter(([k]) => typeof attrs[k] === "number") as [string, number][];
  if (!shared.length) return 0;
  return 1 - Math.sqrt(shared.reduce((s, [k, w]) => s + (w - (attrs[k] as number)) ** 2, 0)) / Math.sqrt(shared.length);
}

export interface FakeEngine {
  recommend: (request: EngineRequest) => Promise<EngineRecommendation>;
  calls: EngineRequest[];
}

export function fakeEngine(products: readonly EffectProduct[], options: { latencyMs?: number; failCall?: number; skewSecond?: boolean } = {}): FakeEngine {
  const calls: EngineRequest[] = [];
  return {
    calls,
    async recommend(request) {
      const callNumber = calls.length + 1;
      calls.push(request);
      if (options.latencyMs) await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
      if (options.failCall === callNumber) throw new QuizError(502, "Le moteur de recommandation n'a pas pu calculer le résultat.");
      const ids = request.productIds ? new Set(request.productIds) : null;
      const rows = products.filter((p) => !ids || ids.has(p.id));
      if (!rows.length) throw new QuizError(502, "Aucun produit trouvé");
      const topN = rows
        .map((p) => ({ id: p.id, score: 0.6 * semantic(p.id) + 0.4 * axialScore(request.profile, p.attributes) + (options.skewSecond && callNumber === 2 ? 0.01 : 0) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, request.topN);
      return { productId: topN[0].id, score: topN[0].score, explanation: [], profileSummary: { axes: [] }, topN };
    },
  };
}
