import type { AnswerEffects, QuizAxis } from "@poapo/types";
import { performance } from "node:perf_hooks";
import { prisma } from "../lib/prisma";
import { parseAnswerEffects } from "./answerEffects";
import { DEFAULT_RETRIEVAL, planCandidateSets, type RetrievalStrategy } from "./candidateRetrieval";
import {
  hasSoftPreferences, rerankSoft, resolveStrict, SOFT_PREFERENCE_LAMBDA,
  type BonusModel, type EffectProduct, type SelectedAnswer,
} from "./effectsEngine";
import {
  fetchRecommend, recommendQuiz, type EngineRecommendation, type EngineRequest, type RecommendationInput,
} from "./quizRecommendations";
import { computeProfile } from "./scoring";
import { QuizError } from "./quizzes";

/**
 * Traitement des effets de réponses (lot 10D-2B), commun à la soumission publique ET à l'aperçu.
 *
 *   sans effet de filtre ni de préférence → chemin historique `recommendQuiz`, strictement inchangé ;
 *   contraintes strictes → filtrage AVANT le moteur : `no_match` / `unreliable` s'arrêtent sans appel Python ;
 *   préférences souples  → deux appels au moteur (général + produits qui répondent exactement), fusion, re-classement.
 *
 * Le moteur Python n'est pas modifié. Ses scores sont comparables d'un appel à l'autre : le score d'un produit ne dépend que du
 * profil et du produit (vérifié par poapoai/test_recommend_comparability.py) ; une divergence est tout de même détectée à l'exécution.
 */

/** Limite de l'API Python (`topN` ≤ 10). */
export const ENGINE_WINDOW = 10;
const SCORE_TOLERANCE = 1e-9;

export interface AnswerForEffects { questionId: string; impacts: unknown; effects: unknown }

export type EffectsRecommendationInput = Omit<RecommendationInput, "impacts"> & { answers: AnswerForEffects[] };

export interface EffectsDiagnostics {
  path: "legacy" | "strict" | "strict+soft";
  candidates: number;
  firstCall: { ms: number; returned: number } | null;
  secondCall: { ms: number; returned: number; requested: number } | { skipped: true; reason: string } | { failed: true; ms: number; error: string } | null;
  /** Détail des appels supplémentaires quand la stratégie en émet plusieurs (le cas « exact » n'en a qu'un : voir secondCall). */
  extraCalls?: ({ ms: number; returned: number; requested: number } | { failed: true; ms: number; error: string })[];
  retrieval: RetrievalStrategy;
  /** Modèle de bonus utilisé (par défaut : fenêtre λ = 1, formule historique) et, pour un bonus ancré, sa référence. */
  bonus: BonusModel;
  bonusReference?: number;
  totalEngineMs: number;
  merged: number;
  duplicates: number;
  /** Dégradations techniques (jamais masquées) : `second_call_failed`, `scores_not_comparable`. */
  degraded: ("second_call_failed" | "scores_not_comparable")[];
  lambda: number;
  conflicts: string[];
  ignoredPreferences: string[];
}

export interface EffectsRecommendation {
  product: Awaited<ReturnType<typeof recommendQuiz>>["product"];
  explanation: string[];
  profileSummary: Record<string, unknown>;
  /** Classement final (aperçu : plusieurs résultats). Absent sur le chemin historique. */
  ranking?: { id: string; score: number }[];
  /** Absent sur le chemin historique : la réponse publique d'un quiz sans effets ne change pas. */
  selection?: { state: "matched" | "unconstrained"; matched: number; limited: boolean };
  diagnostics?: EffectsDiagnostics;
}

export interface EffectsDeps {
  recommend: (request: EngineRequest) => Promise<EngineRecommendation>;
  loadProducts: (scope: { tenantId: string; catalogId: string; productIds?: string[] }) => Promise<EffectProduct[]>;
  loadProduct: (scope: { tenantId: string; catalogId: string; productId: string }) => Promise<EffectsRecommendation["product"] | null>;
}

const PRODUCT_SELECT = { id: true, name: true, brand: true, description: true, price: true, imageUrl: true, purchaseUrl: true, tags: true, attributes: true } as const;

export const defaultEffectsDeps: EffectsDeps = {
  recommend: fetchRecommend,
  loadProducts: async ({ tenantId, catalogId, productIds }) => (await prisma.product.findMany({
    where: { tenantId, catalogId, active: true, ...(productIds && { id: { in: productIds } }) },
    select: { id: true, price: true, brand: true, tags: true, attributes: true },
    orderBy: { id: "asc" },
  })),
  loadProduct: ({ tenantId, catalogId, productId }) =>
    prisma.product.findFirst({ where: { id: productId, tenantId, catalogId, active: true }, select: PRODUCT_SELECT }),
};

// ─── Explication (port fidèle de poapoai/main.py : axis_value_text et build_explanation) ───

const levelOf = (value: number) => (value >= 0.65 ? "élevé" : value >= 0.4 ? "modéré" : "faible");

