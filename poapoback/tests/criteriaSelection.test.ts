import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { profileColumns } from "../src/services/catalogProfile";
import { CRITERIA_SELECTION_THRESHOLDS as T, selectQuizCriteria, type CriteriaSelection, type SelectableProduct } from "../src/services/criteriaSelection";
import { ALL_FIXTURES } from "./fixtures/catalogProfileFixtures";
import { coffeeSeeded, fashionSeeded, noUsefulCriteria, perfumeSeeded, rng } from "./fixtures/selectionFixtures";

const AXES: Record<string, string[]> = { perfume: ["freshness", "woody", "sweetness", "intensity"], coffee: ["acidity", "intensity"], fashion: ["confort"] };
const run = (products: SelectableProduct[], axisKeys: string[] = [], options = {}) => selectQuizCriteria(profileColumns(products, { axisKeys }), products, options);
const get = (selection: CriteriaSelection, id: string) => {
  const found = selection.criteria.find((c) => c.id === id);
  assert.ok(found, `${id} absent : ${selection.criteria.map((c) => c.id).join(", ")}`);
  return found;
};
const selectedIds = (selection: CriteriaSelection) => selection.criteria.filter((c) => c.status === "selected").map((c) => c.id);

test("Parfum : genre, famille, prix et axes retenus ; référence EAN, marque et mots-clés jamais retenus d'office", () => {
  const selection = run(perfumeSeeded(), AXES.perfume);
  const ids = selectedIds(selection);
  for (const id of ["attribute.genre", "attribute.famille", "price"]) assert.ok(ids.includes(id), `${id} devrait être retenu : ${ids}`);
  assert.ok(ids.some((id) => ["attribute.freshness", "attribute.intensity", "attribute.sweetness", "attribute.woody"].includes(id)));
  assert.equal(get(selection, "attribute.sku").status, "rejected");
  assert.equal(get(selection, "attribute.sku").rejection?.code, "IDENTIFIER_LIKE");
  assert.equal(get(selection, "brand").status, "needs_validation");
  assert.match(get(selection, "brand").validationReason ?? "", /valider/);
  assert.equal(get(selection, "tags").status, "needs_validation");
  assert.ok(selection.criteria.length > 0 && selectedIds(selection).length <= T.maxCriteria);
});

test("Café et Mode : même mécanisme, aucune règle sectorielle", () => {
  const coffee = run(coffeeSeeded(), AXES.coffee);
  for (const id of ["attribute.origine", "price"]) assert.ok(selectedIds(coffee).includes(id), id);
  assert.equal(get(coffee, "attribute.poids_g").needsValidation, true, "mesure technique : à valider, jamais décidée automatiquement");
  const fashion = run(fashionSeeded(), AXES.fashion);
  for (const id of ["attribute.categorie", "attribute.couleur", "price"]) assert.ok(selectedIds(fashion).includes(id), id);
  const source = readFileSync(join(__dirname, "..", "src", "services", "criteriaSelection.ts"), "utf8");
  assert.ok(!/parfum|perfume|caf[eé]\b|coffee|fashion|voyage|travel/i.test(source), "aucun mot sectoriel dans le sélecteur");
});

test("redondance : un doublon exact est écarté, un critère seulement corrélé est conservé", () => {
  const selection = run(perfumeSeeded(60), AXES.perfume);
  const twin = get(selection, "attribute.ligne");
  assert.equal(twin.status, "rejected");
  assert.equal(twin.rejection?.code, "REDUNDANT");
  assert.equal(twin.mostSimilarTo, "attribute.famille");
  assert.ok(twin.redundancy > 0.95);
  const family = get(selection, "attribute.famille");
  assert.equal(family.status, "selected");
  const genre = get(selection, "attribute.genre");
  assert.ok(genre.redundancy < 0.3, `genre est indépendant de la famille (${genre.redundancy})`);
  const freshness = get(selection, "attribute.freshness");
  assert.ok(freshness.status === "selected" && freshness.redundancy < 0.6, "corrélée à la famille mais conservée");
});

