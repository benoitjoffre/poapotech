import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import csvParser from "csv-parser";
import type { ColumnProfile, ImportColumnInsight, QuizAxis } from "@poapo/types";
import { profileColumns } from "../src/services/catalogProfile";
import { detectCsvSeparator } from "../src/services/csv";
import { describeImportColumns } from "../src/services/importColumns";
import {
  attributeKeyFromHeader, freeAttributeKey, MAX_ATTRIBUTE_COLUMNS, suggestMapping, validateMapping, type FieldMapping,
} from "../src/services/importMapping";
import { parseAttributeValue, parsePrice } from "../src/services/importValues";
import { applyMapping, toProductData } from "../src/routes/import";
import { coffeeCatalog, fashionCatalog, perfumeCatalog } from "./fixtures/catalogProfileFixtures";
import { snapshotAll } from "./fixtures/expressSnapshot";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const axis = (key: string, label: string): QuizAxis => ({ key, label, lowLabel: null, highLabel: null });

// ─── Prix ─────────────────────────────────────────────────────────────────────

test("prix non ambigus acceptés : entiers, décimales, symbole €, milliers", () => {
  const ok: [string, number][] = [
    ["49", 49], ["49.00", 49], ["49,00", 49], ["49,00 €", 49], ["49.00 €", 49], ["49€", 49], ["€ 49", 49], ["49 EUR", 49],
    ["12,5", 12.5], ["0,125", 0.125], ["1 234", 1234], ["1 234,56", 1234.56], ["1 234,56 €", 1234.56], ["1 234,56 €", 1234.56],
    ["1.234,56", 1234.56], ["1,234.56", 1234.56], ["1.234.567", 1234567], ["1,234,567", 1234567], ["1234.567", 1234.567], ["0", 0],
  ];
  for (const [raw, value] of ok) assert.deepEqual(parsePrice(raw), { ok: true, value }, raw);
});

test("prix refusés : négatif, ambigu, texte, formes incohérentes", () => {
  for (const raw of ["-5", "-5,00 €", "−5", "- 5"]) assert.deepEqual(parsePrice(raw), { ok: false, reason: "negative" }, raw);
  for (const raw of ["1.234", "1,234", "12,345", "999.999"]) assert.deepEqual(parsePrice(raw), { ok: false, reason: "ambiguous" }, raw);
  for (const raw of ["gratuit", "49g", "€49€", "49,", ",5", "1 23", "1,23,45", "1.2.3", "49 $", "4 9", "12 345 6", "1,234.5.6", ""]) {
    assert.deepEqual(parsePrice(raw), { ok: false, reason: "invalid" }, raw);
  }
});

test("prix dans le mapping : compatibilité des anciens CSV, message clair pour négatif et ambigu", () => {
  const mapping: FieldMapping[] = [{ sourceColumn: "n", targetField: "name" }, { sourceColumn: "p", targetField: "price" }];
  assert.equal(applyMapping({ n: "A", p: "12,5" }, mapping).price, 12.5);
  assert.equal(applyMapping({ n: "A", p: "12.5" }, mapping).price, 12.5);
  assert.equal(applyMapping({ n: "A", p: "49,00 €" }, mapping).price, 49);
  assert.equal(applyMapping({ n: "A", p: "" }, mapping).price, undefined, "prix vide : pas de prix");
  assert.throws(() => applyMapping({ n: "A", p: "-3" }, mapping), /négatif refusé/);
  assert.throws(() => applyMapping({ n: "A", p: "1.234" }, mapping), /ambigu/);
  assert.throws(() => applyMapping({ n: "A", p: "douze" }, mapping), /numérique invalide/);
});

