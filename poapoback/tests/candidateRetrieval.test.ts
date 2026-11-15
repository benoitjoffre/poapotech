import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuizAxis } from "@poapo/types";
import { parseAnswerEffects } from "../src/services/answerEffects";
import { DEFAULT_RETRIEVAL, planCandidateSets, RETRIEVAL_LIMITS, RETRIEVAL_STRATEGIES, type RetrievalStrategy } from "../src/services/candidateRetrieval";
import { exactSoftMatches, softDegrees, type EffectProduct, type SelectedAnswer } from "../src/services/effectsEngine";
import { type AnswerForEffects, type EffectsDeps, recommendQuizWithEffects } from "../src/services/effectsRecommendation";
import { evaluateStrategy } from "./fixtures/retrievalExperiment";
import { fakeEngine } from "./fixtures/fakeEngine";
import { perfumeSeeded } from "./fixtures/selectionFixtures";

const fx = (effect: unknown): SelectedAnswer["effects"] => {
  const parsed = parseAnswerEffects({ v: 1, effects: [effect] });
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.errors.join(";"));
  return parsed.value;
};
const fam = (...values: string[]) => ({ type: "category", criterion: "attribute.famille", mode: "soft", values });
const genre = (value: string) => ({ type: "category", criterion: "attribute.genre", mode: "soft", values: [value] });
const band = (min: number, max: number) => ({ type: "range", criterion: "price", mode: "soft", min, max });
const ans = (...effects: unknown[]): SelectedAnswer[] => effects.map((e, i) => ({ questionId: `q${i}`, effects: fx(e) }));
const PRODUCTS = perfumeSeeded(200, 77) as EffectProduct[];
const family = (id: string) => (PRODUCTS.find((p) => p.id === id)!.attributes as Record<string, unknown>).famille;

test("par défaut : stratégie « exact », identique au comportement du lot 10D-2B", () => {
  assert.equal(DEFAULT_RETRIEVAL, "exact");
  const answers = ans(fam("Frais"), band(60, 110));
  assert.deepEqual(planCandidateSets("exact", PRODUCTS, answers).calls, [exactSoftMatches(PRODUCTS, answers)]);
  assert.deepEqual(planCandidateSets("exact", PRODUCTS, ans(fam("Inexistante"))).calls, [], "aucune correspondance exacte : aucun appel supplémentaire");
});

test("toutes les stratégies : sous-ensembles triés et uniques des candidats, déterministes, indépendants de l'ordre, bornés", () => {
  const answers = ans(fam("Frais"), genre("Femme"), band(60, 110));
  const ids = new Set(PRODUCTS.map((p) => p.id));
  for (const strategy of RETRIEVAL_STRATEGIES) {
    const plan = planCandidateSets(strategy, PRODUCTS, answers);
    assert.ok(plan.calls.length <= RETRIEVAL_LIMITS.maxExtraCalls, strategy);
    for (const set of plan.calls) {
      assert.ok(set.length > 0 && set.every((id) => ids.has(id)), strategy);
      assert.deepEqual(set, [...new Set(set)].sort(), `${strategy} : trié et sans doublon`);
    }
    assert.deepEqual(planCandidateSets(strategy, PRODUCTS, answers), plan);
    assert.deepEqual(planCandidateSets(strategy, [...PRODUCTS].reverse(), [...answers].reverse()), plan, `${strategy} : ordre sans effet`);
    assert.equal(new Set(plan.calls.map((s) => s.join(","))).size, plan.calls.length, `${strategy} : aucun appel dupliqué`);
  }
});

test("sans préférence souple : aucun appel supplémentaire, quelle que soit la stratégie", () => {
  for (const strategy of RETRIEVAL_STRATEGIES) assert.deepEqual(planCandidateSets(strategy, PRODUCTS, []).calls, []);
  const strictOnly: SelectedAnswer[] = [{ questionId: "q", effects: fx({ type: "range", criterion: "price", mode: "strict", max: 90 }) }];
  for (const strategy of RETRIEVAL_STRATEGIES) assert.deepEqual(planCandidateSets(strategy, PRODUCTS, strictOnly).calls, []);
});

test("union : aucune alternative contradictoire n'est supprimée en silence", () => {
  const answers = ans(fam("Frais"), fam("Boisé"));
  const single = planCandidateSets("union_single", PRODUCTS, answers).calls;
  assert.equal(single.length, 1);
  assert.ok(single[0].some((id) => family(id) === "Frais") && single[0].some((id) => family(id) === "Boisé"));
  const quota = planCandidateSets("union_quota", PRODUCTS, answers).calls;
  assert.equal(quota.length, 2, "une préférence = un appel");
  assert.ok(quota.every((set) => new Set(set.map(family)).size === 1));
  assert.deepEqual(new Set(quota.map((set) => family(set[0]))), new Set(["Frais", "Boisé"]));
});