function axisValueText(axis: QuizAxis, value: number): string {
  const label = axis.label || axis.key;
  if (value >= 0.65 && axis.highLabel) return axis.highLabel;
  if (value < 0.4 && axis.lowLabel) return axis.lowLabel;
  return `${label} ${levelOf(value)}`;
}

export function explainMatch(profile: Record<string, number>, attributes: unknown, axes: readonly QuizAxis[]): string[] {
  const attrs = attributes && typeof attributes === "object" && !Array.isArray(attributes) ? attributes as Record<string, unknown> : {};
  const matches = axes.flatMap((axis) => {
    const value = attrs[axis.key];
    if (!(axis.key in profile) || typeof value !== "number") return [];
    return [{ gap: Math.abs(profile[axis.key] - value), axis, wanted: profile[axis.key] }];
  }).sort((a, b) => a.gap - b.gap);
  const bullets = matches.slice(0, 3).filter((m) => m.gap <= 0.25).map((m) => `Correspond à ta préférence : ${axisValueText(m.axis, m.wanted)}`);
  return bullets.length ? bullets : ["Le produit le plus proche de tes réponses dans notre sélection"];
}

// ─── Traitement ───────────────────────────────────────────────────────────────

export function parseSelectedAnswers(answers: readonly AnswerForEffects[]): SelectedAnswer[] {
  return answers.map((answer) => {
    const parsed = parseAnswerEffects(answer.effects);
    if (!parsed.ok) {
      // Une contrainte illisible ne doit jamais être ignorée : état explicite, pas de recommandation.
      console.error("[effects] effets illisibles pour la question", answer.questionId, parsed.errors);
      throw new QuizError(422, "Cette recommandation est momentanément indisponible pour ce quiz.", "effects_invalid");
    }
    return { questionId: answer.questionId, effects: parsed.value.effects.length ? parsed.value as AnswerEffects : null };
  });
}

const usesEffects = (selected: readonly SelectedAnswer[]) =>
  selected.some((a) => a.effects?.effects.some((e) => e.type === "category" || e.type === "range"));