test("valeurs d'attribut : comportement historique conservé, codes à zéros initiaux et très longs numéros jamais convertis", () => {
  assert.equal(parseAttributeValue("0,7"), 0.7);
  assert.equal(parseAttributeValue("12"), 12);
  assert.equal(parseAttributeValue("Floral"), "Floral");
  assert.equal(parseAttributeValue("007"), "007");
  assert.equal(parseAttributeValue("3760123456789012345"), "3760123456789012345");
  assert.equal(parseAttributeValue("0,33999999999999997"), 0.33999999999999997, "décimal exporté par un tableur : bien un nombre");
  assert.equal(parseAttributeValue("12.100000000000001"), 12.100000000000001);
  assert.equal(parseAttributeValue("EDP, 50 ml"), "EDP, 50 ml", "pas de découpage des textes à virgules");
  assert.equal(parseAttributeValue("Oui"), "Oui", "booléens laissés en texte : aucune conversion silencieuse");
});

// ─── Clés et suggestions ──────────────────────────────────────────────────────

test("clés normalisées : accents, espaces, ponctuation, chiffres initiaux, longueur", () => {
  assert.equal(attributeKeyFromHeader("Genre"), "genre");
  assert.equal(attributeKeyFromHeader("Famille olfactive"), "famille_olfactive");
  assert.equal(attributeKeyFromHeader("Torréfaction"), "torrefaction");
  assert.equal(attributeKeyFromHeader("  Matière (principale) "), "matiere_principale");
  assert.equal(attributeKeyFromHeader("3D / Taille"), "col_3d_taille");
  assert.equal(attributeKeyFromHeader("€€"), null);
  assert.ok(attributeKeyFromHeader("x".repeat(100))!.length <= 40);
});

test("collisions : clés déjà prises, réservées ou d'axe reçoivent un suffixe, jamais de doublon silencieux", () => {
  assert.deepEqual(freeAttributeKey("genre", new Set()), { key: "genre", renamed: false });
  assert.deepEqual(freeAttributeKey("genre", new Set(["genre"])), { key: "genre_2", renamed: true });
  assert.deepEqual(freeAttributeKey("genre", new Set(["genre", "genre_2"])), { key: "genre_3", renamed: true });
  assert.deepEqual(freeAttributeKey("price", new Set()), { key: "price_2", renamed: true });
  assert.equal(freeAttributeKey("constructor", new Set())?.key, "constructor_2");
});

const HEADERS = ["Nom", "Genre", "Famille olfactive", "Genre ", "Prix", "Lien", "Vide", "Intensité"];
const ROWS = [
  { Nom: "A", Genre: "Femme", "Famille olfactive": "Floral", "Genre ": "F", Prix: "49,00 €", Lien: "http://x", Vide: "", "Intensité": "0,6" },
  { Nom: "B", Genre: "Homme", "Famille olfactive": "Boisé", "Genre ": "H", Prix: "59", Lien: "http://y", Vide: " ", "Intensité": "0,2" },
  { Nom: "C", Genre: "Mixte", "Famille olfactive": "Frais", "Genre ": "M", Prix: "39", Lien: "http://z", Vide: "", "Intensité": "0,9" },
];

test("lecture des colonnes : standard, suggérée, non reconnue, vide ; collisions renommées ; aucun écrasement", () => {
  const axes = [axis("intensite", "Intensité")];
  const suggested = suggestMapping(HEADERS, axes);
  const columns = describeImportColumns(HEADERS, ROWS, suggested, new Set(["intensite"]));
  const by = (name: string) => columns.find((c) => c.sourceColumn === name)!;
  assert.equal(by("Nom").status, "standard");
  assert.equal(by("Prix").status, "standard");
  assert.equal(by("Intensité").status, "standard");
  assert.equal(by("Genre").status, "suggested");
  assert.equal(by("Genre").suggestion?.targetField, "attribute.genre");
  assert.equal(by("Genre ").suggestion?.targetField, "attribute.genre_2");
  assert.equal(by("Genre ").suggestion?.renamed, true);
  assert.equal(by("Famille olfactive").suggestion?.targetField, "attribute.famille_olfactive");
  assert.equal(by("Lien").status, "unrecognized", "ambigu : jamais deviné");
  assert.equal(by("Vide").status, "empty");
  // La suggestion standard n'est pas modifiée par la lecture des colonnes (rien n'est appliqué sans confirmation).
  assert.deepEqual(suggested.filter((m) => m.targetField).map((m) => m.sourceColumn).sort(), ["Intensité", "Nom", "Prix"]);
  const targets = columns.flatMap((c) => c.suggestion ? [c.suggestion.targetField] : []);
  assert.equal(new Set(targets).size, targets.length);
});

