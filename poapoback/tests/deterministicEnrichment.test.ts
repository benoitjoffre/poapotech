import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuizAxis } from "@poapo/types";
import { canonicalPerfumeAxis, estimateAxes, type EnrichableProduct } from "../src/services/deterministicEnrichment";

const AXES: QuizAxis[] = [
  { key: "freshness", label: "Fraîcheur", lowLabel: "Chaleureux", highLabel: "Frais" },
  { key: "intensity", label: "Intensité", lowLabel: "Discret", highLabel: "Puissant" },
  { key: "sweetness", label: "Douceur", lowLabel: "Sec", highLabel: "Gourmand" },
  { key: "woody", label: "Caractère boisé", lowLabel: "Peu boisé", highLabel: "Très boisé" },
];

const product = (over: Partial<EnrichableProduct> = {}): EnrichableProduct => ({ name: "Parfum", tags: [], description: null, attributes: {}, ...over });
const by = (p: EnrichableProduct, axes = AXES) => Object.fromEntries(estimateAxes(p, axes).map((e) => [e.axis, e]));

test("une estimation par axe, dans l'ordre, format AxisEstimate", () => {
  const out = estimateAxes(product({ tags: ["frais"] }), AXES);
  assert.deepEqual(out.map((e) => e.axis), AXES.map((a) => a.key));
  for (const e of out) {
    assert.ok(e.status === "estimated" ? e.value !== null && e.value > 0 && e.value < 1 && e.confidence !== null : e.value === null && e.confidence === null);
  }
});

test("mots entiers et accents", () => {
  const upper = by(product({ tags: ["FRAÎCHE"], description: "Notes AÉRIENNES" }));
  assert.equal(upper.freshness.status, "estimated");
  assert.ok(upper.freshness.value! > 0.5);
  // Mots voisins : aucun déclenchement par sous-chaîne.
  const lookalike = by(product({ description: "Une marinade fraichement préparée, intensément, boisement et gourmandement" }));
  for (const key of ["freshness", "intensity", "sweetness", "woody"]) assert.equal(lookalike[key].status, "insufficient_data", key);
  // Forme décomposée (e + accent combinant) reconnue, et citation conservée telle qu'écrite.
  const decomposed = by(product({ tags: ["boiśe".replace("iśe", "isé")] }));
  assert.equal(decomposed.woody.status, "estimated");
  assert.equal(decomposed.woody.evidence[0], "boisé");
});

test("la citation est un extrait verbatim de la fiche", () => {
  const p = product({ name: "Forêt Profonde", tags: ["Boisé", "vétiver"], description: "Cèdre, vétiver et mousse de chêne. Boisé, terreux." });
  const woody = by(p).woody;
  const source = [p.name, ...p.tags, p.description].join(" | ");
  assert.ok(woody.evidence.length > 0);
  for (const quote of woody.evidence) assert.ok(source.includes(quote), quote);
});

test("pôles contradictoires : insufficient_data, jamais une moyenne", () => {
  const mixed = by(product({ tags: ["frais", "chaud"], description: "Fort sillage mais parfum discret" }));
  assert.equal(mixed.freshness.status, "insufficient_data");
  assert.equal(mixed.freshness.value, null);
  assert.match(mixed.freshness.rationale, /contradictoires/);
  assert.ok(mixed.freshness.evidence.length >= 2);
  assert.equal(mixed.intensity.status, "insufficient_data");
  assert.match(mixed.intensity.rationale, /contradictoires/);
  // Un niveau intermédiaire explicite ne se combine pas avec un pôle.
  assert.equal(by(product({ tags: ["modéré", "léger"] })).intensity.status, "insufficient_data");
});

test("absence de mention et absence de valeur : jamais 0, jamais 0,5", () => {
  const empty = by(product({ name: "Mystère", description: "Un grand classique de la maison depuis 1920." }));
  for (const e of Object.values(empty)) {
    assert.equal(e.status, "insufficient_data");
    assert.equal(e.value, null);
    assert.equal(e.confidence, null);
    assert.deepEqual(e.evidence, []);
  }
  // Aucune valeur extrême ne sort jamais des règles.
  const samples = ["frais frais frais", "très intense puissant", "gourmand vanille caramel", "boisé cèdre santal", "discret léger", "sec", "chaud ambré"];
  for (const text of samples) {
    for (const e of estimateAxes(product({ description: text, tags: [text] }), AXES)) if (e.value !== null) assert.ok(e.value >= 0.15 && e.value <= 0.85, `${text}: ${e.value}`);
  }
});