test("le gain tient compte de la couverture : un critère à moitié renseigné pèse moins, sans être exclu", () => {
  const full = perfumeSeeded(60);
  const partial = full.map((p, i) => i % 2 === 0 ? p : { ...p, attributes: { ...(p.attributes as object), genre: undefined } });
  const a = get(run(full, AXES.perfume, { maxCriteria: 10 }), "attribute.genre");
  const b = get(run(partial, AXES.perfume, { maxCriteria: 10 }), "attribute.genre");
  assert.ok(b.gain < a.gain * 0.65 && b.gain > a.gain * 0.35, `gain proportionnel à la couverture : ${b.gain} vs ${a.gain}`);
  assert.equal(b.status, "selected", "couverture partielle ≠ inutilisable");
  assert.ok(b.warnings.some((w) => /Renseigné sur/.test(w)));
});

test("métadonnées et codes internes : jamais des questions", () => {
  const selection = run(noUsefulCriteria());
  assert.equal(selectedIds(selection).length, 0);
  assert.ok(selection.criteria.every((c) => c.status === "rejected"));
  assert.equal(get(selection, "attribute.fournisseur").rejection?.code, "METADATA_FIELD");
  assert.equal(get(selection, "attribute.pays").rejection?.code, "CONSTANT_VALUE");
  assert.equal(get(selection, "attribute.notes").rejection?.code, "UNSUPPORTED_STRUCTURE");
  assert.equal(get(selection, "attribute.code").rejection?.code, "IDENTIFIER_LIKE");
  const codes = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, attributes: { gamme: ["A12", "B34", "C56", "D78"][i % 4] } }));
  assert.equal(get(run(codes), "attribute.gamme").rejection?.code, "CODE_LIKE_VALUES");
});

test("catégories nombreuses : plafonnées en options, valeurs rares regroupées ; trop nombreuses = refusées", () => {
  const r = rng(7);
  const eight = Array.from({ length: 80 }, (_, i) => ({ id: `e${i}`, attributes: { style: `Style ${"ABCDEFGH"[Math.floor(r() * 8)]}` } }));
  const style = get(run(eight), "attribute.style");
  assert.equal(style.options.length, T.maxOptions);
  assert.ok(style.otherCount >= 2);
  assert.ok(style.warnings.some((w) => /regroupée/.test(w)));
  assert.ok(style.factors.clarity < 1, "plus de 6 choix : moins lisible");
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, attributes: { modele: `Modèle ${i % 30}` } }));
  assert.equal(get(run(many), "attribute.modele").rejection?.code, "HIGH_CARDINALITY");
  assert.equal(style.handling, "categorical_choice");
});

test("prix et mesures : options dérivées de la distribution réelle, jamais d'intervalles arbitraires", () => {
  const products = perfumeSeeded(80);
  const price = get(run(products, AXES.perfume), "price");
  const values = products.map((p) => p.price!).sort((a, b) => a - b);
  assert.equal(price.handling, "budget_range");
  assert.equal(price.options.length, 3);
  assert.equal(price.options.reduce((s, o) => s + o.count, 0), price.productCount);
  assert.equal(price.options[0].from, values[0]);
  assert.equal(price.options[price.options.length - 1].to, values[values.length - 1]);
  for (let i = 1; i < price.options.length; i++) assert.ok(price.options[i].from! > price.options[i - 1].to!, "bandes disjointes");
  assert.ok(Math.abs(price.options[0].count - price.options[2].count) <= Math.ceil(values.length * 0.2), "terciles : effectifs comparables");
  // Peu de valeurs distinctes (30 / 50 / 100 ml) : une option par valeur réelle.
  const size = get(run(products, AXES.perfume), "attribute.contenance");
  assert.deepEqual(size.options.map((o) => o.label).sort(), ["100", "30", "50"]);
  // Un plafond strict n'est jamais activé automatiquement.
  assert.equal(price.mode.default, "preference");
  assert.equal(price.mode.strictRequiresMerchant, true);
  assert.equal(price.mode.strictPossible, true);
});

test("booléens, mesures et mots-clés : proposés mais soumis à validation du commerçant ; exigence jamais décidée seule", () => {
  const selection = run(perfumeSeeded(60), AXES.perfume);
  const vegan = get(selection, "attribute.vegan");
  assert.equal(vegan.handling, "yes_no");
  assert.ok(vegan.status === "needs_validation" || vegan.status === "rejected");
  assert.notEqual(vegan.status, "selected");
  assert.equal(get(selection, "tags").engine.compatibility, "needs_rerank");
  for (const c of selection.criteria) assert.equal(c.mode.default, "preference");
});