test("déterminisme : mêmes entrées, mêmes suggestions", () => {
  const run = () => JSON.stringify(describeImportColumns(HEADERS, ROWS, suggestMapping(HEADERS, []), new Set()));
  assert.equal(run(), run());
});

test("une colonne dont la clé serait celle d'un axe n'écrase jamais l'axe", () => {
  const headers = ["Nom", "Intensité", "Intensite !"];
  const rows = [{ Nom: "A", "Intensité": "0,5", "Intensite !": "fort" }, { Nom: "B", "Intensité": "0,7", "Intensite !": "doux" }, { Nom: "C", "Intensité": "0,1", "Intensite !": "fort" }];
  const suggested = suggestMapping(headers, [axis("intensite", "Intensité")]);
  const columns = describeImportColumns(headers, rows, suggested, new Set(["intensite"]));
  assert.equal(columns[1].status, "standard");
  assert.equal(columns[2].suggestion?.targetField, "attribute.intensite_2");
});

test("mapping manuel : plafond de colonnes supplémentaires, doublons de destination toujours bloqués", () => {
  const many: FieldMapping[] = [{ sourceColumn: "n", targetField: "name" },
    ...Array.from({ length: MAX_ATTRIBUTE_COLUMNS + 1 }, (_, i) => ({ sourceColumn: `c${i}`, targetField: `attribute.k${i}` }))];
  assert.ok(validateMapping(many, new Set()).issues.some((i) => i.severity === "error" && /Trop de colonnes/.test(i.message)));
  const dup = validateMapping([{ sourceColumn: "n", targetField: "name" }, { sourceColumn: "a", targetField: "attribute.genre" }, { sourceColumn: "b", targetField: "attribute.genre" }], new Set());
  assert.ok(dup.issues.some((i) => i.severity === "error" && /même destination/.test(i.message)));
});

test("colonnes mélangées, très peu renseignées, constantes : notes lisibles, jamais de code technique", () => {
  const headers = ["Nom", "Poids", "Pays", "Promo", "Réf"];
  const rows = Array.from({ length: 20 }, (_, i) => ({
    Nom: `P${i}`, Poids: i % 4 === 0 ? "250g" : String(100 + (i % 5) * 50), Pays: "France", Promo: i === 0 ? "oui" : "", "Réf": `REF-${1000 + i}`,
  }));
  const columns = describeImportColumns(headers, rows, suggestMapping(headers, []), new Set());
  const by = (name: string) => columns.find((c) => c.sourceColumn === name)!;
  assert.equal(by("Poids").detected, "mixed");
  assert.ok(by("Poids").notes.some((n) => /Mélange/.test(n)));
  assert.ok(by("Pays").notes.some((n) => /même valeur/.test(n)));
  assert.ok(by("Promo").notes.some((n) => /Peu renseignée/.test(n)));
  assert.equal(by("Promo").suggestion?.recommended, false);
  assert.equal(by("Réf").detected, "identifier");
  for (const column of columns) for (const note of column.notes) assert.ok(!/attribute|CATEGORICAL|RANGE|INVALID_VALUES/.test(note), note);
});

// ─── Imports complets : CSV → produits enregistrés → diagnostic 10B ──────────

