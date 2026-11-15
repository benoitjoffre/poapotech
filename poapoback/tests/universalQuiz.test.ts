import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ExpressDraft, ExpressProposal, QuizAxis } from "@poapo/types";
import { type EffectsDeps, recommendQuizWithEffects } from "../src/services/effectsRecommendation";
import { type ExpressContext, type ExpressProduct, proposeExpressQuiz, validateExpressDraft } from "../src/services/expressQuiz";
import { buildUniversalDraft, UNIVERSAL_LIMITS, universalGenerator } from "../src/services/universalQuiz";
import { QuizError } from "../src/services/quizzes";
import { fakeEngine } from "./fixtures/fakeEngine";
import { coffeeSeeded, fashionSeeded, noUsefulCriteria, perfumeSeeded } from "./fixtures/selectionFixtures";

before(() => { process.env.EXPRESS_UNIVERSAL_QUESTIONS = "1"; });
after(() => { delete process.env.EXPRESS_UNIVERSAL_QUESTIONS; });

const ctx = (name: string, industry: string, products: ReturnType<typeof perfumeSeeded>, existingAxes: QuizAxis[] = []): ExpressContext => ({
  catalogId: "c", catalogName: name, catalogDescription: null, industry, existingAxes,
  products: products.map((p): ExpressProduct => ({ id: p.id!, name: p.id!, brand: p.brand ?? null, price: p.price ?? null, description: null, tags: [...(p.tags ?? [])], attributes: p.attributes, embeddingReady: false })),
});
const axesOf = (keys: string[]): QuizAxis[] => keys.map((key) => ({ key, label: key, lowLabel: null, highLabel: null }));
const PARFUM = () => ctx("Parfums", "Parfumerie", perfumeSeeded(60, 5), axesOf(["freshness", "woody", "sweetness", "intensity"]));
const CAFE = () => ctx("Cafés", "Café", coffeeSeeded(40, 6), axesOf(["acidity", "intensity"]));
const MODE = () => ctx("Vêtements", "Mode", fashionSeeded(50, 7), axesOf(["confort"]));
const generate = (c: ExpressContext, options = {}) => proposeExpressQuiz(c, options, universalGenerator);
const neutral = (answer: ExpressDraft["questions"][number]["answers"][number]) => answer.effects?.effects.every((e) => e.type === "none") && !Object.keys(answer.impacts).length;

for (const [name, build] of [["Parfum", PARFUM], ["Café", CAFE], ["Mode", MODE]] as const) {
  test(`${name} : critères tirés des données, aucune question décorative, « Sans préférence » neutre`, () => {
    const proposal = generate(build());
    assert.equal(proposal.analysis.generator, "universal");
    const draft = proposal.draft!;
    assert.ok(draft.questions.length >= 3 && draft.questions.length <= UNIVERSAL_LIMITS.defaultQuestions);
    const context = build();
    assert.ok(draft.questions.some((q) => q.info?.kind === "choice"), "au moins une question catégorielle");
    assert.ok(draft.questions.some((q) => q.info?.kind === "budget"), "une question de budget");
    for (const question of draft.questions) {
      assert.ok(question.info && question.info.criterion);
      const real = question.answers.filter((a) => !neutral(a));
      assert.ok(real.length >= 1 && question.answers.length >= 2 && question.answers.length <= 6);
      for (const answer of real) assert.ok(Object.keys(answer.impacts).length > 0 || answer.effects?.effects.some((e) => e.type === "category" || e.type === "range"), `${question.text} / ${answer.text} : effet réel attendu`);
      for (const answer of question.answers) assert.ok(answer.effectSummary);
      assert.equal(question.answers.filter(neutral).length, 1, "une seule réponse neutre");
    }
    // Les options catégorielles viennent exactement des valeurs du catalogue.
    for (const question of draft.questions.filter((q) => q.info?.kind === "choice")) {
      const effect = question.answers[0].effects!.effects[0];
      assert.ok(effect.type === "category");
      const key = effect.criterion.replace("attribute.", "");
      const values = new Set(context.products.map((p) => String((p.attributes as Record<string, unknown>)[key])));
      for (const answer of question.answers.filter((a) => !neutral(a))) assert.ok(values.has((answer.effects!.effects[0] as { values: string[] }).values[0]));
    }
    // Le brouillon généré passe la validation du serveur (sans plafond strict).
    assert.doesNotThrow(() => validateExpressDraft(JSON.parse(JSON.stringify(draft)), context));
    assert.ok(proposal.analysis.criteria!.some((c) => c.status === "used"));
  });
}

