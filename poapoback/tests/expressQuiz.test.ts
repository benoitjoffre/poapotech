import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ExpressDraft, QuizAxis } from "@poapo/types";
import { type ExpressContext, type ExpressProduct, proposeExpressQuiz, validateExpressDraft } from "../src/services/expressQuiz";
import { computeProfile } from "../src/services/scoring";

function product(id: string, name: string, attributes: Record<string, unknown>, extra: Partial<ExpressProduct> = {}): ExpressProduct {
  return { id, name, brand: null, description: `Description de ${name}`, tags: [], attributes, embeddingReady: false, ...extra };
}

function context(overrides: Partial<ExpressContext> & Pick<ExpressContext, "products">): ExpressContext {
  return { catalogId: "cat", catalogName: "Catalogue", catalogDescription: null, industry: "", existingAxes: [], ...overrides };
}

const COFFEES = [
  product("c1", "Café doux d'Éthiopie", { intensity: 0.2, acidity: 0.8, body: 0.3, sweetness: 0.7 }),
  product("c2", "Espresso corsé", { intensity: 0.9, acidity: 0.2, body: 0.9, sweetness: 0.2 }),
  product("c3", "Arabica équilibré", { intensity: 0.5, acidity: 0.5, body: 0.6, sweetness: 0.9 }),
  product("c4", "Robusta intense", { intensity: 1, acidity: 0.1, body: 0.8, sweetness: 0.1 }),
];
const coffee = () => context({ products: COFFEES, industry: "Café" });

const keys = (draft: ExpressDraft) => draft.axes.map((axis) => axis.key);
const touchedKeys = (draft: ExpressDraft) => new Set(draft.questions.flatMap((q) => q.answers.flatMap((a) => Object.keys(a.impacts))));

/** Même formule que poapoai/main.py generic_attribute_score : sert à vérifier l'effet réel des réponses, sans toucher au moteur. */
function axisScore(profile: Record<string, number>, attributes: Record<string, unknown>): number {
  const shared = Object.entries(attributes).filter(([k, v]) => k in profile && typeof v === "number") as [string, number][];
  if (!shared.length) return 0;
  return 1 - Math.sqrt(shared.reduce((sum, [k, v]) => sum + (profile[k] - v) ** 2, 0)) / Math.sqrt(shared.length);
}

function best(draft: ExpressDraft, products: ExpressProduct[], picks: number[]): string {
  const axes: QuizAxis[] = draft.axes;
  const profile = computeProfile(axes, picks.map((pick, i) => draft.questions[i].answers[pick].impacts));
  return [...products].sort((a, b) => axisScore(profile, b.attributes as Record<string, unknown>) - axisScore(profile, a.attributes as Record<string, unknown>))[0].id;
}

function assertValidates(draft: ExpressDraft, ctx: ExpressContext) {
  return validateExpressDraft(JSON.parse(JSON.stringify(draft)), ctx);
}

test("café complet : 4 critères du modèle, données réelles, brouillon valide et fiable", () => {
  const ctx = coffee();
  const { analysis, draft } = proposeExpressQuiz(ctx);
  assert.ok(draft);
  assert.equal(analysis.sector, "coffee");
  assert.equal(analysis.reliability, "reliable");
  assert.deepEqual(keys(draft).sort(), ["acidity", "body", "intensity", "sweetness"]);
  assert.ok(draft.axes.every((axis) => axis.evidence === "data" && axis.justification && axis.description && axis.valuedProducts === 4));
  assert.equal(draft.questions.length, 5);
  assert.deepEqual([...touchedKeys(draft)].sort(), ["acidity", "body", "intensity", "sweetness"]);
  assert.equal(assertValidates(draft, ctx).validation.reliability, "reliable");
});

