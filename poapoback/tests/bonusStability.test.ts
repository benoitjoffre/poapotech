import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuizAxis } from "@poapo/types";
import { parseAnswerEffects } from "../src/services/answerEffects";
import { planCandidateSets, RETRIEVAL_STRATEGIES } from "../src/services/candidateRetrieval";
import { type BonusModel, REFERENCE_FLOOR, rerankSoft, type EffectProduct, type SelectedAnswer } from "../src/services/effectsEngine";
import { type AnswerForEffects, type EffectsDeps, recommendQuizWithEffects } from "../src/services/effectsRecommendation";
import { fakeEngine } from "./fixtures/fakeEngine";
import { buildVisitors, SECTOR_CONFIGS, simulatedScores } from "./fixtures/bonusExperiment";

const MODELS: [string, BonusModel][] = [
  ["fenêtre (historique)", { kind: "window_spread", lambda: 1 }],
  ["constant", { kind: "constant", beta: 0.1 }],
  ["ancré", { kind: "anchored", kappa: 3 }],
];
const fx = (...effects: unknown[]) => { const p = parseAnswerEffects({ v: 1, effects }); assert.ok(p.ok); return p.value; };
const ans = (...effects: unknown[]): SelectedAnswer[] => effects.map((e, i) => ({ questionId: `q${i}`, effects: fx(e) }));
const fam = (...values: string[]) => ({ type: "category", criterion: "attribute.famille", mode: "soft", values });
const P = (id: string, famille: string | null, price = 50): EffectProduct => ({ id, price, attributes: famille === null ? {} : { famille } });