test("compatibilité moteur : axe connu = direct ; catégories et prix = mécanisme de réponse à ajouter", () => {
  const selection = run(perfumeSeeded(), AXES.perfume);
  assert.equal(get(selection, "attribute.freshness").engine.compatibility, "direct_axis");
  assert.equal(get(selection, "attribute.famille").engine.compatibility, "needs_filter");
  assert.equal(get(selection, "price").engine.compatibility, "needs_filter");
  const undeclared = run(perfumeSeeded(), []);
  assert.equal(get(undeclared, "attribute.freshness").engine.compatibility, "derived_axis");
});

test("déterminisme, ordre des produits et absence de mutation", () => {
  for (const build of [perfumeSeeded, coffeeSeeded, fashionSeeded]) {
    const products = build();
    const snapshot = JSON.stringify(products);
    const reference = JSON.stringify(run(products));
    assert.equal(JSON.stringify(run(products)), reference);
    assert.equal(JSON.stringify(run([...products].reverse())), reference);
    assert.equal(JSON.stringify(products), snapshot, "aucune mutation");
  }
  // Au-delà de l'échantillon (600), le résultat reste indépendant de l'ordre grâce aux identifiants.
  const big = perfumeSeeded(1500);
  assert.equal(JSON.stringify(run(big)), JSON.stringify(run([...big].reverse())));
  assert.equal(run(big).sampled, true);
});

test("fixtures du lot 10B (motifs modulo) : la dépendance entre colonnes est détectée, pas masquée", () => {
  const products = ALL_FIXTURES.perfume().products.map((p) => ({ id: p.id, price: p.price, brand: p.brand, tags: p.tags, attributes: p.attributes }));
  const selection = run(products, AXES.perfume);
  assert.equal(get(selection, "attribute.genre").status, "rejected", "genre est une fonction de la famille dans ces fixtures");
  assert.equal(get(selection, "attribute.genre").rejection?.code, "REDUNDANT");
  assert.equal(get(selection, "attribute.genre").mostSimilarTo, "attribute.famille");
});

test("catalogue dégradé du lot 10B : seuls le prix et la note partielle restent", () => {
  const products = ALL_FIXTURES.degraded().products.map((p) => ({ id: p.id, price: p.price, brand: p.brand, tags: p.tags, attributes: p.attributes }));
  const selection = run(products);
  assert.deepEqual(selectedIds(selection).sort(), ["attribute.note", "price"]);
  assert.equal(get(selection, "attribute.refInterne").rejection?.code, "IDENTIFIER_LIKE");
  assert.equal(get(selection, "attribute.pays").rejection?.code, "CONSTANT_VALUE");
});

test("catalogue vide, un seul produit, limites personnalisées", () => {
  assert.deepEqual(selectQuizCriteria([], [], {}), { totalProducts: 0, sampled: false, criteria: [] });
  const one = run([{ id: "a", price: 10, attributes: { x: "a" } }]);
  assert.equal(selectedIds(one).length, 0);
  const limited = run(perfumeSeeded(), AXES.perfume, { maxCriteria: 2 });
  assert.equal(selectedIds(limited).length, 2);
  assert.ok(limited.criteria.some((c) => c.rejection?.code === "LIMIT_REACHED"));
});

test("chaque critère expose les informations nécessaires à la génération", () => {
  for (const c of run(perfumeSeeded(), AXES.perfume).criteria.filter((x) => x.status !== "rejected")) {
    assert.ok(c.id && c.label && c.type && c.source && c.handling);
    assert.ok(c.options.length >= 2, c.id);
    assert.ok(c.coverage > 0 && c.score > 0);
    assert.ok(c.reasons.length >= 2);
    assert.ok(c.engine.compatibility && c.engine.note);
    assert.ok(c.factors.reliability > 0 && c.factors.clarity > 0);
  }
});

test("performance : 40, 500, 2 000 et 5 000 produits", { timeout: 30_000 }, () => {
  for (const size of [40, 500, 2000, 5000]) {
    const products = perfumeSeeded(size);
    const profiles = profileColumns(products, { axisKeys: AXES.perfume });
    const start = performance.now();
    selectQuizCriteria(profiles, products);
    const ms = performance.now() - start;
    console.log(`perf selectQuizCriteria ${size} produits : ${ms.toFixed(0)} ms`);
    assert.ok(ms < 3000, `${size} : ${ms} ms`);
  }
});