test("nombre de questions 3, 5 ou 7 : couverture maintenue, critères non mesurables retirés plutôt que gardés sans effet", () => {
  for (const questionCount of [3, 5, 7] as const) {
    const ctx = coffee();
    const { draft, analysis } = proposeExpressQuiz(ctx, { questionCount });
    assert.ok(draft);
    assert.ok(draft.questions.length <= questionCount && draft.questions.length >= 1);
    for (const key of keys(draft)) assert.ok(touchedKeys(draft).has(key), `${key} couvert avec ${questionCount} questions`);
    assertValidates(draft, ctx);
    if (draft.axes.length < 4) assert.ok(analysis.messages.some((m) => m.includes("retir")));
  }
  assert.equal(proposeExpressQuiz(coffee(), { questionCount: 7 }).draft!.questions.length, 7);
});

test("chaque réponse contraste réellement : des préférences opposées recommandent des cafés différents", () => {
  const { draft } = proposeExpressQuiz(coffee(), { questionCount: 5 });
  assert.ok(draft);
  // Pour chaque question, la réponse qui rapproche le plus le profil de la direction visée.
  const pick = (direction: Record<string, number>) => draft.questions.map((q) => q.answers.reduce((bestIndex, answer, i) => {
    const gain = (a: typeof answer) => Object.entries(a.impacts).reduce((sum, [k, v]) => sum + v * (direction[k] ?? 0), 0);
    return gain(answer) > gain(q.answers[bestIndex]) ? i : bestIndex;
  }, 0));
  const strong = best(draft, COFFEES, pick({ intensity: 1, body: 1, acidity: -1, sweetness: -1 }));
  const soft = best(draft, COFFEES, pick({ intensity: -1, body: -1, acidity: 1, sweetness: 1 }));
  assert.notEqual(soft, strong);
  assert.ok(["c2", "c4"].includes(strong), `profil corsé → ${strong}`);
  assert.ok(["c1", "c3"].includes(soft), `profil doux → ${soft}`);
});

test("parfum, voyage, mode : modèle sectoriel détecté et critères propres au secteur", () => {
  const cases: [string, string, string[], string[]][] = [
    ["perfume", "Parfum", ["freshness", "intensity", "sweetness", "woody"], ["Eau de parfum Iris", "Cologne Cèdre", "Parfum Ambre"]],
    ["travel", "Voyage", ["adventure", "relaxation", "culture", "nature"], ["Trek en Islande", "Séjour détente à Bali", "Circuit culturel Rome"]],
    ["fashion", "Mode", ["elegance", "comfort", "originality", "casual"], ["Robe de soirée", "Veste en jean", "Chaussures confort"]],
  ];
  for (const [sector, industry, axes, names] of cases) {
    const products = names.map((name, i) => product(`${sector}${i}`, name, Object.fromEntries(axes.map((key, k) => [key, [[0.1, 0.5, 0.9], [0.9, 0.2, 0.6], [0.4, 0.9, 0.1], [0.8, 0.8, 0.2]][k][i]]))));
    const ctx = context({ products, industry });
    const { analysis, draft } = proposeExpressQuiz(ctx);
    assert.equal(analysis.sector, sector, sector);
    assert.ok(draft);
    assert.deepEqual(keys(draft).sort(), [...axes].sort());
    assert.equal(analysis.reliability, "reliable");
    assertValidates(draft, ctx);
  }
});

test("secteur détecté depuis les produits sans activité renseignée ; modèle forcé ; pas de 4 axes imposés", () => {
  const products = ["Café Arabica A", "Café Robusta B", "Espresso C"].map((name, i) => product(`p${i}`, name, { intensity: [0.1, 0.5, 0.9][i], acidity: [0.9, 0.5, 0.1][i] }));
  const { analysis, draft } = proposeExpressQuiz(context({ products }));
  assert.equal(analysis.sector, "coffee");
  assert.equal(draft!.axes.length, 2);
  assert.deepEqual(analysis.missingForSector.map((m) => m.key).sort(), ["body", "sweetness"]);
  assert.equal(proposeExpressQuiz(context({ products }), { sector: "generic" }).analysis.sector, "generic");
});