export async function recommendQuizWithEffects(
  input: EffectsRecommendationInput,
  deps: EffectsDeps = defaultEffectsDeps,
  options: { lambda?: number; retrieval?: RetrievalStrategy; bonus?: BonusModel; forceEffectsPath?: boolean; resultCount?: number } = {},
): Promise<EffectsRecommendation> {
  const { answers, ...scope } = input;
  const selected = parseSelectedAnswers(answers);
  const impacts = answers.map((a) => a.impacts);

  if (!options.forceEffectsPath && !usesEffects(selected)) {
    // Chemin historique, appelé exactement comme avant ce lot.
    return recommendQuiz({ ...scope, impacts });
  }

  const lambda = options.lambda ?? SOFT_PREFERENCE_LAMBDA;
  const products = await deps.loadProducts({ tenantId: input.tenantId, catalogId: input.catalogId, productIds: input.productIds });
  const strict = resolveStrict(products, selected);
  if (strict.state === "no_match") {
    console.warn("[effects] no_match:", strict.message);
    throw new QuizError(422, "Aucun produit ne correspond à tous vos critères. Modifiez vos réponses pour élargir la sélection.", "no_match");
  }
  if (strict.state === "unreliable") {
    console.warn("[effects] unreliable:", strict.message);
    throw new QuizError(422, "Nous ne pouvons pas garantir l'un de vos critères avec les informations actuelles de cette boutique.", "constraints_unreliable");
  }

  const candidateIds = strict.candidateIds ?? input.productIds;
  const candidates = strict.candidateIds ? products.filter((p) => strict.candidateIds!.includes(p.id)) : products;
  const profile = computeProfile(input.axes, impacts);
  const base = { tenantId: input.tenantId, catalogId: input.catalogId, industry: input.industry, axes: input.axes, profile };
  const selection = { state: strict.state === "ok" ? "matched" as const : "unconstrained" as const, matched: candidates.length, limited: strict.limited };
  const diagnostics: EffectsDiagnostics = {
    path: "strict", candidates: candidates.length, firstCall: null, secondCall: null, totalEngineMs: 0, merged: 0, duplicates: 0,
    degraded: [], lambda, conflicts: [], ignoredPreferences: [], retrieval: options.retrieval ?? DEFAULT_RETRIEVAL,
    bonus: options.bonus ?? { kind: "window_spread", lambda },
  };
  const resultCount = Math.max(1, Math.min(options.resultCount ?? 1, 10));
  const finish = async (winnerId: string, summary: Record<string, unknown>, ranking?: { id: string; score: number }[]): Promise<EffectsRecommendation> => {
    if (input.productIds && !input.productIds.includes(winnerId)) throw new QuizError(502, "Le produit recommandé ne fait pas partie de ce quiz");
    const product = await deps.loadProduct({ tenantId: input.tenantId, catalogId: input.catalogId, productId: winnerId });
    if (!product) throw new QuizError(502, "La recommandation renvoyée ne correspond à aucun produit");
    return { product, explanation: explainMatch(profile, product.attributes, input.axes), profileSummary: summary, selection, diagnostics, ...(ranking && { ranking }) };
  };

  if (!hasSoftPreferences(selected)) {
    const started = performance.now();
    const only = await deps.recommend({ ...base, productIds: candidateIds, topN: resultCount });
    diagnostics.firstCall = { ms: performance.now() - started, returned: only.topN?.length ?? 1 };
    diagnostics.totalEngineMs = diagnostics.firstCall.ms;
    return finish(only.productId, only.profileSummary, (only.topN ?? []).slice(0, resultCount).map((item) => ({ id: item.id, score: item.score })));
  }

  // Préférences souples : appel général + appel sur les produits qui répondent exactement aux préférences.
  diagnostics.path = "strict+soft";
  const candidateSet = new Set(candidates.map((p) => p.id));
  // Appels supplémentaires choisis par la stratégie de récupération (« exact » par défaut : comportement du lot 10D-2B).
  const plan = planCandidateSets(diagnostics.retrieval, candidates, selected);
  const timed = async (request: EngineRequest) => {
    const started = performance.now();
    try { return { ok: true as const, value: await deps.recommend(request), ms: performance.now() - started }; }
    catch (error) { return { ok: false as const, error, ms: performance.now() - started }; }
  };
  const [first, ...extras] = await Promise.all([
    timed({ ...base, productIds: candidateIds, topN: ENGINE_WINDOW }),
    ...plan.calls.map((ids) => timed({ ...base, productIds: ids, topN: ENGINE_WINDOW })),
  ]);
  diagnostics.totalEngineMs = Math.max(first.ms, ...extras.map((x) => x.ms));
  if (!first.ok) throw first.error;
  diagnostics.firstCall = { ms: first.ms, returned: first.value.topN.length };

  let window = first.value.topN.map((item) => ({ id: item.id, score: item.score }));
  const known = new Map(window.map((item) => [item.id, item.score]));
  const details: NonNullable<EffectsDiagnostics["extraCalls"]> = [];
  extras.forEach((extra, index) => {
    if (!extra.ok) {
      // Dégradation visible : on garde le premier appel et les appels réussis, toujours limités aux produits autorisés.
      const error = extra.error instanceof Error ? extra.error.message : String(extra.error);
      details.push({ failed: true, ms: extra.ms, error });
      if (!diagnostics.degraded.includes("second_call_failed")) diagnostics.degraded.push("second_call_failed");
      console.error("[effects] appel supplémentaire en échec — autres résultats conservés:", error);
      return;
    }
    details.push({ ms: extra.ms, returned: extra.value.topN.length, requested: plan.calls[index].length });
    const incomparable = extra.value.topN.some((item) => known.has(item.id) && Math.abs(known.get(item.id)! - item.score) > SCORE_TOLERANCE);
    if (incomparable) {
      // Jamais de fusion naïve de scores qui ne sont pas comparables.
      if (!diagnostics.degraded.includes("scores_not_comparable")) diagnostics.degraded.push("scores_not_comparable");
      console.error("[effects] scores incomparables entre deux appels — fusion de cet appel abandonnée");
      return;
    }
    for (const item of extra.value.topN) {
      if (known.has(item.id)) diagnostics.duplicates++;
      else { known.set(item.id, item.score); window.push({ id: item.id, score: item.score }); }
    }
  });
  if (!plan.calls.length) diagnostics.secondCall = { skipped: true, reason: "aucun produit supplémentaire à interroger pour ces préférences" };
  else if (plan.calls.length === 1) diagnostics.secondCall = details[0];
  else {
    const ok = details.filter((d): d is { ms: number; returned: number; requested: number } => !("failed" in d));
    diagnostics.secondCall = ok.length
      ? { ms: Math.max(...ok.map((d) => d.ms)), returned: ok.reduce((s, d) => s + d.returned, 0), requested: ok.reduce((s, d) => s + d.requested, 0) }
      : { failed: true, ms: Math.max(...details.map((d) => d.ms)), error: "tous les appels supplémentaires ont échoué" };
    diagnostics.extraCalls = details;
  }
  // Seuls des produits autorisés peuvent entrer dans la fenêtre (le moteur filtre déjà, on le vérifie).
  window = window.filter((item) => candidateSet.has(item.id));
  diagnostics.merged = window.length;
  // Référence d'un bonus ancré : écart des scores du PREMIER appel seul (identique quelle que soit la stratégie de récupération).
  const firstScores = first.value.topN.map((item) => item.score);
  const reference = firstScores.length ? Math.max(...firstScores) - Math.min(...firstScores) : 0;
  if (diagnostics.bonus.kind === "anchored") diagnostics.bonusReference = reference;
  const ranked = rerankSoft(window, candidates, selected, { bonus: diagnostics.bonus, reference });
  diagnostics.conflicts = ranked.conflicts;
  diagnostics.ignoredPreferences = ranked.ignored;
  if (!ranked.ranked.length) throw new QuizError(502, "Le moteur de recommandation n'a pas pu calculer le résultat. Réessayez dans un instant.");
  return finish(ranked.ranked[0].id, first.value.profileSummary, ranked.ranked.slice(0, resultCount).map((item) => ({ id: item.id, score: item.adjusted })));
}