test("budget : tranches calculées sur les prix réels, souple par défaut", () => {
  const c = PARFUM();
  const draft = generate(c).draft!;
  const budget = draft.questions.find((q) => q.info?.kind === "budget")!;
  assert.equal(budget.info!.strict, false);
  const ranges = budget.answers.flatMap((a) => a.effects!.effects.filter((e) => e.type === "range")) as { mode: string; min?: number; max?: number }[];
  assert.equal(ranges.length, 3);
  assert.ok(ranges.every((r) => r.mode === "soft"));
  const prices = c.products.map((p) => p.price!).sort((a, b) => a - b);
  const b1 = ranges[0].max!, b2 = ranges[1].max!;
  assert.ok(b1 >= prices[0] && b1 < b2 && b2 < prices[prices.length - 1], `${b1} / ${b2} dans [${prices[0]}, ${prices[prices.length - 1]}]`);
  assert.equal(ranges[1].min, b1);
  assert.equal(ranges[2].min, b2);
  for (const [lo, hi] of [[-Infinity, b1], [b1, b2], [b2, Infinity]]) assert.ok(prices.some((p) => p > lo && p <= hi), "chaque tranche contient des produits");
  assert.ok(budget.answers[0].text.includes("€") && budget.answers[budget.answers.length - 1].effects!.effects[0].type === "none");
});

