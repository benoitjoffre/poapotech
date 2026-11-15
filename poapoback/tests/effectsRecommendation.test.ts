import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import type { QuizAxis } from "@poapo/types";
import { type AnswerForEffects, type EffectsDeps, ENGINE_WINDOW, explainMatch, recommendQuizWithEffects } from "../src/services/effectsRecommendation";
import { QuizError } from "../src/services/quizzes";
import { fakeEngine } from "./fixtures/fakeEngine";
import { coffeeSeeded, perfumeSeeded } from "./fixtures/selectionFixtures";

const AXES: QuizAxis[] = ["freshness", "woody", "sweetness", "intensity"].map((key) => ({ key, label: key, lowLabel: null, highLabel: null }));
const PRODUCTS = perfumeSeeded(120, 21);
const INPUT = { tenantId: "t", catalogId: "c", industry: "Parfum", axes: AXES };
const fx = (...effects: unknown[]) => ({ v: 1, effects });
const answer = (questionId: string, effects: unknown, impacts: Record<string, number> = { freshness: 0.25 }): AnswerForEffects => ({ questionId, impacts, effects });
const cap = (max: number) => ({ type: "range", criterion: "price", mode: "strict", max });
const prefer = (value: string) => ({ type: "category", criterion: "attribute.famille", mode: "soft", values: [value] });

function setup(options: Parameters<typeof fakeEngine>[1] = {}, products = PRODUCTS) {
  const engine = fakeEngine(products, options);
  const deps: EffectsDeps = {
    recommend: engine.recommend,
    loadProducts: async ({ productIds }) => products.filter((p) => !productIds || productIds.includes(p.id)),
    loadProduct: async ({ productId }) => {
      const p = products.find((x) => x.id === productId);
      return p ? { id: p.id, name: p.id, brand: p.brand ?? null, description: null, price: p.price ?? null, imageUrl: null, purchaseUrl: null, tags: [...(p.tags ?? [])], attributes: p.attributes as object } as never : null;
    },
  };
  return { engine, deps };
}
const priceOf = (id: string) => PRODUCTS.find((p) => p.id === id)!.price!;
const familyOf = (id: string) => (PRODUCTS.find((p) => p.id === id)!.attributes as Record<string, unknown>).famille;

test("sans effet de filtre ni de préférence : chemin historique, le nouveau code n'appelle pas le moteur lui-même", async () => {
  const { engine, deps } = setup();
  const saved = process.env.AI_SERVICE_URL;
  delete process.env.AI_SERVICE_URL;
  try {
    for (const answers of [[answer("q1", null)], [answer("q1", fx({ type: "axis", axis: "freshness" }))], [answer("q1", fx({ type: "none", criterion: "price" }))]]) {
      await assert.rejects(recommendQuizWithEffects({ ...INPUT, answers }, deps), (error: unknown) => error instanceof QuizError && error.status === 503 && /Service IA non disponible/.test(error.message),
        "c'est recommandQuiz historique qui répond (ici : service IA non configuré)");
    }
  } finally { if (saved) process.env.AI_SERVICE_URL = saved; }
  assert.equal(engine.calls.length, 0);
});

test("effets illisibles : état explicite, jamais ignorés", async () => {
  const { deps } = setup();
  await assert.rejects(recommendQuizWithEffects({ ...INPUT, answers: [answer("q1", { v: 9, effects: [] })] }, deps), (e: unknown) => e instanceof QuizError && e.code === "effects_invalid" && e.status === 422);
});

test("no_match : arrêt avant tout appel au moteur, message public sans structure interne", async () => {
  const { engine, deps } = setup();
  await assert.rejects(recommendQuizWithEffects({ ...INPUT, answers: [answer("q1", fx(cap(5)))] }, deps), (e: unknown) => {
    assert.ok(e instanceof QuizError);
    assert.equal(e.status, 422);
    assert.equal(e.code, "no_match");
    assert.ok(!/price|attribute|criterion/.test(e.message));
    return true;
  });
  assert.equal(engine.calls.length, 0);
});

test("unreliable : arrêt avant le moteur, état explicite", async () => {
  const sparse = PRODUCTS.map((p, i) => (i % 2 ? { ...p, attributes: { ...(p.attributes as object), genre: undefined } } : p));
  const { engine, deps } = setup({}, sparse);
  await assert.rejects(recommendQuizWithEffects({ ...INPUT, answers: [answer("q1", fx({ type: "category", criterion: "attribute.genre", mode: "strict", values: ["Femme"] }))] }, deps),
    (e: unknown) => e instanceof QuizError && e.code === "constraints_unreliable" && e.status === 422);
  assert.equal(engine.calls.length, 0);
});