test("préférence fréquente : l'union simple est dominée par elle, le quota garde la préférence rare", () => {
  const catalog: EffectProduct[] = Array.from({ length: 100 }, (_, i) => ({ id: `x${String(i).padStart(3, "0")}`, price: 50 + i, attributes: { famille: i < 3 ? "Rare" : i < 10 ? "Autre" : "Commune" } }));
  const answers = ans(fam("Commune"), fam("Rare"));
  const single = planCandidateSets("union_single", catalog, answers).calls[0];
  assert.equal(single.length, 93, "union simple : 90 produits communs pour 3 rares, le Top 10 du moteur peut ne contenir aucun produit rare");
  const quota = planCandidateSets("union_quota", catalog, answers).calls;
  assert.deepEqual(quota[0], ["x000", "x001", "x002"], "la préférence la plus rare est interrogée seule, en premier");
});

test("couverture pondérée : paliers complets, aucun produit coupé au milieu d'un palier, aucune correspondance parfaite exigée", () => {
  const answers = ans(fam("Frais"), genre("Femme"), band(60, 110));
  const { calls: [pool] } = planCandidateSets("weighted", PRODUCTS, answers, { poolSize: 30 });
  assert.ok(pool.length >= 30);
  const degrees = softDegrees(PRODUCTS, answers).byProduct;
  const coverage = (id: string) => degrees.get(id)!.perCriterion.reduce((s, x) => s + x, 0) / 3;
  const inside = new Set(pool);
  const worstInside = Math.min(...pool.map(coverage));
  assert.ok(PRODUCTS.filter((p) => !inside.has(p.id)).every((p) => coverage(p.id) < worstInside + 1e-9 && !(Math.abs(coverage(p.id) - worstInside) < 1e-9)), "tout produit de même couverture que le plus faible retenu est retenu");
  assert.ok(pool.some((id) => coverage(id) < 1), "des compromis (correspondance partielle) sont inclus quand les correspondances parfaites manquent");
});

test("adaptive : exact seul s'il y a assez de correspondances complètes, sinon exact + compromis", () => {
  const rich = ans(fam("Frais"));
  assert.equal(planCandidateSets("adaptive", PRODUCTS, rich).calls.length, 1);
  const sparse = ans(fam("Frais"), genre("Homme"), band(60, 62));
  const exact = exactSoftMatches(PRODUCTS, sparse);
  assert.ok(exact.length < RETRIEVAL_LIMITS.minExact, `fixture : ${exact.length} correspondances complètes`);
  const plan = planCandidateSets("adaptive", PRODUCTS, sparse);
  assert.ok(plan.calls.length > 1 || exact.length === 0);
  assert.ok(plan.calls.length >= 2, "les compromis sont interrogés");
});

// ─── Intégration au traitement des effets ─────────────────────────────────────

const AXES: QuizAxis[] = ["freshness", "woody", "sweetness", "intensity"].map((key) => ({ key, label: key, lowLabel: null, highLabel: null }));
const answerRaw = (q: string, effects: unknown): AnswerForEffects => ({ questionId: q, impacts: { freshness: 0.25 }, effects: { v: 1, effects: [effects] } });
function pipeline(options: Parameters<typeof fakeEngine>[1] = {}) {
  const engine = fakeEngine(PRODUCTS, options);
  const deps: EffectsDeps = {
    recommend: engine.recommend,
    loadProducts: async ({ productIds }) => PRODUCTS.filter((p) => !productIds || productIds.includes(p.id)),
    loadProduct: async ({ productId }) => ({ id: productId, name: productId, brand: null, description: null, price: null, imageUrl: null, purchaseUrl: null, tags: [], attributes: PRODUCTS.find((p) => p.id === productId)!.attributes as object }) as never,
  };
  return { engine, deps };
}
const INPUT = { tenantId: "t", catalogId: "c", industry: "", axes: AXES };
const priceOf = (id: string) => PRODUCTS.find((p) => p.id === id)!.price!;

