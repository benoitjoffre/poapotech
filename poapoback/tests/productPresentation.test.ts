import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuizAxis } from "@poapo/types";
import {
  characteristics, criteriaFromEffects, formalExplanation, humanizeKey, MAX_CHARACTERISTICS, presentProduct, publicAttributes, splitHeader, visitorLabel,
  type PresentationContext,
} from "../src/services/productPresentation";

const axis = (key: string, label: string): QuizAxis => ({ key, label, lowLabel: null, highLabel: null });
const effects = (...criteria: string[]) => ({ v: 1, effects: criteria.map((criterion) => ({ type: "category", criterion, mode: "soft", values: ["x"] })) });
const ctx = (over: Partial<PresentationContext>): PresentationContext => ({ axes: [], criteria: [], labels: {}, ...over });

const PARFUM = {
  famille_olfactive: "Floral", genre: "Femme", intensite: 0.7, fraicheur: 0.4, contenance: 50, vegan: true,
  sku: 3760012345678, reference: "REF-1029", ean: "3760012345678", import_batch: "b-42", meta: { source: "csv" }, notes: ["iris", "musc"],
};

test("Parfum, nouveau catalogue : en-têtes d'origine (accents, unités), axes en barres, rien d'interne", () => {
  const context = ctx({
    axes: [axis("intensite", "Intensité"), axis("fraicheur", "Fraîcheur")],
    criteria: criteriaFromEffects([effects("attribute.famille_olfactive"), effects("attribute.genre", "price"), effects("attribute.contenance")]),
    labels: { famille_olfactive: "Famille olfactive", genre: "Genre", contenance: "Contenance (ml)", reference: "Référence" },
  });
  assert.deepEqual(characteristics(PARFUM, context), [
    { key: "famille_olfactive", label: "Famille olfactive", value: "Floral" },
    { key: "genre", label: "Genre", value: "Femme" },
    { key: "contenance", label: "Contenance", value: "50 ml" },
  ]);
  const publicOnes = publicAttributes(PARFUM, context);
  assert.deepEqual(Object.keys(publicOnes).sort(), ["contenance", "famille_olfactive", "fraicheur", "genre", "intensite"]);
  for (const internal of ["sku", "reference", "ean", "import_batch", "meta", "notes", "vegan"]) assert.ok(!(internal in publicOnes), `${internal} jamais transmis`);
});

test("Parfum, ancien catalogue sans en-têtes : libellés lisibles dérivés de la clé, sans accent inventé", () => {
  const context = ctx({ criteria: ["famille_olfactive", "genre"] });
  assert.deepEqual(characteristics(PARFUM, context).map((c) => c.label), ["Famille olfactive", "Genre"]);
  assert.equal(humanizeKey("tailleEu"), "Taille eu");
  assert.equal(humanizeKey("poids_g"), "Poids g");
});

test("Café : caractéristiques numériques avec unité, booléens lisibles", () => {
  const coffee = { origine: "Éthiopie", torrefaction: "Moyenne", poids_g: 250, bio: "oui", acidity: 0.8, lot: "L-2026-11" };
  const context = ctx({ axes: [axis("acidity", "Acidité")], criteria: ["torrefaction", "origine", "poids_g", "bio"], labels: { torrefaction: "Torréfaction", origine: "Pays d'origine", poids_g: "Poids (g)", bio: "Bio" } });
  assert.deepEqual(characteristics(coffee, context).map((c) => `${c.label} : ${c.value}`), ["Torréfaction : Moyenne", "Pays d'origine : Éthiopie", "Poids : 250 g", "Bio : Oui"]);
  assert.ok(!("lot" in publicAttributes(coffee, context)));
});

