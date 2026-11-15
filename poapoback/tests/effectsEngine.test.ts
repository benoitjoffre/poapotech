import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAnswerEffects } from "../src/services/answerEffects";
import { exactSoftMatches, FEW_RESULTS, rerankSoft, resolveStrict, SOFT_PREFERENCE_LAMBDA, type EffectProduct, type SelectedAnswer } from "../src/services/effectsEngine";
import { SECTORS, baseline, evaluate } from "./fixtures/effectsSimulation";

const fx = (...effects: unknown[]) => {
  const parsed = parseAnswerEffects({ v: 1, effects });
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.errors.join("; "));
  return parsed.value;
};
const ans = (questionId: string, ...effects: unknown[]): SelectedAnswer => ({ questionId, effects: fx(...effects) });
const P = (id: string, price: number | null, famille: string | null, extra: Record<string, unknown> = {}): EffectProduct =>
  ({ id, price, tags: [], attributes: { ...(famille === null ? {} : { famille }), ...extra } });
const fam = (...values: string[]) => ({ type: "category", criterion: "attribute.famille", mode: "soft", values });
const cap = (max: number, extra: object = {}) => ({ type: "range", criterion: "price", mode: "strict", max, ...extra });

const CATALOG: EffectProduct[] = [
  P("a", 30, "Floral"), P("b", 45, "Boisé"), P("c", 60, "Floral"), P("d", 90, "Frais"), P("e", 120, "Boisé"),
  P("f", 35, "Frais"), P("g", 75, "Floral"), P("h", 50, "Oriental"), P("i", 40, "Floral"), P("j", 65, "Frais"),
];
const SCORES = CATALOG.map((p, i) => ({ id: p.id, score: 0.8 - i * 0.02 }));

test("sans effets : ni filtre ni bonus, ordre du moteur strictement conservé", () => {
  const strict = resolveStrict(CATALOG, [{ questionId: "q", effects: null }, { questionId: "r", effects: fx() }]);
  assert.equal(strict.state, "unconstrained");
  assert.equal(strict.candidateIds, null);
  const soft = rerankSoft(SCORES, CATALOG, [{ questionId: "q", effects: null }]);
  assert.deepEqual(soft.ranked.map((r) => r.id), SCORES.map((s) => s.id));
  assert.ok(soft.ranked.every((r) => r.bonus === 0 && r.adjusted === r.score));
});

test("préférence souple : les produits conformes montent, les autres restent éligibles", () => {
  const { ranked } = rerankSoft(SCORES, CATALOG, [ans("q", fam("Floral"))]);
  assert.equal(ranked.length, CATALOG.length, "aucun produit retiré");
  assert.deepEqual(ranked.slice(0, 4).map((r) => r.id).sort(), ["a", "c", "g", "i"]);
  assert.ok(ranked.slice(4).every((r) => r.bonus === 0 && r.matched.length === 0));
  assert.ok(ranked.slice(0, 4).every((r) => r.matched.includes("attribute.famille")));
});

test("valeur manquante : aucun bonus artificiel, produit toujours éligible", () => {
  const catalog = [...CATALOG, P("z", 20, null)];
  const scored = [...SCORES, { id: "z", score: 0.9 }];
  const { ranked } = rerankSoft(scored, catalog, [ans("q", fam("Floral"))]);
  const z = ranked.find((r) => r.id === "z")!;
  assert.equal(z.bonus, 0);
  assert.ok(ranked.indexOf(z) >= 4, "un produit sans famille ne passe pas devant les Floral");
  assert.ok(ranked.some((r) => r.id === "z"));
});

test("plusieurs préférences : cumul borné, produit conforme aux deux devant celui conforme à une", () => {
  const answers = [ans("q1", fam("Floral")), ans("q2", { type: "range", criterion: "price", mode: "soft", max: 50 })];
  const { ranked, criteria } = rerankSoft(SCORES, CATALOG, answers);
  assert.deepEqual(criteria, ["attribute.famille", "price"]);
  const bonus = (id: string) => ranked.find((r) => r.id === id)!.bonus;
  assert.ok(bonus("a") === bonus("i") && bonus("i") > bonus("c") && bonus("c") > bonus("b"), "Floral ET ≤ 50 > Floral seul (60 €) > prix seul");
  assert.equal(bonus("e"), 0, "ni Floral ni proche du budget");
  const spread = SCORES[0].score - SCORES[SCORES.length - 1].score;
  assert.ok(ranked.every((r) => r.bonus <= SOFT_PREFERENCE_LAMBDA * spread + 1e-9), "bonus borné par λ × écart");
});