test("catalogue générique : critères tirés des attributs chiffrés, libellés lisibles, rien d'inventé", () => {
  const products = [
    product("g1", "Lampe A", { luminosite: 0.2, robustesse: 0.9, bio: 1, poids: 250 }),
    product("g2", "Lampe B", { luminosite: 0.8, robustesse: 0.3, bio: 0, poids: 400 }),
    product("g3", "Lampe C", { luminosite: 0.5, robustesse: 0.6, bio: 1, poids: 100 }),
  ];
  const ctx = context({ products, industry: "Décoration" });
  const { analysis, draft } = proposeExpressQuiz(ctx);
  assert.equal(analysis.sector, "generic");
  assert.deepEqual(keys(draft!).sort(), ["luminosite", "robustesse"]);
  assert.equal(draft!.axes.find((a) => a.key === "luminosite")!.label, "Luminosite");
  assert.ok(analysis.candidates.some((c) => c.key === "bio" && c.note?.includes("oui/non")));
  assert.ok(analysis.messages.some((m) => m.includes("poids")), "attribut hors échelle signalé");
  assert.equal(analysis.reliability, "reliable");
  assertValidates(draft!, ctx);
});

test("catalogue incomplet : un critère peu renseigné ou plat n'est pas présenté comme discriminant", () => {
  const products = [
    product("i1", "Café 1", { intensity: 0.5, acidity: 0.1 }),
    product("i2", "Café 2", { intensity: 0.55 }),
    product("i3", "Café 3", {}),
    product("i4", "Café 4", {}),
  ];
  const { analysis, draft } = proposeExpressQuiz(context({ products, industry: "café" }));
  assert.equal(analysis.reliability, "insufficient");
  assert.ok(analysis.messages.some((m) => m.includes("ne permettent pas de différencier")));
  assert.ok(draft);
  assert.ok(draft.axes.every((axis) => axis.evidence === "semantic"), "aucun critère présenté comme appuyé sur des données");
  assert.ok(analysis.candidates.filter((c) => c.discriminant).length === 0);
});

test("catalogue sans axes ni secteur : pas de brouillon inventé, enrichissement demandé", () => {
  const products = [product("n1", "Objet 1", {}), product("n2", "Objet 2", {}), product("n3", "Objet 3", {})];
  const { analysis, draft, alternatives } = proposeExpressQuiz(context({ products, industry: "Divers" }));
  assert.equal(draft, null);
  assert.deepEqual(alternatives, []);
  assert.equal(analysis.reliability, "insufficient");
  assert.ok(analysis.messages.some((m) => m.includes("sans les inventer")));
});

test("catalogue sans axes mais secteur café et embeddings : brouillon limité, critères sémantiques", () => {
  const products = ["Café A", "Café B", "Café C"].map((name, i) => product(`s${i}`, name, {}, { embeddingReady: true }));
  const { analysis, draft } = proposeExpressQuiz(context({ products, industry: "Café" }));
  assert.equal(analysis.reliability, "limited");
  assert.ok(draft && draft.axes.every((axis) => axis.evidence === "semantic"));
  assert.ok(analysis.messages.some((m) => m.includes("approximatives")));
});

test("axes existants réutilisés (libellés personnalisés conservés)", () => {
  const existingAxes: QuizAxis[] = [{ key: "intensity", label: "Force", lowLabel: "Tout doux", highLabel: "Costaud" }];
  const { draft } = proposeExpressQuiz(context({ products: COFFEES, industry: "café", existingAxes }));
  const axis = draft!.axes.find((a) => a.key === "intensity")!;
  assert.equal(axis.label, "Force");
  assert.equal(axis.highLabel, "Costaud");
  assert.equal(axis.reused, true);
  assert.equal(draft!.axes.find((a) => a.key === "acidity")!.reused, false);
});

test("attributs en français : la clé produit est conservée comme identifiant du critère", () => {
  const products = COFFEES.map((p, i) => product(p.id, p.name, { intensite: (p.attributes as any).intensity, acidite: (p.attributes as any).acidity }));
  const { draft } = proposeExpressQuiz(context({ products, industry: "café" }));
  assert.deepEqual(keys(draft!).sort(), ["acidite", "intensite"]);
  assert.equal(draft!.axes.find((a) => a.key === "intensite")!.label, "Intensité");
  for (const question of draft!.questions) for (const answer of question.answers) for (const key of Object.keys(answer.impacts)) assert.ok(["acidite", "intensite"].includes(key));
});