const csvCell = (value: string) => (/[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
const toCsv = (headers: string[], rows: string[][]) => [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\n") + "\n";

function parseCsv(csv: string): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const buffer = Buffer.from(csv, "utf8");
  return new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];
    Readable.from([buffer]).pipe(csvParser({ separator: detectCsvSeparator(buffer) }))
      .on("data", (row: Record<string, string>) => rows.push(row))
      .on("end", () => resolve({ headers: rows.length ? Object.keys(rows[0]) : [], rows }))
      .on("error", reject);
  });
}

/** Rejoue le parcours : analyse → confirmation des suggestions recommandées → validation → données enregistrées → diagnostic. */
async function importCsv(csv: string, axes: QuizAxis[], confirm: "recommended" | "none" = "recommended") {
  const { headers, rows } = await parseCsv(csv);
  const suggested = suggestMapping(headers, axes);
  const columns = describeImportColumns(headers, rows, suggested, new Set(axes.map((a) => a.key)));
  const confirmed = confirm === "none" ? suggested : suggested.map((m) => {
    const insight = columns.find((c) => c.sourceColumn === m.sourceColumn)!;
    return !m.targetField && insight.suggestion?.recommended ? { ...m, targetField: insight.suggestion.targetField } : m;
  });
  const checked = validateMapping(confirmed, new Set(axes.map((a) => a.key)), headers);
  assert.ok(!checked.issues.some((i) => i.severity === "error"), JSON.stringify(checked.issues));
  const axisKeys = new Set(axes.map((a) => a.key));
  const stored = rows.map((row) => toProductData("tenant", "catalog", applyMapping(row, confirmed, axisKeys)));
  const profiles = profileColumns(stored, { axisKeys });
  return { columns, mapping: confirmed, stored, profiles, rows };
}

const profileOf = (profiles: ColumnProfile[], key: string) => {
  const profile = profiles.find((p) => p.key === key);
  assert.ok(profile, `${key} absent : ${profiles.map((p) => p.key).join(", ")}`);
  return profile;
};

function perfumeCsv() {
  const catalog = perfumeCatalog();
  const rows = catalog.products.map((p, i) => {
    const a = p.attributes as Record<string, unknown>;
    return [p.name, p.brand ?? "", `${p.price},00 €`, String(a.genre), String(a.famille), `${p.tags[0]}, ${p.tags[1]}`,
      i % 2 ? "Eau de parfum" : "Eau de toilette", ["Été", "Hiver", "Toute l'année"][i % 3], String(a.intensity).replace(".", ",")];
  });
  return toCsv(["Nom", "Marque", "Prix", "Genre", "Famille olfactive", "Notes", "Concentration", "Saison", "Intensité"], rows);
}

test("import Parfum (40) : genre, famille, saison, concentration conservés ; prix RANGE ; intensité NUMERIC (axe connu)", async () => {
  const { stored, profiles, columns } = await importCsv(perfumeCsv(), [axis("intensite", "Intensité")]);
  assert.equal(stored.length, 40);
  assert.equal(stored[0].price, 39, "« 39,00 € » lu comme 39");
  assert.deepEqual(columns.filter((c) => c.status === "suggested").map((c) => c.suggestion!.key).sort(), ["concentration", "famille_olfactive", "genre", "notes", "saison"]);
  const price = profileOf(profiles, "price");
  assert.equal(price.inferredType, "RANGE");
  assert.ok(price.usable);
  assert.equal(profileOf(profiles, "attribute.genre").inferredType, "CATEGORICAL");
  assert.equal(profileOf(profiles, "attribute.famille_olfactive").inferredType, "CATEGORICAL");
  assert.equal(profileOf(profiles, "attribute.famille_olfactive").distinctCount, 6);
  assert.equal(profileOf(profiles, "attribute.saison").inferredType, "CATEGORICAL");
  const intensity = profileOf(profiles, "attribute.intensite");
  assert.equal(intensity.inferredType, "NUMERIC");
  assert.equal(intensity.knownAxis, true);
  // Les notes à virgules ne sont ni découpées ni converties en tags.
  assert.ok(stored.every((p) => p.tags.length === 0));
  assert.ok(stored.every((p) => typeof (p.attributes as Record<string, unknown>).notes === "string" && String((p.attributes as Record<string, unknown>).notes).includes(", ")));
});

