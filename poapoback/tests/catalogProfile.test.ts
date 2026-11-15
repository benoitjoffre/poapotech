import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { COLUMN_PROFILE_THRESHOLDS as T, normalizeText, profileColumns, type ProfilableProduct } from "../src/services/catalogProfile";
import { proposeExpressQuiz } from "../src/services/expressQuiz";
import { ALL_FIXTURES, degradedCatalog, perfumeCatalog } from "./fixtures/catalogProfileFixtures";
import { snapshotAll } from "./fixtures/expressSnapshot";

const find = (list: ReturnType<typeof profileColumns>, key: string) => {
  const column = list.find((item) => item.key === key);
  assert.ok(column, `colonne ${key} absente`);
  return column;
};
const rows = (count: number, build: (i: number) => ProfilableProduct): ProfilableProduct[] => Array.from({ length: count }, (_, i) => build(i));

test("axe numérique : NUMERIC, exploitable, signalé comme axe connu", () => {
  const columns = profileColumns(rows(20, (i) => ({ attributes: { intensity: (i % 10) / 10 } })), { axisKeys: ["intensity"] });
  const column = find(columns, "attribute.intensity");
  assert.equal(column.inferredType, "NUMERIC");
  assert.equal(column.usable, true);
  assert.equal(column.knownAxis, true);
  assert.equal(column.distribution.kind, "numeric");
  assert.equal(column.normalizedEntropy, null);
});

test("prix : RANGE, candidat contrainte quand il est bien renseigné ; prix négatif = valeur invalide", () => {
  const price = find(profileColumns(rows(20, (i) => ({ price: 10 + i * 3 }))), "price");
  assert.equal(price.inferredType, "RANGE");
  assert.equal(price.usable, true);
  assert.equal(price.constraintCandidate, true);
  const partial = find(profileColumns(rows(20, (i) => ({ price: i < 12 ? 10 + i * 3 : null }))), "price");
  assert.equal(partial.usable, true, "couverture partielle ≠ inutilisable");
  assert.equal(partial.constraintCandidate, false, "sous 90 % de couverture, jamais candidat contrainte");
  assert.deepEqual(partial.warnings.map((w) => w.code), ["PARTIAL_COVERAGE"]);
  const negative = find(profileColumns(rows(10, (i) => ({ price: i < 4 ? -1 : 10 + i }))), "price");
  assert.equal(negative.rejection?.code, "INVALID_VALUES");
});

test("catégorie textuelle : CATEGORICAL, entropie et distribution ; une catégorie n'est jamais candidat contrainte", () => {
  const colors = ["Rouge", "Bleu", "Vert"];
  const column = find(profileColumns(rows(30, (i) => ({ attributes: { couleur: colors[i % 3] } }))), "attribute.couleur");
  assert.equal(column.inferredType, "CATEGORICAL");
  assert.equal(column.distinctCount, 3);
  assert.equal(column.normalizedEntropy, 1);
  assert.equal(column.constraintCandidate, false);
  assert.equal(column.distribution.kind === "categorical" && column.distribution.values.length, 3);
});

test("booléens (vrai booléen, oui/non, 0/1) : CATEGORICAL à deux valeurs, candidat contrainte", () => {
  for (const make of [(i: number) => i % 2 === 0, (i: number) => (i % 2 ? "Oui" : "non"), (i: number) => i % 2]) {
    const column = find(profileColumns(rows(20, (i) => ({ attributes: { bio: make(i) } }))), "attribute.bio");
    assert.equal(column.inferredType, "CATEGORICAL");
    assert.equal(column.distinctCount, 2);
    assert.equal(column.usable, true);
    assert.equal(column.constraintCandidate, true);
  }
});