test("critères doublons (évoluent ensemble) écartés", () => {
  const products = [0.1, 0.4, 0.7, 0.9, 0.3, 0.6].map((v, i) => product(`d${i}`, `Produit ${i}`, { calme: v, tranquille: v, vivacite: [0.9, 0.1, 0.6, 0.2, 0.8, 0.3][i] }));
  const { analysis, draft } = proposeExpressQuiz(context({ products }));
  assert.equal(draft!.axes.length, 2);
  assert.ok(analysis.candidates.some((c) => c.note?.includes("doublon")));
});

test("validation : questions modifiées (réponse ajoutée, supprimée, retexte) restent valides", () => {
  const ctx = coffee();
  const draft = proposeExpressQuiz(ctx).draft!;
  const edited: ExpressDraft = JSON.parse(JSON.stringify(draft));
  edited.questions[0].text = "Votre café du matin, comment ?";
  edited.questions[0].answers.push({ text: "Ni l'un ni l'autre, un peu fort", emoji: null, impacts: { [edited.questions[0].answers[0] ? Object.keys(edited.questions[0].answers[0].impacts)[0] : "intensity"]: 0.1 } });
  assertValidates(edited, ctx);
  edited.questions[0].answers.pop();
  assertValidates(edited, ctx);
  edited.questions[0].answers = edited.questions[0].answers.slice(0, 1);
  assert.throws(() => assertValidates(edited, ctx), /réponses attendues/);
});

test("validation : critère supprimé sans nettoyer les impacts → référence inexistante refusée ; nettoyé → accepté", () => {
  const ctx = coffee();
  const draft = proposeExpressQuiz(ctx, { questionCount: 7 }).draft!;
  const removed = "acidity";
  const dangling: ExpressDraft = { ...draft, axes: draft.axes.filter((a) => a.key !== removed) };
  assert.throws(() => assertValidates(dangling, ctx), /critère inexistant \(acidity\)/);
  const cleaned: ExpressDraft = {
    ...dangling,
    questions: draft.questions.flatMap((q) => {
      const answers = q.answers.map((a) => ({ ...a, impacts: Object.fromEntries(Object.entries(a.impacts).filter(([k]) => k !== removed)) }));
      const distinct = new Set(answers.map((a) => JSON.stringify(a.impacts))).size;
      return distinct >= 2 ? [{ ...q, answers }] : [];
    }),
  };
  const result = assertValidates(cleaned, ctx);
  assert.deepEqual(result.draft.axes.map((a) => a.key).sort(), ["body", "intensity", "sweetness"]);
});

