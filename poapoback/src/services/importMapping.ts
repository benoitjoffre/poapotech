import type { QuizAxis } from "@poapo/types";

export type FieldMapping = { sourceColumn: string; targetField: string | null; auto?: boolean };
export type ImportIssue = { severity: "error" | "warning"; message: string };

export const PRODUCT_FIELDS = [
  "name", "brand", "description", "price", "imageUrl", "purchaseUrl", "tags", "active", "featured", "attributes",
] as const;
const PRODUCT_FIELD_SET: ReadonlySet<string> = new Set(PRODUCT_FIELDS);
export const ATTRIBUTE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
/** Nombre maximal de colonnes enregistrées comme informations supplémentaires par produit (aligné sur l'enrichissement). */
export const MAX_ATTRIBUTE_COLUMNS = 30;
/** Clés qu'une information supplémentaire ne peut pas porter : champs produit, identifiants techniques et noms d'objet JS. */
export const RESERVED_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  ...PRODUCT_FIELDS.map((field) => field.toLowerCase()),
  "id", "tenantid", "catalogid", "embedding", "createdat", "updatedat", "constructor", "prototype", "proto",
]);
/** En-têtes volontairement jamais devinés (image ou achat ? voir SYNONYMS) : le commerçant choisit. */
const AMBIGUOUS_HEADERS: ReadonlySet<string> = new Set(["url", "urls", "lien", "liens", "link", "links"]);

/** Clés refusées partout (destination d'attribut, JSON `attributes`) : elles touchent le prototype des objets JavaScript. */
export const FORBIDDEN_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/** En-têtes strictement identiques : le parseur CSV n'en garderait que le dernier, en silence. */
export function duplicateHeaders(headers: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const header of headers) (seen.has(header) ? duplicated : seen).add(header);
  return [...duplicated];
}

export function isAmbiguousHeader(header: string): boolean {
  return AMBIGUOUS_HEADERS.has(normalizeHeader(header));
}

/** « Famille olfactive » → « famille_olfactive » ; null si l'en-tête ne contient aucun caractère exploitable. */
export function attributeKeyFromHeader(header: string): string | null {
  const words = header.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return null;
  let key = words.join("_");
  if (!/^[a-z]/.test(key)) key = `col_${key}`;
  return key.slice(0, 40).replace(/_+$/, "") || null;
}

/** Première clé libre : `base`, puis `base_2`, `base_3`… Déterministe ; `taken` n'est pas modifié. */
export function freeAttributeKey(base: string, taken: ReadonlySet<string>): { key: string; renamed: boolean } | null {
  if (!taken.has(base) && !RESERVED_ATTRIBUTE_KEYS.has(base)) return { key: base, renamed: false };
  for (let n = 2; n <= 99; n++) {
    const suffix = `_${n}`;
    const key = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    if (!taken.has(key) && !RESERVED_ATTRIBUTE_KEYS.has(key)) return { key, renamed: true };
  }
  return null;
}