test("plafond strict : uniquement sur décision explicite, confirmé à la validation, jamais sans fiabilité", () => {
  const c = PARFUM();
  const strict = generate(c, { strictBudget: true });
  const budget = strict.draft!.questions.find((q) => q.info?.kind === "budget")!;
  assert.equal(budget.info!.strict, true);
  const efs = budget.answers.flatMap((a) => a.effects!.effects).filter((e) => e.type === "range") as { mode: string; max?: number; onMissing?: string }[];
  assert.ok(efs.length >= 2 && efs.every((e) => e.mode === "strict" && e.max !== undefined && e.onMissing === undefined), "strict, plafond seul, politique de valeur absente par défaut (exclure)");
  assert.throws(() => validateExpressDraft(JSON.parse(JSON.stringify(strict.draft)), c), (e: unknown) => e instanceof QuizError && /confirmé explicitement/.test(e.message));
  assert.doesNotThrow(() => validateExpressDraft(JSON.parse(JSON.stringify(strict.draft)), c, { allowStrict: true }));
  // Sans demande explicite, aucun effet strict dans le brouillon.
  const soft = JSON.stringify(generate(c).draft);
  assert.ok(!soft.includes('"mode":"strict"'));
  // Prix insuffisamment renseigné (60 %) : jamais de plafond strict, préférence souple + explication.
  const partial = PARFUM();
  partial.products = partial.products.map((p, i) => (i % 5 < 2 ? { ...p, price: null } : p));
  const refused = generate(partial, { strictBudget: true });
  assert.ok(!JSON.stringify(refused.draft).includes('"mode":"strict"'));
  assert.ok(refused.analysis.messages.some((m) => /plafond de budget strict n'a pas été proposé/.test(m)));
  // Prix invalides (valeurs négatives sur 20 % des produits) : pas de strict non plus.
  const invalid = PARFUM();
  invalid.products = invalid.products.map((p, i) => (i % 5 === 0 ? { ...p, price: -5 } : p));
  assert.ok(!JSON.stringify(generate(invalid, { strictBudget: true }).draft).includes('"mode":"strict"'));
});

test("critères au rôle incertain (marque, oui/non) : suggestions à valider, jamais dans le brouillon ; références jamais utilisées", () => {
  const proposal = generate(PARFUM());
  const used = proposal.draft!.questions.map((q) => q.info!.criterion.toLowerCase());
  assert.ok(!used.includes("marque") && !used.includes("sku") && !used.some((l) => l.includes("vegan")));
  const suggestions = proposal.alternatives;
  assert.ok(suggestions.length > 0 && suggestions.every((q) => q.info?.needsValidation && q.info.validationReason));
  assert.ok(suggestions.some((q) => q.info!.criterion === "Marque"));
  const summary = proposal.analysis.criteria!;
  assert.ok(summary.some((c) => c.status === "to_validate"));
  assert.ok(summary.some((c) => c.status === "left_out" && /référence|code/.test(c.reason)));
});

test("nombre de questions : plafonné selon le choix du commerçant ; pas de limite artificielle à six critères d'analyse", () => {
  const c = PARFUM();
  assert.ok(generate(c, { questionCount: 3 }).draft!.questions.length <= 3);
  assert.ok(generate(c, { questionCount: 7 }).draft!.questions.length <= 7);
  const selection = proposeExpressQuiz(c, {}, universalGenerator).analysis.criteria!.length;
  assert.ok(selection > UNIVERSAL_LIMITS.defaultQuestions, "tous les critères du catalogue sont examinés");
});

test("modèle sectoriel : reformule un critère retenu, ne détermine pas la sélection", () => {
  const c = CAFE();
  const draft = generate(c).draft!;
  const axisQuestions = draft.questions.filter((q) => q.info!.kind === "axis");
  assert.ok(axisQuestions.some((q) => /café au réveil|vivacité|texture/i.test(q.text)), "formulation du modèle café");
  const keys = new Set(draft.axes.map((a) => a.key));
  assert.ok(![...keys].some((k) => !["acidity", "intensity"].includes(k)), "aucun axe inventé par le modèle");
  // Forcer un autre modèle ne change pas les critères retenus.
  const forced = generate(c, { sector: "perfume" }).draft!;
  assert.deepEqual(forced.questions.map((q) => q.info!.criterion), draft.questions.map((q) => q.info!.criterion));
});

test("catalogue sans critère exploitable ou fonctionnalité désactivée : repli sur le générateur historique", () => {
  const empty = ctx("Divers", "", noUsefulCriteria(), []);
  const fallback = generate(empty);
  assert.equal(fallback.analysis.generator, "legacy");
  assert.ok(fallback.analysis.messages.some((m) => /proposition classique/.test(m)));
  assert.deepEqual(JSON.parse(JSON.stringify({ ...fallback.draft })), JSON.parse(JSON.stringify({ ...proposeExpressQuiz(empty).draft })));
  delete process.env.EXPRESS_UNIVERSAL_QUESTIONS;
  try {
    const off = generate(PARFUM());
    assert.equal(off.analysis.generator, "legacy");
    assert.deepEqual(off.draft, proposeExpressQuiz(PARFUM()).draft, "identique au générateur historique");
    const withEffects = JSON.parse(JSON.stringify(buildUniversalDraft(PARFUM(), {})!.draft));
    assert.throws(() => validateExpressDraft(withEffects, PARFUM()), (e: unknown) => e instanceof QuizError && /pas disponibles/.test(e.message));
  } finally { process.env.EXPRESS_UNIVERSAL_QUESTIONS = "1"; }
});

test("déterminisme et indépendance à l'ordre des produits", () => {
  const a = JSON.stringify(generate(PARFUM()));
  assert.equal(JSON.stringify(generate(PARFUM())), a);
  const reversed = PARFUM();
  reversed.products.reverse();
  const strip = (s: string) => JSON.parse(s, (k, v) => (k === "columns" ? undefined : v));
  assert.deepEqual(strip(JSON.stringify(generate(reversed))), strip(a));
});

test("validation : une réponse à effets invalides, inconnus ou sur donnée peu fiable est refusée", () => {
  const c = PARFUM();
  const base = () => JSON.parse(JSON.stringify(generate(c).draft)) as ExpressDraft;
  const choice = (d: ExpressDraft) => d.questions.find((q) => q.info?.kind === "choice")!;
  const reject = (mutate: (d: ExpressDraft) => void, pattern: RegExp) => { const d = base(); mutate(d); assert.throws(() => validateExpressDraft(d, c), pattern); };
  reject((d) => { (choice(d).answers[0].effects as { effects: unknown[] }).effects = [{ type: "wizard" }]; }, /effets invalides/);
  reject((d) => { choice(d).answers.forEach((a) => { a.effects = null; a.impacts = {}; }); }, /aucun effet distinct/);
  reject((d) => { (choice(d).answers[0].effects as { effects: { criterion: string }[] }).effects[0].criterion = "attribute.inexistant"; }, /introuvable|exploitable/);
  const sparse = PARFUM();
  sparse.products = sparse.products.map((p, i) => (i % 2 ? { ...p, attributes: { ...(p.attributes as object), genre: undefined } } : p));
  const d = base();
  const genreQuestion = d.questions.find((q) => q.info?.criterion === "Genre");
  if (genreQuestion) {
    genreQuestion.answers.forEach((a) => a.effects?.effects.forEach((e) => { if (e.type === "category") (e as { mode: string }).mode = "strict"; }));
    assert.throws(() => validateExpressDraft(d, sparse, { allowStrict: true }), /stricte refusée/);
  }
});

test("effets vérifiables : choisir une réponse change la recommandation par rapport à « Sans préférence »", async () => {
  const c = PARFUM();
  const draft = generate(c).draft!;
  const products = c.products;
  const axes = draft.axes;
  for (const question of draft.questions.filter((q) => q.info!.kind === "choice" || q.info!.kind === "budget")) {
    let changed = 0, trials = 0;
    for (const answer of question.answers.filter((a) => !neutral(a))) {
      for (let v = 0; v < 8; v++) {
        const impacts = { freshness: v % 2 ? 0.25 : -0.25, woody: v % 3 ? 0.25 : -0.25 };
        const run = async (effects: unknown) => {
          const engine = fakeEngine(products as never);
          const deps: EffectsDeps = { recommend: engine.recommend, loadProducts: async () => products as never, loadProduct: async ({ productId }) => ({ id: productId }) as never };
          return (await recommendQuizWithEffects({ tenantId: "t", catalogId: "c", industry: "", axes, answers: [{ questionId: "q", impacts, effects }] }, deps, { forceEffectsPath: true })).product.id;
        };
        trials++;
        if (await run(answer.effects) !== await run(question.answers.find(neutral)!.effects)) changed++;
      }
    }
    assert.ok(changed > 0, `${question.text} : au moins une réponse change la recommandation (${changed}/${trials})`);
  }
});

// ─── Libellés d'origine (lot 10D-2D) ──────────────────────────────────────────

test("libellés : l'en-tête du CSV (accents, unités) devient le libellé du commerçant, la version visiteur sans unité ; les clés ne changent pas", () => {
  const context = CAFE();
  context.attributeLabels = { torrefaction: "Torréfaction", origine: "Pays d'origine", poids_g: "Poids (g)", type: "Type de mouture" };
  const draft = generate(context).draft!;
  const roast = draft.questions.find((q) => q.info?.criterion === "Torréfaction")!;
  assert.ok(roast, "libellé commerçant avec accent");
  assert.equal(roast.text, "Côté torréfaction, qu'est-ce qui vous attire le plus ?");
  assert.ok(draft.questions.some((q) => q.text === "Côté pays d'origine, qu'est-ce qui vous attire le plus ?"));
  assert.ok(draft.questions.some((q) => q.info?.criterion === "Type de mouture"));
  // Les effets continuent de référencer la clé technique stable.
  const effect = roast.answers[0].effects!.effects[0];
  assert.ok(effect.type === "category" && effect.criterion === "attribute.torrefaction");
  // L'unité entre parenthèses reste côté commerçant et disparaît côté visiteur.
  const withUnit = CAFE();
  withUnit.attributeLabels = { torrefaction: "Torréfaction (niveau)" };
  const unitQuestion = generate(withUnit).draft!.questions.find((q) => q.info?.criterion === "Torréfaction (niveau)")!;
  assert.ok(unitQuestion);
  assert.equal(unitQuestion.text, "Côté torréfaction, qu'est-ce qui vous attire le plus ?");
  // Sans en-tête connu : repli sur le nom de la clé, comme avant.
  assert.ok(generate(CAFE()).draft!.questions.some((q) => q.info?.criterion === "Torrefaction"));
});

// ─── Éligibilité : création uniquement (lot 10D-2D) ──────────────────────────

import { universalAllowedFor, universalMode } from "../src/services/expressFlags";
import { parseExpressOptions } from "../src/services/expressQuiz";

test("éligibilité : désactivé, ouvert à tous, ou réservé à des comptes listés", () => {
  const saved = { flag: process.env.EXPRESS_UNIVERSAL_QUESTIONS, tenants: process.env.EXPRESS_UNIVERSAL_TENANTS };
  try {
    delete process.env.EXPRESS_UNIVERSAL_QUESTIONS;
    assert.equal(universalMode(), "off");
    assert.equal(universalAllowedFor("a"), false);
    process.env.EXPRESS_UNIVERSAL_QUESTIONS = "oui";
    assert.equal(universalMode(), "off", "toute valeur autre que 1 ou pilot = désactivé");
    process.env.EXPRESS_UNIVERSAL_QUESTIONS = "1";
    assert.equal(universalAllowedFor("a"), true);
    process.env.EXPRESS_UNIVERSAL_QUESTIONS = "pilot";
    process.env.EXPRESS_UNIVERSAL_TENANTS = " t-pilote , t-autre ";
    assert.equal(universalAllowedFor("t-pilote"), true);
    assert.equal(universalAllowedFor("t-autre"), true);
    assert.equal(universalAllowedFor("t-client"), false);
    assert.equal(universalAllowedFor(undefined), false);
    delete process.env.EXPRESS_UNIVERSAL_TENANTS;
    assert.equal(universalAllowedFor("t-pilote"), false, "pilote sans liste = personne");
    // Demande de génération avancée : refusée pour un compte non éligible.
    process.env.EXPRESS_UNIVERSAL_TENANTS = "t-pilote";
    assert.deepEqual(parseExpressOptions({ generator: "universal" }, "t-pilote"), { generator: "universal" });
    assert.throws(() => parseExpressOptions({ generator: "universal" }, "t-client"), /pas disponibles/);
    assert.deepEqual(parseExpressOptions({ generator: "legacy" }, "t-client"), { generator: "legacy" });
  } finally {
    if (saved.flag === undefined) delete process.env.EXPRESS_UNIVERSAL_QUESTIONS; else process.env.EXPRESS_UNIVERSAL_QUESTIONS = saved.flag;
    if (saved.tenants === undefined) delete process.env.EXPRESS_UNIVERSAL_TENANTS; else process.env.EXPRESS_UNIVERSAL_TENANTS = saved.tenants;
  }
});

test("validation Express : l'autorisation de créer est explicite ; les effets restent strictement validés dans tous les cas", () => {
  const c = PARFUM();
  const draft = JSON.parse(JSON.stringify(generate(c).draft)) as ExpressDraft;
  assert.throws(() => validateExpressDraft(draft, c, { allowEffects: false }), (e: unknown) => e instanceof QuizError && /pas disponibles/.test(e.message));
  assert.doesNotThrow(() => validateExpressDraft(draft, c, { allowEffects: true }));
  const broken = JSON.parse(JSON.stringify(draft)) as ExpressDraft;
  (broken.questions.find((q) => q.info?.kind === "choice")!.answers[0].effects as { effects: unknown[] }).effects = [{ type: "wizard" }];
  assert.throws(() => validateExpressDraft(broken, c, { allowEffects: true }), /effets invalides/);
});