test("faux positifs : bois de figuier, sillage discret, négations", () => {
  const fig = by(product({ name: "Figue Méditerranée", description: "Figue verte, bois de figuier et lait de coco." }));
  assert.equal(fig.woody.status, "insufficient_data");
  const gris = by(product({ description: "Oud précieux, safran et ambre gris." }));
  assert.equal(gris.freshness.status, "insufficient_data", "« ambre gris » n'est pas un accord ambré chaud");
  assert.equal(by(product({ description: "Un ambre chaleureux." })).freshness.status, "estimated");
  const sillage = by(product({ description: "Sillage discret, parfum de peau", tags: ["sillage"] }));
  assert.equal(sillage.intensity.status, "estimated");
  assert.ok(sillage.intensity.value! < 0.5, "sillage discret = faible intensité");
  assert.equal(by(product({ tags: ["sillage"] })).intensity.status, "insufficient_data", "« sillage » seul ne dit rien");
  assert.equal(by(product({ description: "Sans vanille, sans caramel, pas frais" })).sweetness.status, "insufficient_data");
  assert.equal(by(product({ description: "Sans vanille, sans caramel, pas frais" })).freshness.status, "insufficient_data");
  const lowWoody = by(product({ description: "Un floral peu boisé" })).woody;
  assert.equal(lowWoody.status, "estimated");
  assert.ok(lowWoody.value! < 0.5);
  // « Sucre d'Or » dans une description : un mot-clé réel mais seul « sucré » décrit le parfum — la marque n'est jamais lue.
  assert.equal(by(product({ name: "Parfum", tags: [] })).sweetness.status, "insufficient_data");
});

test("niveaux et confiance : tag explicite fort > description unique > indice faible", () => {
  assert.equal(by(product({ tags: ["boisé"] })).woody.confidence, "high");
  assert.equal(by(product({ description: "Un parfum boisé." })).woody.confidence, "medium");
  const weak = by(product({ description: "Un parfum doux." })).sweetness;
  assert.equal(weak.confidence, "low");
  assert.ok(weak.value! > 0.5 && weak.value! < 0.8);
  assert.equal(by(product({ tags: ["modéré"] })).intensity.value, 0.5);
  const two = by(product({ tags: ["intense", "puissant"] })).intensity;
  assert.equal(two.value, 0.85);
  assert.equal(by(product({ tags: ["discret", "léger"] })).intensity.value, 0.15);
});

test("valeurs existantes : jamais reproposées (valides, nulles non, invalides oui)", () => {
  const p = product({ tags: ["frais", "intense", "gourmand", "boisé"], attributes: { freshness: 0.3, intensity: "élevé", sweetness: 0 } });
  const out = by(p);
  for (const key of ["freshness", "intensity", "sweetness"]) {
    assert.equal(out[key].status, "insufficient_data", key);
    assert.equal(out[key].value, null);
    assert.match(out[key].rationale, /déjà renseignée/);
  }
  assert.equal(out.woody.status, "estimated");
  // Une clé à null est une absence : elle peut être proposée.
  assert.equal(by(product({ tags: ["frais"], attributes: { freshness: null } })).freshness.status, "estimated");
  // Le produit n'est jamais modifié.
  assert.deepEqual(p.attributes, { freshness: 0.3, intensity: "élevé", sweetness: 0 });
});

test("axes : reconnus par clé ou libellé ; hors modèle Parfum sans règle", () => {
  assert.equal(canonicalPerfumeAxis({ key: "fresh_axis", label: "Fraîcheur" }), "freshness");
  assert.equal(canonicalPerfumeAxis({ key: "bois", label: "x" }), "woody");
  assert.equal(canonicalPerfumeAxis({ key: "adventure", label: "Aventure" }), null);
  const custom = estimateAxes(product({ tags: ["frais", "aventure"] }), [{ key: "fresh_axis", label: "Fraîcheur" }, { key: "adventure", label: "Aventure" }]);
  assert.equal(custom[0].status, "estimated");
  assert.equal(custom[1].status, "insufficient_data");
  assert.match(custom[1].rationale, /Aucune règle automatique/);
});

test("produits du test E2E : jeu représentatif", () => {
  const nuit = by(product({ name: "Nuit de Velours", tags: ["oriental", "intense", "soirée", "sensuel", "sillage"], description: "Parfum intense et envoûtant : rose noire, oud et patchouli. Fort sillage, pour les soirées." }));
  assert.ok(nuit.intensity.value! >= 0.8 && nuit.intensity.confidence === "high");
  const aube = by(product({ name: "Aube Citronnée", tags: ["agrumes", "frais", "léger", "quotidien", "été"], description: "Eau de toilette vive et lumineuse : citron de Sicile, bergamote et thé blanc. Légère, idéale au quotidien." }));
  assert.ok(aube.freshness.value! >= 0.8);
  assert.ok(aube.intensity.value! <= 0.2);
  const musc = by(product({ name: "Musc Cachemire", tags: ["musqué", "doux", "cocooning", "discret", "quotidien"], description: "Musc enveloppant, cachemire et bois blonds. Doux, réconfortant, cocooning, sillage discret." }));
  assert.ok(musc.intensity.value! < 0.5);
  assert.equal(musc.woody.confidence, "low");
});