/** Minuscules, sans accents, sans espaces/tirets/underscores/ponctuation : « Prix_TTC » → « prixttc ». */
export function normalizeHeader(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Synonymes non ambigus uniquement : « url » ou « lien » seuls sont absents (image ou achat ?).
const SYNONYMS: Record<string, readonly string[]> = {
  name: ["nom", "name", "nomproduit", "nomduproduit", "produit", "product", "productname", "designation"],
  brand: ["marque", "brand", "fabricant"],
  description: ["description", "desc", "descriptif"],
  price: ["prix", "price", "tarif", "prixttc"],
  imageUrl: ["image", "imageurl", "urlimage", "lienimage", "photo", "img", "picture"],
  purchaseUrl: ["purchaseurl", "urlachat", "lienachat", "achat", "urlproduit", "lienproduit", "buyurl"],
  tags: ["tags", "tag", "motscles", "etiquettes", "keywords"],
  active: ["actif", "active", "disponible"],
  featured: ["miseenavant", "featured", "vedette"],
  attributes: ["attributes"],
};

/** Correspondances évidentes, déterministes et locales. Une colonne ambiguë ou déjà prise reste non associée. */
export function suggestMapping(headers: string[], axes: readonly QuizAxis[]): FieldMapping[] {
  const candidates = new Map<string, Set<string>>();
  const add = (norm: string, target: string) => {
    if (!norm) return;
    const set = candidates.get(norm) ?? new Set<string>();
    set.add(target);
    candidates.set(norm, set);
  };
  for (const [field, words] of Object.entries(SYNONYMS)) words.forEach((word) => add(word, field));
  for (const axis of axes) {
    const target = `attribute.${axis.key}`;
    for (const base of [axis.key, axis.label]) {
      const norm = normalizeHeader(base);
      add(norm, target);
      add(`axe${norm}`, target);
      add(`axis${norm}`, target);
    }
  }
  const used = new Set<string>();
  return headers.map((sourceColumn) => {
    const found = candidates.get(normalizeHeader(sourceColumn));
    const target = found && found.size === 1 ? [...found][0] : null;
    if (!target || used.has(target)) return { sourceColumn, targetField: null };
    used.add(target);
    return { sourceColumn, targetField: target, auto: true };
  });
}

/** Contrôles du mapping lui-même (indépendants des lignes). */
export function validateMapping(
  mapping: unknown,
  axisKeys: ReadonlySet<string>,
  headers?: readonly string[],
): { mapping: FieldMapping[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const error = (message: string) => issues.push({ severity: "error", message });
  if (!Array.isArray(mapping) || mapping.some((m) => !m || typeof m.sourceColumn !== "string" || (m.targetField !== null && typeof m.targetField !== "string"))) {
    error("Correspondance des colonnes invalide");
    return { mapping: [], issues };
  }
  const list = mapping as FieldMapping[];
  const seen = new Map<string, string>();
  for (const { sourceColumn, targetField } of list) {
    if (headers && !headers.includes(sourceColumn)) error(`Colonne inconnue du fichier : « ${sourceColumn} »`);
    if (!targetField) {
      issues.push({ severity: "warning", message: `Colonne « ${sourceColumn} » ignorée : ses valeurs ne seront pas importées.` });
      continue;
    }
    if (targetField.startsWith("attribute.") && FORBIDDEN_ATTRIBUTE_KEYS.has(targetField.slice("attribute.".length))) {
      error(`Nom d'information interdit pour « ${sourceColumn} » : ${targetField.slice("attribute.".length)}`);
      continue;
    }
    const valid = PRODUCT_FIELD_SET.has(targetField) ||
      (targetField.startsWith("attribute.") && ATTRIBUTE_KEY_PATTERN.test(targetField.slice("attribute.".length)));
    if (!valid) { error(`Destination invalide pour « ${sourceColumn} » : ${targetField}`); continue; }
    const previous = seen.get(targetField);
    if (previous) error(`« ${previous} » et « ${sourceColumn} » ont la même destination (${targetField}).`);
    else seen.set(targetField, sourceColumn);
  }
  const attributeColumns = [...seen.keys()].filter((target) => target.startsWith("attribute.")).length;
  if (attributeColumns > MAX_ATTRIBUTE_COLUMNS) {
    error(`Trop de colonnes conservées comme informations supplémentaires (${attributeColumns}) : ${MAX_ATTRIBUTE_COLUMNS} au maximum.`);
  }
  if (!seen.has("name")) error("Aucune colonne n'est associée au nom du produit (obligatoire).");
  for (const key of axisKeys) {
    if (!seen.has(`attribute.${key}`)) {
      issues.push({ severity: "warning", message: `Axe « ${key} » non associé : ces produits seront moins bien classés pour les quiz qui l'utilisent.` });
    }
  }
  return { mapping: list, issues };
}