test("tags : colonne de type liste, couverture = produits ayant au moins un tag", () => {
  const tags = rows(20, (i) => ({ tags: i % 2 ? ["Frais", " frais ", "Bois"] : [] }));
  const column = find(profileColumns(tags), "tags");
  assert.equal(column.valueKind, "list");
  assert.equal(column.productCount, 10);
  assert.equal(column.coverage, 0.5);
  assert.equal(column.distinctCount, 2, "« Frais » et « frais » = une seule valeur pour les statistiques");
  assert.ok(column.usable);
  const huge = find(profileColumns(rows(60, (i) => ({ tags: [`t${i}`, `u${i}`] }))), "tags");
  assert.equal(huge.rejection?.code, "HIGH_CARDINALITY");
});

test("valeurs absentes : null, undefined et chaînes vides ne comptent pas ; rien n'est inventé", () => {
  const column = find(profileColumns(rows(10, (i) => ({ attributes: { x: i < 5 ? ["a", "b"][i % 2] : [null, undefined, "", "  "][i - 5 < 4 ? i - 5 : 0] } }))), "attribute.x");
  assert.equal(column.productCount, 5);
  assert.equal(column.coverage, 0.5);
  const empty = find(profileColumns(rows(10, () => ({ brand: null }))), "brand");
  assert.equal(empty.rejection?.code, "INSUFFICIENT_COVERAGE");
  assert.equal(empty.valueKind, "none");
});

test("colonne constante, quasi constante et plate", () => {
  const constant = find(profileColumns(rows(20, () => ({ attributes: { pays: "France", score: 0.5 } }))), "attribute.pays");
  assert.equal(constant.rejection?.code, "CONSTANT_VALUE");
  assert.equal(find(profileColumns(rows(20, () => ({ attributes: { score: 0.5 } }))), "attribute.score").rejection?.code, "CONSTANT_VALUE");
  const almost = find(profileColumns(rows(40, (i) => ({ attributes: { statut: i === 0 ? "retiré" : "actif" } }))), "attribute.statut");
  assert.equal(almost.rejection?.code, "INSUFFICIENT_VARIATION");
  // 38 valeurs identiques + 2 extrêmes : l'écart robuste (p10–p90) est nul.
  const outliers = find(profileColumns(rows(40, (i) => ({ attributes: { mesure: i === 0 ? 0 : i === 1 ? 1 : 0.5 } }))), "attribute.mesure");
  assert.equal(outliers.rejection?.code, "INSUFFICIENT_VARIATION");
});

test("forte cardinalité et texte libre ne deviennent pas des catégories", () => {
  const unique = find(profileColumns(rows(40, (i) => ({ attributes: { modele: `modèle-${i}` } }))), "attribute.modele");
  assert.equal(unique.rejection?.code, "HIGH_CARDINALITY");
  const many = find(profileColumns(rows(60, (i) => ({ attributes: { modele: `m${i % 15}` } }))), "attribute.modele");
  assert.equal(many.rejection?.code, "HIGH_CARDINALITY");
  const free = find(profileColumns(rows(20, (i) => ({ attributes: { notes: `Un long texte descriptif qui ressemble à une phrase complète n°${i % 3}` } }))), "attribute.notes");
  assert.equal(free.rejection?.code, "UNSUPPORTED_STRUCTURE");
});

test("un identifiant numérique n'est pas une mesure", () => {
  const ean = find(profileColumns(rows(20, (i) => ({ attributes: { code: 3_760_000_000_000 + i } }))), "attribute.code");
  assert.equal(ean.rejection?.code, "IDENTIFIER_LIKE");
  const named = find(profileColumns(rows(20, (i) => ({ attributes: { sku: i * 2 + 1 } }))), "attribute.sku");
  assert.equal(named.rejection?.code, "IDENTIFIER_LIKE");
  // Des prix tous distincts restent une mesure.
  assert.equal(find(profileColumns(rows(20, (i) => ({ price: 20 + i }))), "price").usable, true);
});

test("valeurs numériques invalides et structures imbriquées", () => {
  const mixed = find(profileColumns(rows(20, (i) => ({ attributes: { poids: i % 4 === 0 ? "250g" : 100 + (i % 5) * 50 } }))), "attribute.poids");
  assert.equal(mixed.rejection?.code, "INVALID_VALUES");
  assert.ok(mixed.parseRate < T.minParseRate);
  const nested = find(profileColumns(rows(20, () => ({ attributes: { options: { a: 1 } } }))), "attribute.options");
  assert.equal(nested.rejection?.code, "UNSUPPORTED_STRUCTURE");
  assert.equal(nested.inferredType, "UNKNOWN");
});

