import type { QuizAxis } from "@poapo/types";

export type FieldMapping = { sourceColumn: string; targetField: string | null; auto?: boolean };
export type ImportIssue = { severity: "error" | "warning"; message: string };

export const PRODUCT_FIELDS = [
  "name", "brand", "description", "price", "imageUrl", "purchaseUrl", "tags", "active", "featured", "attributes",
] as const;
const PRODUCT_FIELD_SET: ReadonlySet<string> = new Set(PRODUCT_FIELDS);
export const ATTRIBUTE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

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
    const valid = PRODUCT_FIELD_SET.has(targetField) ||
      (targetField.startsWith("attribute.") && ATTRIBUTE_KEY_PATTERN.test(targetField.slice("attribute.".length)));
    if (!valid) { error(`Destination invalide pour « ${sourceColumn} » : ${targetField}`); continue; }
    const previous = seen.get(targetField);
    if (previous) error(`« ${previous} » et « ${sourceColumn} » ont la même destination (${targetField}).`);
    else seen.set(targetField, sourceColumn);
  }
  if (!seen.has("name")) error("Aucune colonne n'est associée au nom du produit (obligatoire).");
  for (const key of axisKeys) {
    if (!seen.has(`attribute.${key}`)) {
      issues.push({ severity: "warning", message: `Axe « ${key} » non associé : ces produits seront moins bien classés pour les quiz qui l'utilisent.` });
    }
  }
  return { mapping: list, issues };
}
