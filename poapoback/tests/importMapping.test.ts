import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeHeader, suggestMapping, validateMapping } from "../src/services/importMapping";
import { applyMapping } from "../src/routes/import";

const axis = (key: string, label: string) => ({ key, label, lowLabel: null, highLabel: null });
const target = (m: ReturnType<typeof suggestMapping>, col: string) => m.find((x) => x.sourceColumn === col)?.targetField;

test("normalisation : accents, casse, espaces, tirets et underscores", () => {
  assert.equal(normalizeHeader(" Prix_TTC "), "prixttc");
  assert.equal(normalizeHeader("Intensité-Aromatique"), "intensitearomatique");
});

test("suggestions café : champs produit et axes reconnus, colonnes inconnues laissées vides", () => {
  const axes = [axis("acidite", "Acidité"), axis("intensite", "Intensité")];
  const m = suggestMapping(["Nom du produit", "Marque", "PRIX", "Acidité", "intensite", "Origine", "Lien"], axes);
  assert.equal(target(m, "Nom du produit"), "name");
  assert.equal(target(m, "Marque"), "brand");
  assert.equal(target(m, "PRIX"), "price");
  assert.equal(target(m, "Acidité"), "attribute.acidite");
  assert.equal(target(m, "intensite"), "attribute.intensite");
  assert.equal(target(m, "Origine"), null);
  assert.equal(target(m, "Lien"), null); // ambigu : image ou achat ?
});

test("suggestions parfum et voyage : axes propres au secteur, aucun axe inventé", () => {
  const perfume = suggestMapping(["name", "Note_Florale", "axe-boise", "Tarif"], [axis("florale", "Note florale"), axis("boise", "Boisé")]);
  assert.deepEqual(perfume.map((x) => x.targetField), ["name", "attribute.florale", "attribute.boise", "price"]);
  const noAxes = suggestMapping(["Produit", "Note florale"], []);
  assert.deepEqual(noAxes.map((x) => x.targetField), ["name", null]);
});

test("suggestions : une destination n'est proposée qu'une fois", () => {
  const m = suggestMapping(["Nom", "Product"], []);
  assert.deepEqual(m.map((x) => x.targetField), ["name", null]);
});

test("mapping : doublons, nom absent, destination invalide bloquants ; colonne ignorée en avertissement", () => {
  const codes = (mapping: unknown, axes: string[] = []) =>
    validateMapping(mapping, new Set(axes)).issues.map((i) => `${i.severity}:${i.message.split(" ")[0]}`);
  const dup = validateMapping([
    { sourceColumn: "a", targetField: "name" }, { sourceColumn: "b", targetField: "name" },
  ], new Set()).issues;
  assert.ok(dup.some((i) => i.severity === "error" && /même destination/.test(i.message)));
  assert.ok(validateMapping([{ sourceColumn: "a", targetField: "price" }], new Set()).issues.some((i) => /nom du produit/.test(i.message)));
  assert.ok(validateMapping([{ sourceColumn: "a", targetField: "name" }, { sourceColumn: "b", targetField: "bogus" }], new Set())
    .issues.some((i) => i.severity === "error" && /invalide/.test(i.message)));
  const ignored = validateMapping([{ sourceColumn: "a", targetField: "name" }, { sourceColumn: "z", targetField: null }], new Set(["x"])).issues;
  assert.deepEqual(ignored.map((i) => i.severity), ["warning", "warning"]);
  assert.ok(codes("nope").includes("error:Correspondance"));
});

test("valeurs : prix, oui/non et axes invalides refusés, jamais convertis en silence", () => {
  const mapping = [
    { sourceColumn: "n", targetField: "name" }, { sourceColumn: "p", targetField: "price" },
    { sourceColumn: "a", targetField: "active" }, { sourceColumn: "x", targetField: "attribute.acidite" },
  ];
  const axes = new Set(["acidite"]);
  assert.deepEqual(applyMapping({ n: "Café", p: "12,5", a: "oui", x: "0,7" }, mapping, axes),
    { name: "Café", price: 12.5, active: true, attributes: { acidite: 0.7 } });
  assert.throws(() => applyMapping({ n: "Café", p: "douze" }, mapping, axes), /numérique invalide/);
  assert.throws(() => applyMapping({ n: "Café", a: "peut-être" }, mapping, axes), /oui\/non/);
  assert.throws(() => applyMapping({ n: "Café", x: "7" }, mapping, axes), /entre 0 et 1/);
  assert.throws(() => applyMapping({ n: "Café", x: "fort" }, mapping, axes), /entre 0 et 1/);
});