test("sans confirmation, aucune information supplémentaire n'est enregistrée", async () => {
  const { stored, mapping } = await importCsv(perfumeCsv(), [axis("intensite", "Intensité")], "none");
  assert.ok(mapping.filter((m) => !m.targetField).length >= 5);
  for (const product of stored) assert.deepEqual(Object.keys(product.attributes as object), ["intensite"]);
});

test("import Café (24) : origine, torréfaction, type CATEGORICAL ; prix RANGE ; acidité NUMERIC", async () => {
  const catalog = coffeeCatalog();
  const csv = toCsv(["Nom", "Prix", "Origine", "Torréfaction", "Type de mouture", "Acidité", "Bio"],
    catalog.products.map((p) => { const a = p.attributes as Record<string, unknown>; return [p.name, String(p.price).replace(".", ","), String(a.origine), String(a.torrefaction), String(a.type), String(a.acidity), a.bio ? "oui" : "non"]; }));
  const { profiles, stored } = await importCsv(csv, [axis("acidite", "Acidité")]);
  assert.equal(profileOf(profiles, "price").inferredType, "RANGE");
  assert.equal(profileOf(profiles, "attribute.origine").inferredType, "CATEGORICAL");
  assert.equal(profileOf(profiles, "attribute.torrefaction").inferredType, "CATEGORICAL");
  assert.equal(profileOf(profiles, "attribute.type_de_mouture").inferredType, "CATEGORICAL");
  assert.equal(profileOf(profiles, "attribute.acidite").inferredType, "NUMERIC");
  const bio = profileOf(profiles, "attribute.bio");
  assert.equal(bio.valueKind, "boolean");
  assert.equal(bio.inferredType, "CATEGORICAL");
  assert.ok(stored.every((p) => ["oui", "non"].includes((p.attributes as Record<string, unknown>).bio as string)), "« oui / non » enregistré tel quel : aucune conversion silencieuse");
});

test("import Mode (30) : couleur, matière, taille CATEGORICAL ; prix avec milliers et €", async () => {
  const catalog = fashionCatalog();
  const csv = toCsv(["Nom", "Prix", "Couleur", "Matière", "Taille", "Catégorie"],
    catalog.products.map((p, i) => { const a = p.attributes as Record<string, unknown>; return [p.name, i === 3 ? "1 249,00 €" : `${p.price},90 €`, String(a.couleur), String(a.matiere), String(a.taille), String(a.categorie)]; }));
  const { profiles, stored } = await importCsv(csv, []);
  assert.equal(stored[3].price, 1249);
  assert.equal(profileOf(profiles, "price").inferredType, "RANGE");
  for (const key of ["couleur", "matiere", "taille", "categorie"]) assert.equal(profileOf(profiles, `attribute.${key}`).inferredType, "CATEGORICAL", key);
});

test("anciens CSV : champs standards, axes et attributs choisis à la main donnent les mêmes données qu'avant", () => {
  const mapping: FieldMapping[] = [
    { sourceColumn: "Nom", targetField: "name" }, { sourceColumn: "Prix", targetField: "price" }, { sourceColumn: "Tags", targetField: "tags" },
    { sourceColumn: "Acidité", targetField: "attribute.acidite" }, { sourceColumn: "Origine", targetField: "attribute.origine" },
  ];
  const row = { Nom: "Café", Prix: "12,5", Tags: "fruité; doux", "Acidité": "0,7", Origine: "Éthiopie" };
  assert.deepEqual(applyMapping(row, mapping, new Set(["acidite"])), { name: "Café", price: 12.5, tags: ["fruité", "doux"], attributes: { acidite: 0.7, origine: "Éthiopie" } });
  const data = toProductData("t", "c", applyMapping(row, mapping, new Set(["acidite"])));
  assert.deepEqual(Object.keys(data).sort(), ["active", "attributes", "brand", "catalogId", "description", "featured", "imageUrl", "name", "price", "purchaseUrl", "tags", "tenantId"]);
});

