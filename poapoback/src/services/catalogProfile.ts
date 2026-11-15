import type {
  ColumnCategoryValue,
  ColumnDistribution,
  ColumnProfile,
  ColumnRejectionCode,
  ColumnSource,
  ColumnType,
  ColumnValueKind,
  ColumnWarningCode,
} from "@poapo/types";

/**
 * Diagnostic universel d'un catalogue (lot 10B). Fonction pure : aucune écriture, aucun appel réseau, aucune dépendance
 * au secteur, aucune mutation des produits. Elle DÉCRIT les colonnes ; elle ne décide pas quelles questions poser.
 */

/** Seuils centralisés. Chacun est testé dans tests/catalogProfile.test.ts. */
export const COLUMN_PROFILE_THRESHOLDS = {
  /** Couverture minimale (produits renseignés / produits). En dessous : INSUFFICIENT_COVERAGE. Une couverture partielle au-dessus reste exploitable. */
  minCoverage: 0.3,
  /** Nombre minimal de valeurs renseignées, quel que soit le catalogue. */
  minPresentCount: 3,
  /** Au-dessus de cette couverture, aucun avertissement PARTIAL_COVERAGE. */
  fullCoverage: 0.9,
  /** Part minimale de valeurs conformes au type dominant. En dessous : INVALID_VALUES. */
  minParseRate: 0.9,
  /** Nombre maximal de valeurs distinctes d'une catégorie (au-delà : identifiant, nom ou texte libre). */
  maxCategories: 12,
  /** Vocabulaire maximal d'une liste (tags). */
  maxListVocabulary: 30,
  /** Part de valeurs distinctes au-delà de laquelle une colonne de texte est quasi unique par produit (à partir de 10 valeurs). */
  maxDistinctRatio: 0.7,
  minValuesForRatio: 10,
  /** Longueur médiane (caractères) au-delà de laquelle un texte est du texte libre, pas une catégorie. */
  freeTextLength: 40,
  /** Part de la valeur dominante : à partir de là, la colonne ne sépare pratiquement rien (INSUFFICIENT_VARIATION). */
  maxDominantShare: 0.95,
  /** Part de la valeur dominante qui déclenche seulement un avertissement. */
  imbalancedShare: 0.8,
  /** Écart p90−p10 minimal d'un critère 0–1 (robuste aux valeurs extrêmes). */
  minUnitSpread: 0.1,
  /** Écart relatif (p90−p10)/max(|p10|,|p90|) minimal d'une mesure à échelle réelle. */
  minRelativeSpread: 0.05,
  /** Entiers uniques d'au moins ce niveau (codes-barres, EAN) : traités comme identifiants. */
  identifierMinValue: 10_000_000,
  /** Couverture à partir de laquelle un critère peut être un candidat contrainte. */
  constraintCoverage: 0.9,
  /** Valeurs les plus fréquentes conservées dans la distribution. */
  topValues: 10,
  /** Seuil d'arrondi des statistiques exposées. */
  decimals: 4,
} as const;

const IDENTIFIER_NAMES = /^(id|sku|ean|upc|gtin|isbn|ref|reference|refinterne|barcode|codebarre|codebarres|identifiant|uuid)$/;
const BOOLEAN_WORDS = new Set(["true", "false", "oui", "non", "yes", "no"]);
const NUMERIC_TEXT = /^-?\d+([.,]\d+)?$/;

/** Minuscules, sans accents, espaces réduits : sert aux statistiques uniquement, jamais aux données. */
export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

const foldName = (value: string) => normalizeText(value).replace(/[^a-z0-9]/g, "");
const round = (value: number) => Number(value.toFixed(COLUMN_PROFILE_THRESHOLDS.decimals));

// ─── Valeurs ──────────────────────────────────────────────────────────────────

type Kind = "number" | "boolean" | "text" | "list" | "other";
export interface Cell { kind: Kind; number?: number; tokens?: string[]; raw?: string[] }

export function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);
}