test("Mode : au plus quatre caractéristiques, dans l'ordre des questions ; valeurs trop longues ou structurées ignorées", () => {
  const item = { categorie: "Robe", couleur: "Bleu marine", matiere: "Lin", taille: "M", coupe: "Droite", composition: "x".repeat(80), tailles: ["S", "M"] };
  const context = ctx({ criteria: ["couleur", "categorie", "composition", "tailles", "matiere", "taille", "coupe"], labels: { categorie: "Catégorie", matiere: "Matière" } });
  const shown = characteristics(item, context);
  assert.equal(shown.length, MAX_CHARACTERISTICS);
  assert.deepEqual(shown.map((c) => c.label), ["Couleur", "Catégorie", "Matière", "Taille"]);
});

test("référence commerciale réellement utile : affichée seulement si le quiz s'en sert (sélection explicite, pas de liste noire)", () => {
  const product = { reference_modele: "Classic 501", sku: "SKU-1" };
  assert.deepEqual(characteristics(product, ctx({ criteria: [] })), []);
  const asked = ctx({ criteria: ["reference_modele"], labels: { reference_modele: "Modèle" } });
  assert.deepEqual(characteristics(product, asked), [{ key: "reference_modele", label: "Modèle", value: "Classic 501" }]);
  assert.ok(!("sku" in publicAttributes(product, asked)));
});

test("attributs manquants ou produit sans caractéristique présentable : aucune rubrique, aucune erreur", () => {
  const context = ctx({ axes: [axis("intensite", "Intensité")], criteria: ["famille_olfactive", "genre"] });
  assert.deepEqual(characteristics({ sku: 12 }, context), []);
  assert.deepEqual(characteristics(null, context), []);
  assert.deepEqual(characteristics("texte", context), []);
  assert.deepEqual(publicAttributes(undefined, context), {});
});

test("priorité des libellés : axe défini par le commerçant, puis en-tête CSV, puis clé", () => {
  const context = ctx({ axes: [axis("intensite", "Sillage")], labels: { intensite: "Intensité (0-1)", genre: "Genre" } });
  assert.deepEqual(visitorLabel("intensite", context), { label: "Sillage", unit: null });
  assert.deepEqual(visitorLabel("genre", context), { label: "Genre", unit: null });
  assert.deepEqual(visitorLabel("couleur_principale", context), { label: "Couleur principale", unit: null });
  assert.deepEqual(splitHeader("Durée (jours)"), { label: "Durée", unit: "jours" });
  assert.deepEqual(splitHeader("Taille"), { label: "Taille", unit: null });
});

test("critères : seuls les effets de préférence ou de contrainte sur un attribut comptent", () => {
  assert.deepEqual(criteriaFromEffects([
    { v: 1, effects: [{ type: "category", criterion: "attribute.genre", mode: "soft", values: ["F"] }, { type: "none", criterion: "attribute.couleur" }] },
    { v: 1, effects: [{ type: "range", criterion: "price", mode: "strict", max: 50 }, { type: "range", criterion: "attribute.poids", mode: "soft", max: 2 }] },
    null, "corrompu", { v: 1, effects: [{ type: "axis", axis: "x" }] },
  ]), ["genre", "poids"]);
});

test("vouvoiement : explications du moteur reformulées sans changer leur contenu", () => {
  assert.deepEqual(formalExplanation(["Correspond à ta préférence : Corsé", "Le produit le plus proche de tes réponses dans notre sélection"]),
    ["Correspond à votre préférence : Corsé", "Le produit le plus proche de vos réponses dans notre sélection"]);
});

test("presentProduct : produit public complet sans données internes", () => {
  const presented = presentProduct({ id: "p", name: "Parfum", attributes: PARFUM }, ["Correspond à ta préférence : Frais"], ctx({ criteria: ["genre"] }));
  assert.deepEqual(presented.product.attributes, { genre: "Femme" });
  assert.deepEqual(presented.characteristics, [{ key: "genre", label: "Genre", value: "Femme" }]);
  assert.deepEqual(presented.explanation, ["Correspond à votre préférence : Frais"]);
  assert.ok(!JSON.stringify(presented).includes("REF-1029"));
});