test("répéter une préférence ne la renforce pas ; des préférences contradictoires sont expliquées", () => {
  const once = rerankSoft(SCORES, CATALOG, [ans("q1", fam("Floral"))]);
  const twice = rerankSoft(SCORES, CATALOG, [ans("q1", fam("Floral")), ans("q2", fam("Floral"))]);
  assert.deepEqual(twice.ranked.map((r) => r.bonus), once.ranked.map((r) => r.bonus));
  assert.deepEqual(twice.conflicts, []);
  const conflict = rerankSoft(SCORES, CATALOG, [ans("q1", fam("Floral")), ans("q2", fam("Boisé"))]);
  assert.equal(conflict.conflicts.length, 1);
  assert.match(conflict.conflicts[0], /attribute\.famille/);
  const boosted = conflict.ranked.filter((r) => r.bonus > 0).map((r) => r.id).sort();
  assert.deepEqual(boosted, ["a", "b", "c", "e", "g", "i"], "Floral OU Boisé, sans cumul");
  assert.equal(new Set(conflict.ranked.filter((r) => r.bonus > 0).map((r) => r.bonus)).size, 1);
});

test("préférence souple hors plage : bonus décroissant, jamais de pénalité", () => {
  const { ranked } = rerankSoft(SCORES, CATALOG, [ans("q", { type: "range", criterion: "price", mode: "soft", min: 40, max: 60 })]);
  const bonus = (id: string) => ranked.find((r) => r.id === id)!.bonus;
  assert.ok(bonus("b") > 0 && bonus("b") === bonus("c"), "dans la plage : bonus plein");
  assert.ok(bonus("a") > 0 && bonus("a") < bonus("b"), "juste en dessous : bonus partiel");
  assert.equal(bonus("e"), 0, "très loin : aucun bonus");
  assert.ok(ranked.every((r) => r.bonus >= 0));
});

test("budget strict : aucun produit hors plafond, jamais relâché", () => {
  const strict = resolveStrict(CATALOG, [ans("q", cap(50))]);
  assert.equal(strict.state, "ok");
  assert.deepEqual(strict.candidateIds, ["a", "b", "f", "h", "i"]);
  assert.ok(strict.candidateIds!.every((id) => CATALOG.find((p) => p.id === id)!.price! <= 50));
  assert.equal(strict.limited, false);
});

test("plusieurs contraintes : ET entre questions, OU entre réponses d'une même question", () => {
  const and = resolveStrict(CATALOG, [ans("q1", cap(70)), ans("q2", { type: "category", criterion: "attribute.famille", mode: "strict", values: ["Floral"] })]);
  assert.deepEqual(and.candidateIds, ["a", "c", "i"]);
  const or = resolveStrict(CATALOG, [ans("q1", { type: "category", criterion: "attribute.famille", mode: "strict", values: ["Frais"] }),
    ans("q1", { type: "category", criterion: "attribute.famille", mode: "strict", values: ["Oriental"] })]);
  assert.deepEqual(or.candidateIds, ["d", "f", "h", "j"]);
});

test("aucun produit : état explicite, pas de repli ; contradiction expliquée", () => {
  const none = resolveStrict(CATALOG, [ans("q", cap(10))]);
  assert.equal(none.state, "no_match");
  assert.equal(none.reason, "no_product");
  assert.deepEqual(none.candidateIds, []);
  assert.match(none.message!, /Aucun produit ne correspond/);
  const contradiction = resolveStrict(CATALOG, [ans("q1", cap(40)), ans("q2", { type: "range", criterion: "price", mode: "strict", min: 100 })]);
  assert.equal(contradiction.state, "no_match");
  assert.equal(contradiction.reason, "contradiction");
  assert.match(contradiction.message!, /ensemble/);
  const disjoint = resolveStrict(CATALOG, [ans("q1", { type: "category", criterion: "attribute.famille", mode: "strict", values: ["Floral"] }), ans("q2", cap(32))]);
  assert.equal(disjoint.state, "ok", "a (30 €, Floral) satisfait les deux");
});

test("un ou deux produits : proposés tels quels, sans en inventer", () => {
  const two = resolveStrict(CATALOG, [ans("q", cap(35))]);
  assert.deepEqual(two.candidateIds, ["a", "f"]);
  assert.equal(two.limited, true);
  assert.equal(two.matched, 2);
  const one = resolveStrict(CATALOG, [ans("q", cap(30))]);
  assert.deepEqual(one.candidateIds, ["a"]);
  assert.ok(one.matched < FEW_RESULTS && one.limited);
});

test("données absentes sous contrainte stricte : exclues par défaut, incluses seulement sur choix explicite", () => {
  const catalog = [...CATALOG, P("n", null, "Floral")];
  const excluded = resolveStrict(catalog, [ans("q", cap(50))]);
  assert.ok(!excluded.candidateIds!.includes("n"));
  const included = resolveStrict(catalog, [ans("q", cap(50, { onMissing: "include" }))]);
  assert.ok(included.candidateIds!.includes("n"));
  assert.ok(excluded.candidateIds!.every((id) => included.candidateIds!.includes(id)));
});