test("distribution déséquilibrée : exploitable avec avertissement, pas refusée", () => {
  const column = find(profileColumns(rows(40, (i) => ({ attributes: { type: i < 33 ? "A" : ["B", "C"][i % 2] } }))), "attribute.type");
  assert.equal(column.usable, true);
  assert.ok(column.warnings.some((w) => w.code === "IMBALANCED_DISTRIBUTION"));
  assert.ok(column.normalizedEntropy! < 0.6);
});

test("normalisation : casse, espaces, accents regroupés pour les statistiques, valeurs d'origine intactes, sans mutation", () => {
  assert.equal(normalizeText("  Boisé   Ambré "), "boise ambre");
  const products = rows(30, (i) => ({ brand: ["Maison  Aube", "maison aube", "MAISON AUBE", "Autre", "Autre ", "Brume"][i % 6], attributes: { couleur: i % 2 ? "Bleue" : "Bleu" } }));
  const before = JSON.stringify(products);
  const columns = profileColumns(products);
  assert.equal(JSON.stringify(products), before, "les produits ne sont pas modifiés");
  const brand = find(columns, "brand");
  assert.equal(brand.distinctCount, 3);
  assert.ok(brand.warnings.some((w) => w.code === "MERGED_VARIANTS"));
  // Deux catégories métier voisines ne sont jamais fusionnées sur leur ressemblance.
  assert.equal(find(columns, "attribute.couleur").distinctCount, 2);
});

test("indépendant de l'ordre des produits et déterministe", () => {
  for (const build of Object.values(ALL_FIXTURES)) {
    const products = build().products;
    const reference = JSON.stringify(profileColumns(products));
    assert.equal(JSON.stringify(profileColumns(products)), reference);
    assert.equal(JSON.stringify(profileColumns([...products].reverse())), reference);
    const shuffled = [...products].sort((a, b) => (a.id.charCodeAt(a.id.length - 1) * 7 % 10) - (b.id.charCodeAt(b.id.length - 1) * 7 % 10) || a.id.localeCompare(b.id));
    assert.equal(JSON.stringify(profileColumns(shuffled)), reference);
  }
});

test("catalogue vide, un seul produit, deux produits", () => {
  assert.deepEqual(profileColumns([]), []);
  const one = profileColumns([{ price: 10, brand: "A", tags: ["x"], attributes: { couleur: "Rouge" } }]);
  assert.ok(one.length > 0 && one.every((column) => !column.usable && column.rejection?.code === "TOO_FEW_PRODUCTS"));
  const two = profileColumns([{ price: 10 }, { price: 20 }]);
  assert.equal(find(two, "price").rejection?.code, "INSUFFICIENT_COVERAGE", "2 valeurs < minPresentCount");
});

test("catalogue volumineux : 5 000 produits sans erreur", () => {
  const columns = profileColumns(rows(5000, (i) => ({ price: 5 + (i % 300), brand: `m${i % 7}`, tags: [`t${i % 9}`], attributes: { a: (i % 100) / 100, b: i % 2 === 0 } })));
  assert.equal(find(columns, "price").usable, true);
  assert.equal(find(columns, "brand").distinctCount, 7);
});

test("l'analyse ne dépend pas du secteur : mêmes données, activité et noms différents, même diagnostic", () => {
  const base = perfumeCatalog();
  const renamed = { ...base, industry: "Voyage", catalogName: "Séjours", products: base.products.map((p) => ({ ...p, name: `Séjour ${p.id}`, description: "trek" })) };
  assert.deepEqual(profileColumns(renamed.products), profileColumns(base.products));
  const analysis = proposeExpressQuiz(base).analysis.columns;
  const other = proposeExpressQuiz(renamed).analysis.columns;
  assert.deepEqual(analysis, other);
});