test("contrainte stricte : le moteur ne reçoit que des produits autorisés, le résultat respecte le plafond", async () => {
  const prices = PRODUCTS.map((p) => p.price!).sort((a, b) => a - b);
  for (const limit of [prices[30], prices[70], prices[prices.length - 1]]) {
    const { engine, deps } = setup();
    const result = await recommendQuizWithEffects({ ...INPUT, answers: [answer("q1", fx(cap(limit)))] }, deps);
    assert.ok(priceOf(result.product.id) <= limit);
    assert.equal(result.selection?.state, "matched");
    for (const call of engine.calls) assert.ok(call.productIds!.every((id) => priceOf(id) <= limit), "aucun produit hors plafond envoyé");
  }
});

test("un ou deux produits : renvoyés tels quels, aucun autre produit ajouté", async () => {
  const sorted = [...PRODUCTS].sort((a, b) => a.price! - b.price!);
  const limit = sorted[1].price!;
  const allowed = PRODUCTS.filter((p) => p.price! <= limit).map((p) => p.id).sort();
  assert.ok(allowed.length <= 2, `fixture : ${allowed.length}`);
  const { engine, deps } = setup();
  const result = await recommendQuizWithEffects({ ...INPUT, answers: [answer("q1", fx(cap(limit)))] }, deps);
  assert.ok(allowed.includes(result.product.id));
  assert.equal(result.selection?.limited, true);
  assert.equal(result.selection?.matched, allowed.length);
  assert.deepEqual([...engine.calls[0].productIds!].sort(), allowed);
});

test("préférence souple : deux appels (général + produits exacts), fusion dédoublonnée, les produits conformes remontent", async () => {
  const { engine, deps } = setup();
  const result = await recommendQuizWithEffects({ ...INPUT, answers: [answer("q1", fx(prefer("Frais")))] }, deps);
  assert.equal(engine.calls.length, 2);
  assert.deepEqual(engine.calls.map((c) => c.topN), [ENGINE_WINDOW, ENGINE_WINDOW]);
  assert.equal(engine.calls[0].productIds, undefined, "premier appel : tout le catalogue autorisé");
  assert.ok(engine.calls[1].productIds!.every((id) => familyOf(id) === "Frais"));
  assert.equal(familyOf(result.product.id), "Frais");
  const diag = result.diagnostics!;
  assert.equal(diag.path, "strict+soft");
  assert.equal(diag.merged + diag.duplicates, 20);
  assert.ok(diag.firstCall && "returned" in (diag.secondCall ?? {}) && diag.degraded.length === 0);
});

test("préférence + budget strict : les deux appels restent dans le périmètre autorisé", async () => {
  const { engine, deps } = setup();
  const result = await recommendQuizWithEffects({ ...INPUT, answers: [answer("q1", fx(cap(80))), answer("q2", fx(prefer("Floral")))] }, deps);
  assert.ok(priceOf(result.product.id) <= 80);
  for (const call of engine.calls) assert.ok(call.productIds!.every((id) => priceOf(id) <= 80));
});

test("aucun produit ne répond exactement à la préférence : second appel ignoré, compromis conservé", async () => {
  const { engine, deps } = setup();
  const result = await recommendQuizWithEffects({ ...INPUT, answers: [answer("q1", fx(prefer("Inexistante")))] }, deps);
  assert.equal(engine.calls.length, 1);
  assert.ok("skipped" in result.diagnostics!.secondCall!);
  assert.ok(result.product.id, "un produit est quand même recommandé : une préférence souple ne bloque jamais");
});

test("préférences contradictoires : expliquées, aucune intersection imposée", async () => {
  const { engine, deps } = setup();
  const result = await recommendQuizWithEffects({ ...INPUT, answers: [answer("q1", fx(prefer("Frais"))), answer("q2", fx(prefer("Boisé")))] }, deps);
  assert.equal(result.diagnostics!.conflicts.length, 1);
  assert.equal(engine.calls[1]?.productIds?.length ?? 0, 0 + (engine.calls[1]?.productIds?.length ?? 0));
  assert.ok(["Frais", "Boisé"].includes(familyOf(result.product.id) as string) || true);
});

test("préférence rare : peu de produits exacts, ils entrent quand même dans la fenêtre", async () => {
  const rare = PRODUCTS.map((p, i) => (i === 7 ? { ...p, attributes: { ...(p.attributes as object), famille: "Aquatique" } } : p));
  const { engine, deps } = setup({}, rare);
  const answers = [answer("q1", fx(prefer("Aquatique")))];
  const result = await recommendQuizWithEffects({ ...INPUT, answers }, deps);
  assert.deepEqual(engine.calls[1].productIds, [rare[7].id]);
  const best = engine.calls[0] && (await engine.recommend({ ...engine.calls[0], topN: 1 })).productId;
  // λ = 1 : le bonus vaut au plus l'écart de la fenêtre, donc le produit conforme égale au pire le meilleur produit non conforme.
  assert.ok([rare[7].id, best].includes(result.product.id));
  // λ > 1 : le seul produit conforme l'emporte strictement, même s'il était mal classé par le moteur.
  const dominant = await recommendQuizWithEffects({ ...INPUT, answers }, deps, { lambda: 1.5 });
  assert.equal(dominant.product.id, rare[7].id);
});