test("colonne insuffisamment fiable : état « unreliable » explicite, aucun filtre silencieusement ignoré", () => {
  const sparse = CATALOG.map((p, i) => (i < 6 ? { ...p, attributes: {} } : p));
  const result = resolveStrict(sparse, [ans("q", { type: "category", criterion: "attribute.famille", mode: "strict", values: ["Floral"] })]);
  assert.equal(result.state, "unreliable");
  assert.equal(result.reason, "unreliable_data");
  assert.deepEqual(result.candidateIds, []);
  assert.match(result.message!, /attribute\.famille/);
});

test("une préférence souple sur une caractéristique déjà contrainte est ignorée et signalée", () => {
  const answers = [ans("q1", cap(50)), ans("q2", { type: "range", criterion: "price", mode: "soft", max: 40 })];
  const result = rerankSoft(SCORES, CATALOG, answers);
  assert.deepEqual(result.ignored, ["price"]);
  assert.ok(result.ranked.every((r) => r.bonus === 0));
});

test("tags : une préférence correspond si au moins un tag correspond", () => {
  const catalog: EffectProduct[] = [{ id: "t1", tags: ["Vanille", "ambre"] }, { id: "t2", tags: ["agrumes"] }, { id: "t3", tags: [] }];
  const { ranked } = rerankSoft([{ id: "t1", score: 0.65 }, { id: "t2", score: 0.6 }, { id: "t3", score: 0.7 }], catalog, [ans("q", { type: "category", criterion: "tags", mode: "soft", values: ["vanille"] })]);
  assert.equal(ranked[0].id, "t1");
  assert.deepEqual(exactSoftMatches(catalog, [ans("q", { type: "category", criterion: "tags", mode: "soft", values: ["vanille"] })]), ["t1"]);
});

test("déterminisme : ordre d'entrée et exécutions répétées sans effet sur le résultat", () => {
  const answers = [ans("q1", fam("Floral")), ans("q2", { type: "range", criterion: "price", mode: "soft", max: 60 }), ans("q3", cap(100))];
  const run = (catalog: EffectProduct[], scores: typeof SCORES) => JSON.stringify([resolveStrict(catalog, answers), rerankSoft(scores, catalog, answers)]);
  const reference = run(CATALOG, SCORES);
  assert.equal(run(CATALOG, SCORES), reference);
  assert.equal(run([...CATALOG].reverse(), [...SCORES].reverse()), reference);
  const tied = SCORES.map((s) => ({ ...s, score: 0.5 }));
  assert.equal(JSON.stringify(rerankSoft(tied, CATALOG, answers)), JSON.stringify(rerankSoft([...tied].reverse(), [...CATALOG].reverse(), answers)));
});

test("aucune mutation des entrées", () => {
  const catalog = JSON.stringify(CATALOG);
  const scores = JSON.stringify(SCORES);
  const answers = [ans("q", fam("Floral"), cap(80))];
  const snapshot = JSON.stringify(answers);
  resolveStrict(CATALOG, answers);
  rerankSoft(SCORES, CATALOG, answers);
  assert.equal(JSON.stringify(CATALOG), catalog);
  assert.equal(JSON.stringify(SCORES), scores);
  assert.equal(JSON.stringify(answers), snapshot);
});

// ─── Simulations sur les fixtures Parfum, Café et Mode (moteur proxy : voir effectsSimulation.ts) ───

test("simulation : aucune violation de budget strict, dans aucun secteur ni stratégie", () => {
  for (const sector of SECTORS) for (const window of [3, 10, "dual", null] as const) {
    const row = evaluate(sector, 80, 0.05, window, SOFT_PREFERENCE_LAMBDA, 60);
    assert.equal(row.violations, 0, `${sector.name} fenêtre ${window}`);
  }
  assert.ok(SECTORS.some((sector) => baseline(sector, 80, 0.05, 60).violations > 0), "sans effets, le moteur seul dépasse bien des budgets");
});

test("simulation : la fenêtre de 10 laisse des produits pertinents hors du re-classement, la double fenêtre en récupère", () => {
  for (const sector of SECTORS) {
    const narrow = evaluate(sector, 120, 0.05, 10, SOFT_PREFERENCE_LAMBDA, 60);
    const dual = evaluate(sector, 120, 0.05, "dual", SOFT_PREFERENCE_LAMBDA, 60);
    assert.ok(narrow.recallInWindow < 0.9, `${sector.name} : ${narrow.recallInWindow}`);
    assert.ok(dual.recallInWindow > narrow.recallInWindow, `${sector.name}`);
  }
});

test("simulation : reproductible", () => {
  const a = evaluate(SECTORS[0], 60, 0.05, "dual", 1, 40);
  const b = evaluate(SECTORS[0], 60, 0.05, "dual", 1, 40);
  assert.deepEqual(a, b);
});