test("l'import ne modifie ni la génération Express ni les quiz : instantané du lot 10B identique", () => {
  const baseline = JSON.parse(readFileSync(join(__dirname, "fixtures", "express-baseline.json"), "utf8"));
  assert.deepEqual(snapshotAll(), baseline);
});

test("pas de type technique dans les messages destinés au commerçant", async () => {
  const { columns } = await importCsv(perfumeCsv(), [axis("intensite", "Intensité")]);
  const text = JSON.stringify(columns.map((c: ImportColumnInsight) => c.notes));
  assert.ok(!/CATEGORICAL|NUMERIC|RANGE|INVALID_VALUES|attribute\./.test(text));
});

// ─── Correctifs de fiabilisation (lot 10D) ───────────────────────────────────

import { parseCSVBuffer } from "../src/routes/import";
import { duplicateHeaders, FORBIDDEN_ATTRIBUTE_KEYS } from "../src/services/importMapping";

test("clés dangereuses (__proto__, constructor, prototype) refusées en destination, en JSON et en suggestion", () => {
  for (const key of FORBIDDEN_ATTRIBUTE_KEYS) {
    const checked = validateMapping([{ sourceColumn: "n", targetField: "name" }, { sourceColumn: "x", targetField: `attribute.${key}` }], new Set());
    assert.ok(checked.issues.some((i) => i.severity === "error" && /interdit/.test(i.message)), key);
  }
  const mapping: FieldMapping[] = [{ sourceColumn: "n", targetField: "name" }, { sourceColumn: "j", targetField: "attributes" }];
  assert.throws(() => applyMapping({ n: "A", j: '{"__proto__":{"x":1}}' }, mapping), /interdit/);
  assert.throws(() => applyMapping({ n: "A", j: '{"constructor":"x"}' }, mapping), /interdit/);
  assert.throws(() => applyMapping({ n: "A", x: "v" }, [{ sourceColumn: "n", targetField: "name" }, { sourceColumn: "x", targetField: "attribute.prototype" }]), /invalide/);
  assert.deepEqual(applyMapping({ n: "A", j: '{"genre":"F"}' }, mapping), { name: "A", attributes: { genre: "F" } }, "un JSON légitime passe toujours");
  const columns = describeImportColumns(["Nom", "Constructor"], [{ Nom: "A", Constructor: "x" }, { Nom: "B", Constructor: "y" }, { Nom: "C", Constructor: "x" }], suggestMapping(["Nom", "Constructor"], []), new Set());
  assert.equal(columns[1].suggestion?.targetField, "attribute.constructor_2");
});

test("en-têtes CSV identiques : détectés et refusés, aucune colonne écrasée en silence", async () => {
  assert.deepEqual(duplicateHeaders(["Nom", "Prix", "Nom", "Genre", "Prix"]), ["Nom", "Prix"]);
  assert.deepEqual(duplicateHeaders(["Nom", "nom", "Nom "]), [], "des en-têtes seulement proches ne sont pas des doublons exacts");
  await assert.rejects(parseCSVBuffer(Buffer.from("Nom;Genre;Genre\nA;F;H\n", "utf8")), /Colonnes en double.*« Genre »/);
  const ok = await parseCSVBuffer(Buffer.from("Nom;Genre\nA;F\n", "utf8"));
  assert.deepEqual(ok.headers, ["Nom", "Genre"]);
});