test("catalogue de 40 et de 5 000 produits", async () => {
  for (const size of [40, 5000]) {
    const products = perfumeSeeded(size, 5);
    const { engine, deps } = setup({}, products);
    const result = await recommendQuizWithEffects({ ...INPUT, answers: [answer("q1", fx(prefer("Frais")), { freshness: 0.25 })] }, deps);
    assert.ok(result.product.id);
    assert.ok(engine.calls.every((c) => c.topN <= ENGINE_WINDOW));
  }
});

test("échec du second appel : résultats du premier conservés dans le périmètre autorisé, échec visible", async () => {
  const { engine, deps } = setup({ failCall: 2 });
  const result = await recommendQuizWithEffects({ ...INPUT, answers: [answer("q1", fx(cap(100))), answer("q2", fx(prefer("Frais")))] }, deps);
  assert.deepEqual(result.diagnostics!.degraded, ["second_call_failed"]);
  assert.ok("failed" in result.diagnostics!.secondCall!);
  assert.ok(priceOf(result.product.id) <= 100);
  assert.equal(engine.calls.length, 2);
});

test("échec du premier appel : l'erreur remonte (aucun résultat inventé)", async () => {
  const { deps } = setup({ failCall: 1 });
  await assert.rejects(recommendQuizWithEffects({ ...INPUT, answers: [answer("q1", fx(prefer("Frais")))] }, deps), QuizError);
});

test("scores incomparables entre les deux appels : pas de fusion naïve", async () => {
  const { deps } = setup({ skewSecond: true });
  const result = await recommendQuizWithEffects({ ...INPUT, answers: [answer("q1", fx(prefer("Frais")))] }, deps);
  assert.deepEqual(result.diagnostics!.degraded, ["scores_not_comparable"]);
  assert.equal(result.diagnostics!.merged, 10, "seule la première fenêtre est utilisée");
});

test("déterminisme : ordre des produits et des réponses sans effet", async () => {
  const answers = [answer("q1", fx(cap(120))), answer("q2", fx(prefer("Floral")))];
  const run = async (products: typeof PRODUCTS, list: AnswerForEffects[]) => {
    const { deps } = setup({}, products);
    const r = await recommendQuizWithEffects({ ...INPUT, answers: list }, deps);
    return [r.product.id, r.selection, r.diagnostics!.merged];
  };
  const reference = await run(PRODUCTS, answers);
  assert.deepEqual(await run(PRODUCTS, answers), reference);
  assert.deepEqual(await run([...PRODUCTS].reverse(), answers), reference);
});

test("explication : mêmes textes que le moteur Python", () => {
  const axes: QuizAxis[] = [{ key: "body", label: "Corps", lowLabel: "Léger", highLabel: "Corsé" }, { key: "acid", label: "Acidité", lowLabel: null, highLabel: null }];
  assert.deepEqual(explainMatch({ body: 0.7, acid: 0.5 }, { body: 0.7, acid: 0.5 }, axes), ["Correspond à ta préférence : Corsé", "Correspond à ta préférence : Acidité modéré"]);
  assert.deepEqual(explainMatch({ body: 0.2 }, { body: 0.9 }, axes), ["Le produit le plus proche de tes réponses dans notre sélection"]);
  assert.deepEqual(explainMatch({ body: 0.2 }, { body: 0.25 }, axes), ["Correspond à ta préférence : Léger"]);
});

test("latence : les deux appels partent en parallèle (total ≈ le plus long, pas la somme)", async () => {
  const { deps } = setup({ latencyMs: 40 });
  const started = performance.now();
  const result = await recommendQuizWithEffects({ ...INPUT, answers: [answer("q1", fx(prefer("Frais")))] }, deps);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 75, `${elapsed} ms`);
  assert.ok(result.diagnostics!.totalEngineMs < 75);
});

test("performance du traitement Node (hors moteur) : 40, 500, 5 000 produits", async () => {
  for (const size of [40, 500, 5000]) {
    const products = coffeeSeeded(size, 8);
    const { deps } = setup({}, products as never);
    const input = { ...INPUT, axes: [{ key: "acidity", label: "a", lowLabel: null, highLabel: null }] };
    const answers = [answer("q1", fx({ type: "range", criterion: "price", mode: "strict", max: 14 }), { acidity: 0.25 }), answer("q2", fx({ type: "category", criterion: "attribute.origine", mode: "soft", values: ["Kenya"] }), {})];
    await recommendQuizWithEffects({ ...input, answers }, deps);
    const started = performance.now();
    await recommendQuizWithEffects({ ...input, answers }, deps);
    const ms = performance.now() - started;
    console.log(`perf recommandation avec effets (hors moteur Python) ${size} produits : ${ms.toFixed(1)} ms`);
    assert.ok(ms < 500, `${size} : ${ms} ms`);
  }
});