test("ne profile jamais le nom, l'identifiant ni la description", () => {
  const keys = profileColumns(perfumeCatalog().products).map((column) => column.key);
  assert.ok(!keys.some((key) => /name|description|^id$/.test(key)));
});

test("fixtures : diagnostic Parfum (genre, famille, prix détectés ; sku refusé)", () => {
  const columns = profileColumns(perfumeCatalog().products, { axisKeys: ["intensity", "freshness", "sweetness", "woody"] });
  assert.equal(find(columns, "attribute.genre").inferredType, "CATEGORICAL");
  assert.equal(find(columns, "attribute.famille").distinctCount, 6);
  assert.equal(find(columns, "price").inferredType, "RANGE");
  assert.equal(find(columns, "attribute.intensity").knownAxis, true);
  assert.equal(find(columns, "attribute.sku").rejection?.code, "IDENTIFIER_LIKE");
});

test("fixtures : catalogue dégradé, chaque défaut reçoit son motif", () => {
  const columns = profileColumns(degradedCatalog().products);
  const reason = (key: string) => find(columns, key).rejection?.code;
  assert.equal(reason("attribute.pays"), "CONSTANT_VALUE");
  assert.equal(reason("attribute.statut"), "INSUFFICIENT_VARIATION");
  assert.equal(reason("attribute.poids"), "INVALID_VALUES");
  assert.equal(reason("attribute.refInterne"), "IDENTIFIER_LIKE");
  assert.equal(reason("attribute.notes"), "UNSUPPORTED_STRUCTURE");
  assert.equal(reason("attribute.options"), "UNSUPPORTED_STRUCTURE");
  assert.equal(reason("attribute.couleur"), "INSUFFICIENT_COVERAGE");
  assert.equal(find(columns, "attribute.note").usable, true, "40 % de couverture : exploitable avec avertissement");
  assert.equal(find(columns, "price").usable, true);
});

test("seuils centralisés et cohérents", () => {
  assert.ok(T.minCoverage > 0 && T.minCoverage < T.fullCoverage && T.fullCoverage <= 1);
  assert.ok(T.imbalancedShare < T.maxDominantShare && T.maxDominantShare < 1);
  assert.ok(T.minParseRate > 0.5 && T.minParseRate <= 1);
});

// ─── Non-régression : le diagnostic n'a aucun effet sur la génération ─────────

test("non-régression : axes, questions, réponses, impacts et Top 3 simulés identiques à l'instantané d'avant le lot 10B", () => {
  const baseline = JSON.parse(readFileSync(join(__dirname, "fixtures", "express-baseline.json"), "utf8"));
  assert.deepEqual(snapshotAll(), baseline);
});

test("l'analyse expose le diagnostic de façon additive, sans modifier le reste du contrat", () => {
  const proposal = proposeExpressQuiz(perfumeCatalog());
  assert.ok(Array.isArray(proposal.analysis.columns) && proposal.analysis.columns.length > 0);
  for (const key of ["catalogId", "productCount", "reliability", "messages", "candidates", "missingForSector"]) assert.ok(key in proposal.analysis);
});

test("performance : 40, 500 et 5 000 produits", { timeout: 20_000 }, () => {
  const sizes = [40, 500, 5000];
  for (const size of sizes) {
    const products = rows(size, (i) => ({
      price: 20 + ((i * 17) % 180), brand: `marque ${i % 8}`, tags: [`t${i % 12}`, `u${i % 5}`],
      attributes: { genre: ["Femme", "Homme", "Mixte"][i % 3], famille: `f${i % 6}`, intensity: (i % 100) / 100, fraicheur: ((i * 7) % 100) / 100, bio: i % 2 === 0 },
    }));
    profileColumns(products);
    const start = performance.now();
    const runs = 5;
    for (let r = 0; r < runs; r++) profileColumns(products);
    const ms = (performance.now() - start) / runs;
    console.log(`perf profileColumns ${size} produits : ${ms.toFixed(2)} ms`);
    assert.ok(ms < 1000, `${size} produits : ${ms} ms`);
  }
});