/** Lecture d'une valeur de colonne (nombre, booléen, texte, liste). Exportée pour les calculs de partition du sélecteur de critères. */
export function classifyCell(value: unknown): Cell {
  if (typeof value === "number") return Number.isFinite(value) ? { kind: "number", number: value } : { kind: "other" };
  if (typeof value === "boolean") return { kind: "boolean", tokens: [value ? "true" : "false"], raw: [value ? "true" : "false"] };
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (NUMERIC_TEXT.test(trimmed)) return { kind: "number", number: Number(trimmed.replace(",", ".")) };
    const folded = normalizeText(trimmed);
    if (BOOLEAN_WORDS.has(folded)) return { kind: "boolean", tokens: [["true", "oui", "yes"].includes(folded) ? "true" : "false"], raw: [trimmed] };
    return { kind: "text", tokens: [folded], raw: [trimmed.replace(/\s+/g, " ")] };
  }
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    if (items.length !== value.length) return { kind: "other" };
    return { kind: "list", tokens: [...new Set(items.map(normalizeText))], raw: items.map((item) => item.trim().replace(/\s+/g, " ")) };
  }
  return { kind: "other" };
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Paires de produits séparées par une partition, rapportées au nombre total de paires du catalogue. */
function separatedPairs(groupSizes: number[], totalProducts: number): number {
  const present = groupSizes.reduce((sum, size) => sum + size, 0);
  const pairs = (totalProducts * (totalProducts - 1)) / 2;
  if (pairs === 0) return 0;
  const sameGroup = groupSizes.reduce((sum, size) => sum + size * size, 0);
  return (present * present - sameGroup) / 2 / pairs;
}

// ─── Analyse d'une colonne ────────────────────────────────────────────────────

interface RawColumn {
  key: string;
  source: ColumnSource;
  name: string;
  /** Une entrée par produit ; undefined/null/vide = absent. */
  values: unknown[];
  knownAxis: boolean;
}

function dominantKind(counts: Record<Kind, number>): Kind {
  return (["number", "boolean", "text", "list", "other"] as const).reduce((best, kind) => (counts[kind] > counts[best] ? kind : best), "number");
}