/** Bonus de chaque produit pour un visiteur, avec une fenêtre construite par une stratégie de récupération donnée. */
function bonusesFor(strategy: string, model: BonusModel, sector = SECTOR_CONFIGS[0], scenario: "3_prefs" | "2_prefs" = "3_prefs") {
  const products = sector.build(120);
  const visitors = buildVisitors(sector, products, scenario, 25);
  const engine = simulatedScores(sector, visitors.map((v) => v.profile));
  return visitors.map((v, vi) => {
    const scored = products.map((p) => ({ id: p.id, score: engine.score(vi, p) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const general = scored.slice(0, 10);
    const merged = new Map(general.map((s) => [s.id, s.score]));
    for (const ids of strategy === "general" ? [] : planCandidateSets(strategy as never, products, v.answers).calls) {
      const set = new Set(ids);
      for (const s of scored.filter((x) => set.has(x.id)).slice(0, 10)) merged.set(s.id, s.score);
    }
    const reference = general[0].score - general[9].score;
    return new Map(rerankSoft([...merged].map(([id, score]) => ({ id, score })), products, v.answers, { bonus: model, reference }).ranked.map((r) => [r.id, r.bonus]));
  });
}

test("même produit, même profil, mêmes préférences : le bonus constant et le bonus ancré ne dépendent pas de la fenêtre", () => {
  for (const [label, model] of MODELS.slice(1)) {
    for (const sector of SECTOR_CONFIGS) {
      const reference = bonusesFor("general", model, sector);
      for (const strategy of RETRIEVAL_STRATEGIES) {
        const other = bonusesFor(strategy, model, sector);
        other.forEach((bonuses, v) => { for (const [id, bonus] of bonuses) if (reference[v].has(id)) assert.equal(bonus, reference[v].get(id), `${label} ${sector.name} ${strategy} ${id}`); });
      }
    }
  }
});

test("référence documentée : la formule historique, elle, change le bonus d'un même produit selon la fenêtre", () => {
  const [, model] = MODELS[0];
  const narrow = bonusesFor("general", model);
  const wide = bonusesFor("union_quota", model);
  let differing = 0;
  narrow.forEach((bonuses, v) => { for (const [id, bonus] of bonuses) if (wide[v].has(id) && Math.abs(wide[v].get(id)! - bonus) > 1e-9) differing++; });
  assert.ok(differing > 0, "le défaut corrigé par l'option expérimentale est reproduit");
});

test("ordre des candidats et des produits sans effet, pour chaque modèle", () => {
  const products = [P("a", "Frais"), P("b", "Floral"), P("c", "Frais"), P("d", null), P("e", "Boisé")];
  const scored = products.map((p, i) => ({ id: p.id, score: 0.6 - i * 0.03 }));
  for (const [label, model] of MODELS) {
    const base = JSON.stringify(rerankSoft(scored, products, ans(fam("Frais")), { bonus: model, reference: 0.08 }));
    assert.equal(JSON.stringify(rerankSoft([...scored].reverse(), [...products].reverse(), ans(fam("Frais")), { bonus: model, reference: 0.08 })), base, label);
  }
});

test("valeur manquante : aucun bonus ; préférence souple : aucune exclusion", () => {
  const products = [P("a", "Frais"), P("b", null), P("c", "Floral")];
  const scored = [{ id: "a", score: 0.5 }, { id: "b", score: 0.7 }, { id: "c", score: 0.6 }];
  for (const [label, model] of MODELS) {
    const { ranked } = rerankSoft(scored, products, ans(fam("Frais")), { bonus: model, reference: 0.05 });
    assert.equal(ranked.length, 3, `${label} : aucun produit retiré`);
    assert.equal(ranked.find((r) => r.id === "b")!.bonus, 0, `${label} : valeur absente = aucun bonus`);
    assert.equal(ranked.find((r) => r.id === "c")!.bonus, 0);
    assert.ok(ranked.find((r) => r.id === "a")!.bonus > 0);
  }
});

test("scores négatifs : le bonus s'ajoute sans transformation (constant et ancré) et reste borné par son amplitude", () => {
  const products = [P("a", "Frais"), P("b", "Floral"), P("c", "Boisé")];
  const scored = [{ id: "a", score: -0.6 }, { id: "b", score: -0.2 }, { id: "c", score: -0.4 }];
  const constant = rerankSoft(scored, products, ans(fam("Frais")), { bonus: { kind: "constant", beta: 0.5 } });
  assert.deepEqual(constant.ranked.map((r) => r.id), ["a", "b", "c"], "-0,6 + 0,5 = -0,1 devant -0,2");
  assert.equal(constant.ranked[0].adjusted, -0.6 + 0.5);
  const anchored = rerankSoft(scored, products, ans(fam("Frais")), { bonus: { kind: "anchored", kappa: 2 }, reference: 0.1 });
  assert.equal(anchored.ranked.find((r) => r.id === "a")!.bonus, 0.2);
  for (const r of anchored.ranked) assert.ok(r.bonus >= 0 && r.bonus <= 0.2 + 1e-12);
});

test("scores identiques : la préférence départage (plancher de référence), puis l'identifiant", () => {
  const products = [P("a", "Floral"), P("b", "Frais"), P("c", "Frais")];
  const flat = products.map((p) => ({ id: p.id, score: 0.5 }));
  for (const [label, model] of MODELS) {
    const { ranked } = rerankSoft(flat, products, ans(fam("Frais")), { bonus: model, reference: 0 });
    assert.deepEqual(ranked.map((r) => r.id), ["b", "c", "a"], label);
  }
  const anchored = rerankSoft(flat, products, ans(fam("Frais")), { bonus: { kind: "anchored", kappa: 1 }, reference: 0 });
  assert.equal(anchored.ranked[0].bonus, REFERENCE_FLOOR);
});

test("préférences contradictoires : chaque alternative reçoit le même bonus, sans cumul ni suppression", () => {
  const products = [P("a", "Frais"), P("b", "Boisé"), P("c", "Floral")];
  const scored = products.map((p) => ({ id: p.id, score: 0.5 }));
  for (const [label, model] of MODELS) {
    const result = rerankSoft(scored, products, ans(fam("Frais"), fam("Boisé")), { bonus: model, reference: 0.05 });
    assert.equal(result.conflicts.length, 1, label);
    const bonus = (id: string) => result.ranked.find((r) => r.id === id)!.bonus;
    assert.equal(bonus("a"), bonus("b"));
    assert.ok(bonus("a") > 0 && bonus("c") === 0);
    assert.equal(result.ranked.length, 3);
  }
});

// ─── Traitement complet ───────────────────────────────────────────────────────

const AXES: QuizAxis[] = ["freshness", "woody", "sweetness", "intensity"].map((key) => ({ key, label: key, lowLabel: null, highLabel: null }));
const SECTOR = SECTOR_CONFIGS[0];
const CATALOG = SECTOR.build(150);
const INPUT = { tenantId: "t", catalogId: "c", industry: "Parfum", axes: AXES };
const raw = (q: string, effect: unknown): AnswerForEffects => ({ questionId: q, impacts: { freshness: 0.25 }, effects: { v: 1, effects: [effect] } });
function pipeline() {
  const engine = fakeEngine(CATALOG);
  const deps: EffectsDeps = {
    recommend: engine.recommend, loadProducts: async ({ productIds }) => CATALOG.filter((p) => !productIds || productIds.includes(p.id)),
    loadProduct: async ({ productId }) => ({ id: productId, name: productId, brand: null, description: null, price: null, imageUrl: null, purchaseUrl: null, tags: [], attributes: CATALOG.find((p) => p.id === productId)!.attributes as object }) as never,
  };
  return { engine, deps };
}
const priceOf = (id: string) => CATALOG.find((p) => p.id === id)!.price!;

test("contraintes strictes respectées avec chaque modèle de bonus et chaque stratégie", async () => {
  const cap = CATALOG.map((p) => p.price!).sort((a, b) => a - b)[100];
  const answers = [raw("q0", { type: "range", criterion: "price", mode: "strict", max: cap }), raw("q1", fam("Frais")), raw("q2", { type: "category", criterion: "attribute.genre", mode: "soft", values: ["Femme"] })];
  for (const [label, bonus] of MODELS) for (const retrieval of RETRIEVAL_STRATEGIES) {
    const { engine, deps } = pipeline();
    const result = await recommendQuizWithEffects({ ...INPUT, answers }, deps, { bonus, retrieval });
    assert.ok(priceOf(result.product.id) <= cap, `${label} ${retrieval}`);
    for (const call of engine.calls) assert.ok(call.productIds!.every((id) => priceOf(id) <= cap));
  }
});

test("défaut inchangé : formule de fenêtre λ = 1, identique à l'option explicite", async () => {
  const answers = [raw("q0", fam("Frais"))];
  const a = pipeline(); const byDefault = await recommendQuizWithEffects({ ...INPUT, answers }, a.deps);
  const b = pipeline(); const explicit = await recommendQuizWithEffects({ ...INPUT, answers }, b.deps, { bonus: { kind: "window_spread", lambda: 1 } });
  assert.deepEqual(byDefault.diagnostics!.bonus, { kind: "window_spread", lambda: 1 });
  assert.equal(byDefault.product.id, explicit.product.id);
  assert.deepEqual(a.engine.calls, b.engine.calls);
  assert.equal(byDefault.diagnostics!.bonusReference, undefined);
});

test("bonus ancré : la référence vient du premier appel seul, donc identique pour toutes les stratégies", async () => {
  const answers = [raw("q0", fam("Frais")), raw("q1", { type: "category", criterion: "attribute.genre", mode: "soft", values: ["Femme"] })];
  const references = new Set<number>();
  for (const retrieval of RETRIEVAL_STRATEGIES) {
    const { engine, deps } = pipeline();
    const result = await recommendQuizWithEffects({ ...INPUT, answers }, deps, { bonus: { kind: "anchored", kappa: 3 }, retrieval });
    references.add(result.diagnostics!.bonusReference!);
    const first = await engine.recommend({ ...engine.calls[0], topN: 10 });
    assert.equal(result.diagnostics!.bonusReference, first.topN[0].score - first.topN[9].score);
  }
  assert.equal(references.size, 1, "une seule valeur de référence, quelle que soit la stratégie");
});

test("aperçu et soumission : un seul moteur, mêmes options par défaut (aucune option expérimentale exposée)", async () => {
  const source = (await import("node:fs")).readFileSync(new URL("../src/routes/quiz.ts", import.meta.url).pathname.replace("/tests/", "/src/"), "utf8");
  const preview = (await import("node:fs")).readFileSync(new URL("../src/services/quizPreview.ts", import.meta.url).pathname.replace("/tests/", "/src/"), "utf8");
  for (const code of [source, preview]) {
    assert.match(code, /recommendQuizWithEffects\(\{/);
    assert.ok(!/bonus:|retrieval:/.test(code), "les options expérimentales ne sont pas branchées sur les routes");
  }
});