test("contraintes strictes jamais contournées, quelle que soit la stratégie de récupération", async () => {
  const cap = [...PRODUCTS].map((p) => p.price!).sort((a, b) => a - b)[80];
  for (const strategy of RETRIEVAL_STRATEGIES) {
    const { engine, deps } = pipeline();
    const result = await recommendQuizWithEffects({ ...INPUT, answers: [
      answerRaw("q0", { type: "range", criterion: "price", mode: "strict", max: cap }), answerRaw("q1", fam("Frais")), answerRaw("q2", genre("Femme")),
    ] }, deps, { retrieval: strategy });
    assert.ok(priceOf(result.product.id) <= cap, strategy);
    assert.equal(result.diagnostics!.retrieval, strategy);
    for (const call of engine.calls) assert.ok(call.productIds!.every((id) => priceOf(id) <= cap), `${strategy} : aucun produit hors plafond envoyé`);
  }
});

test("stratégie par défaut inchangée : même nombre d'appels et même résultat qu'avant", async () => {
  const answers = [answerRaw("q0", fam("Frais"))];
  const a = pipeline(); const withDefault = await recommendQuizWithEffects({ ...INPUT, answers }, a.deps);
  const b = pipeline(); const explicit = await recommendQuizWithEffects({ ...INPUT, answers }, b.deps, { retrieval: "exact" });
  assert.equal(a.engine.calls.length, 2);
  assert.deepEqual(a.engine.calls, b.engine.calls);
  assert.equal(withDefault.product.id, explicit.product.id);
  assert.equal(withDefault.diagnostics!.retrieval, "exact");
});

test("plusieurs appels supplémentaires : un échec dégrade visiblement mais conserve le premier appel et les autres", async () => {
  const answers = [answerRaw("q0", fam("Frais")), answerRaw("q1", fam("Boisé"))];
  const ok = pipeline(); const reference = await recommendQuizWithEffects({ ...INPUT, answers }, ok.deps, { retrieval: "union_quota" });
  assert.equal(ok.engine.calls.length, 3);
  assert.deepEqual(reference.diagnostics!.degraded, []);
  assert.equal(reference.diagnostics!.extraCalls!.length, 2);
  const failing = pipeline({ failCall: 3 });
  const result = await recommendQuizWithEffects({ ...INPUT, answers }, failing.deps, { retrieval: "union_quota" });
  assert.deepEqual(result.diagnostics!.degraded, ["second_call_failed"]);
  assert.equal(result.diagnostics!.extraCalls!.filter((c) => "failed" in c).length, 1);
  assert.ok(result.product.id);
  const allFail = pipeline();
  allFail.deps.recommend = async (request) => { if (request.topN === 10 && request.productIds && request.productIds.length < PRODUCTS.length) throw new Error("panne"); return pipeline().engine.recommend(request); };
  const degraded = await recommendQuizWithEffects({ ...INPUT, answers }, allFail.deps, { retrieval: "union_quota" });
  assert.ok(degraded.diagnostics!.degraded.includes("second_call_failed"), "résultat du premier appel conservé");
});

test("déterminisme du traitement complet avec une autre stratégie", async () => {
  const answers = [answerRaw("q0", fam("Frais")), answerRaw("q1", genre("Femme"))];
  const run = async (list: EffectProduct[]) => {
    const engine = fakeEngine(list);
    const deps: EffectsDeps = { recommend: engine.recommend, loadProducts: async () => list, loadProduct: async ({ productId }) => ({ id: productId, attributes: {} }) as never };
    const r = await recommendQuizWithEffects({ ...INPUT, answers }, deps, { retrieval: "adaptive" });
    return [r.product.id, r.diagnostics!.merged, r.diagnostics!.duplicates];
  };
  assert.deepEqual(await run(PRODUCTS), await run([...PRODUCTS].reverse()));
});

test("expérience : reproductible, et les métriques indépendantes de la correspondance catégorielle sont calculées", () => {
  const a = evaluateStrategy(40, "compatibles", "exact", 1);
  const b = evaluateStrategy(40, "compatibles", "exact", 1);
  assert.deepEqual({ ...a, nodeMs: 0 }, { ...b, nodeMs: 0 });
  for (const key of ["top1", "top3", "coverage", "diversity", "engineLoss", "axisPct", "prefSat"] as const) assert.ok(a[key] >= 0 && a[key] <= 1, key);
  const unconstrained = evaluateStrategy(40, "compatibles", "tous", 1);
  assert.ok(unconstrained.prefSat >= a.prefSat - 1e-9);
  const strategies: RetrievalStrategy[] = [...RETRIEVAL_STRATEGIES];
  assert.ok(strategies.length >= 5);
});