function analyseColumn(column: RawColumn): ColumnProfile {
  const T = COLUMN_PROFILE_THRESHOLDS;
  const total = column.values.length;
  const cells = column.values.filter((value) => !isBlank(value)).map(classifyCell);
  const present = cells.length;
  const counts: Record<Kind, number> = { number: 0, boolean: 0, text: 0, list: 0, other: 0 };
  for (const cell of cells) counts[cell.kind]++;
  const dominant = present ? dominantKind(counts) : null;
  const kinds = (Object.keys(counts) as Kind[]).filter((kind) => counts[kind] > 0);

  // Les nombres invalides pour la source (prix négatif) ne comptent pas comme conformes.
  const conforming = cells.filter((cell) => {
    if (cell.kind !== dominant) return false;
    if (column.source === "price" && cell.kind === "number") return cell.number! >= 0;
    return true;
  });
  const parseRate = present ? conforming.length / present : 0;
  const valueKind: ColumnValueKind = !present ? "none" : kinds.length > 1 ? "mixed" : dominant!;

  const warnings: { code: ColumnWarningCode; message: string }[] = [];
  let inferredType: ColumnType = "UNKNOWN";
  let distribution: ColumnDistribution = { kind: "none" };
  let distinctCount = 0;
  let normalizedEntropy: number | null = null;
  let dominantShare: number | null = null;
  let discriminance = 0;
  let rejection: { code: ColumnRejectionCode; message: string } | null = null;
  const reject = (code: ColumnRejectionCode, message: string) => { rejection ??= { code, message }; };

  const coverage = total ? present / total : 0;

  if (dominant === "number") {
    const values = conforming.map((cell) => cell.number!).sort((a, b) => a - b);
    const distinct = new Set(values);
    distinctCount = distinct.size;
    const inUnit = values.every((v) => v >= 0 && v <= 1);
    const binary = values.every((v) => v === 0 || v === 1);
    if (column.knownAxis && !inUnit) {
      warnings.push({ code: "OUT_OF_AXIS_SCALE", message: "Cet axe contient des valeurs hors de l'échelle 0–1 : elles seraient ignorées par le moteur." });
    }
    inferredType = column.source === "price" ? "RANGE"
      : binary && !column.knownAxis ? "CATEGORICAL"
      : inUnit ? "NUMERIC" : "RANGE";
    if (values.length) {
      distribution = {
        kind: "numeric", min: round(values[0]), p10: round(quantile(values, 0.1)), p25: round(quantile(values, 0.25)),
        median: round(quantile(values, 0.5)), p75: round(quantile(values, 0.75)), p90: round(quantile(values, 0.9)), max: round(values[values.length - 1]),
      };
      const c1 = quantile(values, 1 / 3);
      const c2 = quantile(values, 2 / 3);
      const tranches = [0, 0, 0];
      for (const v of values) tranches[v <= c1 ? 0 : v <= c2 ? 1 : 2]++;
      discriminance = separatedPairs(tranches.filter(Boolean), total);
    }
    if (inferredType === "CATEGORICAL") {
      const ones = values.filter((v) => v === 1).length;
      const groups = [ones, values.length - ones].filter(Boolean);
      discriminance = separatedPairs(groups, total);
      dominantShare = values.length ? Math.max(ones, values.length - ones) / values.length : null;
      normalizedEntropy = groups.length > 1 ? entropy(groups) / Math.log(2) : null;
    }
  } else if (dominant === "boolean" || dominant === "text" || dominant === "list") {
    inferredType = "CATEGORICAL";
    const tally = new Map<string, { count: number; forms: Map<string, number> }>();
    const signatures = new Map<string, number>();
    let occurrences = 0;
    for (const cell of conforming) {
      cell.tokens!.forEach((token, index) => {
        const entry = tally.get(token) ?? { count: 0, forms: new Map() };
        entry.count++;
        occurrences++;
        const form = cell.raw![Math.min(index, cell.raw!.length - 1)];
        entry.forms.set(form, (entry.forms.get(form) ?? 0) + 1);
        tally.set(token, entry);
      });
      if (dominant === "list") {
        const signature = [...cell.tokens!].sort().join("\u0000");
        signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
      }
    }
    distinctCount = tally.size;
    const values: ColumnCategoryValue[] = [...tally.values()].map((entry) => ({
      // Forme d'origine la plus fréquente ; à égalité, ordre alphabétique : indépendant de l'ordre des produits.
      value: [...entry.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      count: entry.count,
      share: round(entry.count / (occurrences || 1)),
    })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    distribution = { kind: "categorical", values: values.slice(0, T.topValues), otherCount: values.slice(T.topValues).reduce((sum, v) => sum + v.count, 0) };
    if ([...tally.values()].some((entry) => entry.forms.size > 1)) {
      warnings.push({ code: "MERGED_VARIANTS", message: "Des écritures différentes (casse, espaces, accents) ont été comptées comme une même valeur pour les statistiques ; les données ne sont pas modifiées." });
    }
    const counts2 = values.map((v) => v.count);
    dominantShare = occurrences ? counts2[0] / occurrences : null;
    normalizedEntropy = counts2.length > 1 ? entropy(counts2) / Math.log(counts2.length) : null;
    const groupSizes = dominant === "list" ? [...signatures.values()] : counts2;
    discriminance = separatedPairs(groupSizes, total);
  }

  // ── Refus, dans l'ordre : le premier motif rencontré est celui qui est annoncé ──
  if (total < 2) reject("TOO_FEW_PRODUCTS", "Moins de 2 produits : aucun critère ne peut les départager.");
  if (dominant === "other") reject("UNSUPPORTED_STRUCTURE", "Valeurs imbriquées ou de structure non prise en charge.");
  if (present === 0 || coverage < T.minCoverage || present < T.minPresentCount) {
    reject("INSUFFICIENT_COVERAGE", `Renseigné sur ${present} produit(s) sur ${total} : trop peu pour servir de critère.`);
  }
  if (dominant === "text") {
    const lengths = conforming.map((cell) => cell.tokens![0].length).sort((a, b) => a - b);
    if (lengths.length && quantile(lengths, 0.5) > T.freeTextLength) reject("UNSUPPORTED_STRUCTURE", "Texte libre (descriptions, notes) : ce n'est pas une catégorie.");
  }
  if (present > 0 && parseRate < T.minParseRate) {
    reject("INVALID_VALUES", `${Math.round((1 - parseRate) * 100)} % des valeurs renseignées ne sont pas du même type que les autres (ou sont invalides).`);
  }
  if (dominant === "number" && (IDENTIFIER_NAMES.test(foldName(column.name)) ||
      (conforming.length >= 5 && distinctCount === conforming.length && conforming.every((c) => Number.isInteger(c.number) && c.number! >= T.identifierMinValue)))) {
    reject("IDENTIFIER_LIKE", "Ressemble à un identifiant (référence, code-barres), pas à une mesure.");
  }
  if (dominant === "text" && IDENTIFIER_NAMES.test(foldName(column.name))) reject("IDENTIFIER_LIKE", "Ressemble à un identifiant (référence), pas à une catégorie.");
  if (present > 0 && distinctCount === 1) reject("CONSTANT_VALUE", "Même valeur sur tous les produits renseignés.");
  if (inferredType === "CATEGORICAL" && present > 0) {
    const limit = dominant === "list" ? T.maxListVocabulary : T.maxCategories;
    if (distinctCount > limit) reject("HIGH_CARDINALITY", `${distinctCount} valeurs distinctes : trop pour une catégorie (maximum ${limit}).`);
    else if (dominant !== "list" && present >= T.minValuesForRatio && distinctCount / present > T.maxDistinctRatio) {
      reject("HIGH_CARDINALITY", "Presque une valeur différente par produit : ne regroupe pas les produits.");
    }
  }
  if (!rejection && present > 0 && distinctCount > 1) {
    if (dominantShare !== null && dominantShare >= T.maxDominantShare && dominant !== "list") {
      reject("INSUFFICIENT_VARIATION", `Une valeur couvre ${Math.round(dominantShare * 100)} % des produits : elle n'en sépare presque aucun.`);
    } else if (dominant === "number") {
      const dist = distribution as Extract<ColumnDistribution, { kind: "numeric" }>;
      const spread = dist.p90 - dist.p10;
      const relative = spread / (Math.max(Math.abs(dist.p10), Math.abs(dist.p90)) || 1);
      const tooFlat = inferredType === "NUMERIC" ? spread < T.minUnitSpread : relative < T.minRelativeSpread;
      if (inferredType !== "CATEGORICAL" && tooFlat) reject("INSUFFICIENT_VARIATION", "Les valeurs courantes sont presque identiques (seules quelques valeurs extrêmes diffèrent).");
    }
  }

  const usable = !rejection;
  if (usable && coverage < T.fullCoverage) {
    warnings.push({ code: "PARTIAL_COVERAGE", message: `Renseigné sur ${present} produit(s) sur ${total} : les autres ne seront pas départagés par ce critère.` });
  }
  if (usable && dominantShare !== null && dominantShare >= T.imbalancedShare && dominant !== "list") {
    warnings.push({ code: "IMBALANCED_DISTRIBUTION", message: `Une valeur couvre ${Math.round(dominantShare * 100)} % des produits renseignés : répartition très déséquilibrée.` });
  }
  // Marqueur descriptif prudent : mesure à échelle réelle (budget, poids, capacité) ou oui/non, très bien renseignée.
  // Une catégorie à peu de valeurs n'est JAMAIS un candidat à elle seule.
  const constraintCandidate = usable && coverage >= T.constraintCoverage &&
    (inferredType === "RANGE" || (inferredType === "CATEGORICAL" && dominant !== "list" && distinctCount === 2 && (valueKind === "boolean" || valueKind === "number")));

  return {
    key: column.key, source: column.source, name: column.name, inferredType, valueKind,
    totalProducts: total, productCount: present, coverage: round(coverage), parseRate: round(parseRate),
    distinctCount, distribution,
    normalizedEntropy: normalizedEntropy === null ? null : round(normalizedEntropy),
    dominantShare: dominantShare === null ? null : round(dominantShare),
    discriminance: round(discriminance), usable, rejection, warnings, constraintCandidate, knownAxis: column.knownAxis,
  };
}

function entropy(counts: number[]): number {
  const sum = counts.reduce((a, b) => a + b, 0);
  return counts.reduce((h, count) => (count ? h - (count / sum) * Math.log(count / sum) : h), 0);
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────

export interface ProfilableProduct {
  price?: number | null;
  brand?: string | null;
  tags?: readonly string[] | null;
  attributes?: unknown;
}

export interface ProfileOptions {
  /** Clés des axes de recommandation déjà définis (signalés dans `knownAxis`). */
  axisKeys?: Iterable<string>;
}

const SOURCE_RANK: Record<ColumnSource, number> = { price: 0, brand: 1, tags: 2, attribute: 3 };

/**
 * Un profil par critère potentiel : prix, marque, tags et chaque clé d'attributs (jamais le nom, l'id ni la description).
 * Résultat indépendant de l'ordre des produits, trié par source puis clé.
 */
export function profileColumns(products: readonly ProfilableProduct[], options: ProfileOptions = {}): ColumnProfile[] {
  if (!products.length) return [];
  const axisKeys = new Set(options.axisKeys ?? []);
  const attributeKeys = new Set<string>();
  const attributesOf = (product: ProfilableProduct): Record<string, unknown> =>
    product.attributes && typeof product.attributes === "object" && !Array.isArray(product.attributes) ? product.attributes as Record<string, unknown> : {};
  for (const product of products) for (const key of Object.keys(attributesOf(product))) attributeKeys.add(key);

  const columns: RawColumn[] = [
    { key: "price", source: "price", name: "price", values: products.map((p) => p.price), knownAxis: false },
    { key: "brand", source: "brand", name: "brand", values: products.map((p) => p.brand), knownAxis: false },
    { key: "tags", source: "tags", name: "tags", values: products.map((p) => (p.tags ? [...p.tags] : [])), knownAxis: false },
    ...[...attributeKeys].sort().map((name): RawColumn => ({
      key: `attribute.${name}`, source: "attribute", name, values: products.map((p) => attributesOf(p)[name]), knownAxis: axisKeys.has(name),
    })),
  ];
  return columns.map(analyseColumn).sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || a.key.localeCompare(b.key));
}