test("validation : brouillons structurellement invalides refusés", () => {
  const ctx = coffee();
  const base = proposeExpressQuiz(ctx).draft!;
  const clone = () => JSON.parse(JSON.stringify(base)) as ExpressDraft;
  const reject = (mutate: (d: ExpressDraft) => void, pattern: RegExp) => {
    const draft = clone();
    mutate(draft);
    assert.throws(() => validateExpressDraft(draft, ctx), pattern);
  };
  reject((d) => { d.questions[0].answers[0].impacts = { intensity: 5 }; }, /entre -1 et 1/);
  reject((d) => { d.questions[0].answers[0].impacts = { intensity: "0.2" as unknown as number }; }, /nombre/);
  reject((d) => { d.questions[0].answers[0].impacts = { fantome: 0.2 }; }, /inexistant/);
  reject((d) => { d.questions.forEach((q) => q.answers.forEach((a) => { delete a.impacts.body; })); }, /n'est influencé par aucune réponse|trop peu/);
  reject((d) => { d.questions[0].answers.forEach((a) => { a.impacts = {}; }); }, /aucun effet distinct/);
  reject((d) => { d.questions[0].answers = d.questions[0].answers.map((a) => ({ ...a, impacts: { intensity: 0.2 } })); }, /aucun effet distinct/);
  reject((d) => { d.questions[1].text = d.questions[0].text; }, /en double/);
  reject((d) => { d.axes[1].key = d.axes[0].key; }, /double/);
  reject((d) => { d.axes[0].key = "1 mauvaise clé"; }, /Clé d'axe invalide/);
  reject((d) => { d.axes = []; }, /critères/);
  reject((d) => { d.questions = []; }, /questions/);
  reject((d) => { d.questions[0].answers[0].text = ""; }, /requis/);
  assert.throws(() => validateExpressDraft(null, ctx), /invalide/);
});

test("validation : critère trop peu influencé et valeurs produit hors échelle", () => {
  const ctx = coffee();
  const draft = proposeExpressQuiz(ctx).draft!;
  const weak = JSON.parse(JSON.stringify(draft)) as ExpressDraft;
  weak.questions.forEach((q) => q.answers.forEach((a) => { if (a.impacts.body !== undefined) a.impacts.body = Math.sign(a.impacts.body) * 0.02; }));
  assert.throws(() => validateExpressDraft(weak, ctx), /trop peu influencé/);
  const broken = context({ products: [...COFFEES, product("bad", "Café cassé", { intensity: 7 })], industry: "café" });
  assert.throws(() => validateExpressDraft(draft, broken), /hors de l'échelle 0–1/);
});

test("fiabilité recalculée côté serveur, indépendante de ce que le client déclare", () => {
  const flat = context({ products: COFFEES.map((p, i) => product(p.id, p.name, { intensity: 0.5, acidity: 0.5 })), industry: "café" });
  const draft = proposeExpressQuiz(coffee()).draft!;
  const forged = { ...draft, reliability: "reliable" } as ExpressDraft;
  const { validation } = validateExpressDraft(forged, flat);
  assert.equal(validation.reliability, "insufficient");
  assert.ok(validation.warnings.some((w) => w.includes("non fiables")));
});

test("alternatives : questions compatibles non utilisées, sans doublon avec le brouillon", () => {
  const { draft, alternatives } = proposeExpressQuiz(coffee(), { questionCount: 3 });
  assert.ok(alternatives.length > 0);
  const used = new Set(draft!.questions.map((q) => q.text));
  const allowed = new Set(keys(draft!));
  for (const alt of alternatives) {
    assert.ok(!used.has(alt.text));
    for (const a of alt.answers) for (const k of Object.keys(a.impacts)) assert.ok(allowed.has(k));
  }
});

test("régression scoring : profil 0,5 + impacts bornés, 60 % sémantique / 40 % axes inchangés", () => {
  const axes = [{ key: "a", label: "A" }];
  assert.deepEqual(computeProfile(axes, [{ a: 0.9 }, { a: 0.9 }, { a: -0.3 }]), { a: 0.7 });
  assert.deepEqual(computeProfile(axes, [{ a: -0.9 }, { a: -0.9 }, { a: 0.3 }]), { a: 0.3 });
  const engine = readFileSync(join(__dirname, "../../poapoai/main.py"), "utf8");
  assert.ok(engine.includes('"score": 0.6 * semantic_score + 0.4 * axial_score'));
});

test("aucune dépendance OpenAI dans la génération express", () => {
  for (const file of ["expressQuiz.ts", "expressSectors.ts"]) {
    const source = readFileSync(join(__dirname, "../src/services", file), "utf8");
    assert.ok(!/openai/i.test(source), file);
  }
});

test("remplacer un critère : la clé exclue n'est jamais reproposée, les autres sont conservés", () => {
  const { draft } = proposeExpressQuiz(coffee(), { exclude: ["acidity"] });
  assert.ok(!keys(draft!).includes("acidity"));
  assert.ok(!touchedKeys(draft!).has("acidity"));
  assert.deepEqual(keys(draft!).sort(), ["body", "intensity", "sweetness"]);
  // L'exclusion vaut aussi pour les critères sans donnée.
  const bare = ["Café A", "Café B", "Café C"].map((name, i) => product(`x${i}`, name, {}, { embeddingReady: true }));
  const result = proposeExpressQuiz(context({ products: bare, industry: "Café" }), { exclude: ["intensity"] });
  assert.ok(!keys(result.draft!).includes("intensity"));
});
