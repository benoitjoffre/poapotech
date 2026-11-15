import type { ColumnProfile, ColumnRejectionCode, ColumnSource, ColumnType } from "@poapo/types";
import { classifyCell, isBlank, normalizeText, quantile, type ProfilableProduct } from "./catalogProfile";

/**
 * Sélection universelle des critères d'un catalogue (lot 10D-1). Fonction pure, sans secteur, sans écriture.
 * Elle ne crée AUCUNE question : elle classe les critères qui méritent d'être demandés à un visiteur, explique pourquoi,
 * et décrit comment le moteur actuel pourrait exploiter une réponse.
 *
 * Score d'un critère c, sachant les critères déjà retenus S :
 *   score(c | S) = gain(c) × (1 − redondance(c | S)) × fiabilité × intelligibilité × exploitabilité × rôle
 * - gain(c) : part des paires de produits que c sépare (les deux produits ont une valeur et des options différentes), rapportée
 *   à la couverture : gain = paires séparées / couverture. Il vaut donc (part de paires séparées parmi les produits renseignés)
 *   × couverture : un critère renseigné sur la moitié du catalogue pèse la moitié, sans être exclu.
 * - redondance(c | S) : plus grande dépendance, corrigée du hasard (type kappa), entre c et un critère déjà retenu s :
 *   (P(s sépare une paire que c sépare) − gain(s)) / (1 − gain(s)). 0 = indépendants, 1 = s sépare exactement les mêmes paires.
 *   Deux critères indépendants ne se pénalisent pas, même si chacun sépare déjà beaucoup de paires : deux visiteurs qui
 *   diffèrent sur deux dimensions indépendantes doivent pouvoir être distingués.
 */

export const CRITERIA_SELECTION_THRESHOLDS = {
  /** Nombre maximal de critères retenus automatiquement (≈ nombre de questions utiles d'un quiz court). */
  maxCriteria: 6,
  /** Gain marginal minimal (part des paires de produits) pour qu'un critère mérite une question. */
  minMarginalGain: 0.02,
  /** Options d'un critère catégoriel (au-delà : regroupées dans « autres »). Une catégorie rare (< 2 produits) n'est pas une option. */
  maxOptions: 6,
  minOptionCount: 2,
  /** Bandes proposées pour une mesure (prix, poids, intensité…) : terciles de la distribution réelle. */
  bands: 3,
  /** Au-delà, le gain est calculé sur un sous-échantillon déterministe (un produit sur k, par identifiant). */
  maxProductsForGain: 600,
  /** Facteurs de rôle : un critère dont l'utilité pour un visiteur est incertaine pèse moins. */
  roleWeight: { preference: 1, budget: 1, feature: 0.9, measure: 0.8, tags: 0.6, brand: 0.5 },
  /** Exploitabilité par le moteur ACTUEL (voir `engine`). */
  engineFactor: { direct_axis: 1, derived_axis: 0.85, needs_filter: 0.85, needs_rerank: 0.5 },
  /** Options affichées en clair : 2 à 6 ; 7 à 12 sont pénibles à lire. */
  comfortableOptions: 6,
  maxLabelLength: 25,
} as const;
const T = CRITERIA_SELECTION_THRESHOLDS;

export type CriterionRole = "budget" | "preference" | "feature" | "measure" | "brand" | "tags";
export type CriterionHandling = "numeric_preference" | "categorical_choice" | "budget_range" | "yes_no" | "multi_label_choice";
export type CriterionStatus = "selected" | "needs_validation" | "rejected";
export type SelectionRejectionCode =
  | ColumnRejectionCode
  | "METADATA_FIELD"
  | "CODE_LIKE_VALUES"
  | "INSUFFICIENT_GAIN"
  | "REDUNDANT"
  | "LIMIT_REACHED";
/** Mécanisme du moteur actuel qui pourrait exploiter une réponse (aucun n'est modifié par ce lot). */
export type EngineCompatibility = keyof typeof CRITERIA_SELECTION_THRESHOLDS.engineFactor;

export interface CriterionOption {
  label: string;
  /** Produits qui portent cette option (numérique : produits dans la bande). */
  count: number;
  /** Bandes numériques : bornes réelles observées dans le catalogue. */
  from?: number;
  to?: number;
}

export interface CriterionCandidate {
  /** Identifiant stable = clé du diagnostic (`price`, `brand`, `tags`, `attribute.x`). */
  id: string;
  type: ColumnType;
  source: ColumnSource;
  label: string;
  role: CriterionRole;
  status: CriterionStatus;
  rank: number | null;
  coverage: number;
  productCount: number;
  options: CriterionOption[];
  /** Options supplémentaires non listées (regroupées dans « autres »). */
  otherCount: number;
  /** Part des paires de produits séparées par ce critère seul. */
  gain: number;
  /** gain × (1 − redondance) au moment de la sélection. */
  marginalGain: number;
  /** Dépendance (corrigée du hasard) avec le critère retenu le plus proche : 0 = indépendant, 1 = mêmes séparations. */
  redundancy: number;
  mostSimilarTo: string | null;
  factors: { reliability: number; clarity: number; engine: number; role: number };
  score: number;
  handling: CriterionHandling | null;
  /** « preference » par défaut ; un plafond strict n'est jamais activé automatiquement (jamais de relâchement silencieux). */
  mode: { default: "preference"; strictPossible: boolean; strictRequiresMerchant: true };
  engine: { compatibility: EngineCompatibility | null; note: string };
  needsValidation: boolean;
  validationReason: string | null;
  reasons: string[];
  warnings: string[];
  rejection: { code: SelectionRejectionCode; message: string } | null;
}

export interface CriteriaSelection {
  totalProducts: number;
  /** Vrai si le gain a été calculé sur un sous-échantillon déterministe. */
  sampled: boolean;
  /** Retenus (par rang), puis à valider (par score), puis écartés (par identifiant). */
  criteria: CriterionCandidate[];
}

/** `id` facultatif : s'il est présent sur tous les produits, le sous-échantillon est choisi par ordre d'identifiant (indépendant de l'ordre fourni). */
export interface SelectableProduct extends ProfilableProduct { id?: string }

export interface SelectionOptions {
  maxCriteria?: number;
  minMarginalGain?: number;
}

// ─── Rôles (déduits des données et du nom du champ, jamais du secteur) ───────

/** Noms de champs internes : référence fournisseur, stock, dates, identifiants. Règle générique, valable pour tout secteur. */
const METADATA_NAME = /^(id|uuid|ref|reference|refinterne|reffournisseur|sku|ean|upc|gtin|isbn|barcode|codebarre|codebarres|code|codeinterne|codeproduit|fournisseur|supplier|stock|quantite|qte|lot|datecreation|dateajout|createdat|updatedat|import|source)$/;
const foldName = (value: string) => normalizeText(value).replace(/[^a-z0-9]/g, "");

function humanize(name: string): string {
  const text = name.replace(/^col_/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function labelFor(profile: ColumnProfile): string {
  if (profile.source === "price") return "Prix";
  if (profile.source === "brand") return "Marque";
  if (profile.source === "tags") return "Mots-clés";
  return humanize(profile.name);
}

/** Valeurs qui ressemblent à des codes (REF-1042, A12…) : au moins 90 % mêlent lettres et chiffres, sans espace, 3 à 20 caractères. Un nombre seul (une pointure) n'en est pas un. */
function looksLikeCode(values: readonly string[]): boolean {
  if (!values.length) return false;
  const codes = values.filter((value) => /\d/.test(value) && /[a-z]/i.test(value) && !/\s/.test(value) && value.length >= 3 && value.length <= 20);
  return codes.length / values.length >= 0.9;
}

// ─── Partitions (options réellement proposables) ──────────────────────────────

interface Partition {
  /** Une étiquette entière par produit (indice de produit), −1 = sans valeur. */
  labels: Int32Array;
  options: CriterionOption[];
  otherCount: number;
}

function valueOf(product: ProfilableProduct, profile: ColumnProfile): unknown {
  if (profile.source === "price") return product.price;
  if (profile.source === "brand") return product.brand;
  if (profile.source === "tags") return product.tags ? [...product.tags] : [];
  const attributes = product.attributes && typeof product.attributes === "object" && !Array.isArray(product.attributes) ? product.attributes as Record<string, unknown> : {};
  return attributes[profile.name];
}

function categoricalPartition(profile: ColumnProfile, products: readonly ProfilableProduct[]): Partition {
  const tokens: (string | null)[] = [];
  const forms = new Map<string, Map<string, number>>();
  const isList = profile.valueKind === "list";
  for (const product of products) {
    const value = valueOf(product, profile);
    if (isBlank(value)) { tokens.push(null); continue; }
    const cell = classifyCell(value);
    if (cell.kind === "other" || (cell.kind === "number" && !(profile.valueKind === "number"))) { tokens.push(null); continue; }
    const token = cell.kind === "number" ? String(cell.number) : isList ? [...cell.tokens!].sort().join("\u0000") : cell.tokens![0];
    tokens.push(token);
    const form = cell.kind === "number" ? String(cell.number) : isList ? cell.raw!.join(" + ") : cell.raw![0];
    const entry = forms.get(token) ?? new Map<string, number>();
    entry.set(form, (entry.get(form) ?? 0) + 1);
    forms.set(token, entry);
  }
  const counts = new Map<string, number>();
  for (const token of tokens) if (token !== null) counts.set(token, (counts.get(token) ?? 0) + 1);
  // Options = valeurs les plus fréquentes (au moins 2 produits), au plus maxOptions ; égalité : ordre alphabétique du libellé.
  const display = (token: string) => [...forms.get(token)!.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const ranked = [...counts.entries()].map(([token, count]) => ({ token, count, label: display(token) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const chosen = ranked.filter((entry) => entry.count >= T.minOptionCount).slice(0, T.maxOptions);
  const index = new Map(chosen.map((entry, i) => [entry.token, i]));
  const other = chosen.length;
  const labels = Int32Array.from(tokens, (token) => (token === null ? -1 : index.get(token) ?? other));
  const otherCount = ranked.length - chosen.length;
  return { labels, options: chosen.map((entry) => ({ label: entry.label, count: entry.count })), otherCount };
}

function numericPartition(profile: ColumnProfile, products: readonly ProfilableProduct[]): Partition {
  const values = products.map((product) => {
    const value = valueOf(product, profile);
    if (isBlank(value)) return null;
    const cell = classifyCell(value);
    if (cell.kind !== "number" || (profile.source === "price" && cell.number! < 0)) return null;
    return cell.number!;
  });
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const distinct = [...new Set(sorted)];
  // Peu de valeurs distinctes (contenances 30/50/100 ml) : une option par valeur réelle. Sinon : terciles de la distribution.
  let edges: number[];
  if (distinct.length <= T.bands) edges = distinct.slice(0, -1);
  else {
    const cuts = [quantile(sorted, 1 / 3), quantile(sorted, 2 / 3)];
    edges = [...new Set(cuts)];
  }
  const bandOf = (v: number) => edges.findIndex((edge) => v <= edge) === -1 ? edges.length : edges.findIndex((edge) => v <= edge);
  const labels = Int32Array.from(values, (v) => (v === null ? -1 : bandOf(v)));
  const options: CriterionOption[] = Array.from({ length: edges.length + 1 }, (_, band) => {
    const inBand = sorted.filter((v) => bandOf(v) === band);
    return { label: "", count: inBand.length, from: inBand[0], to: inBand[inBand.length - 1] };
  }).filter((option) => option.count > 0);
  options.forEach((option) => { option.label = option.from === option.to ? String(option.from) : `${option.from} – ${option.to}`; });
  return { labels, options, otherCount: 0 };
}

// ─── Gain marginal ────────────────────────────────────────────────────────────

/** Part de toutes les paires de produits séparées par une partition (étiquettes < 0 = sans valeur). */
function separatedFraction(labels: Int32Array, n: number): number {
  if (n < 2) return 0;
  const sizes = new Map<number, number>();
  let present = 0;
  for (const label of labels) if (label >= 0) { sizes.set(label, (sizes.get(label) ?? 0) + 1); present++; }
  let same = 0;
  for (const size of sizes.values()) same += size * size;
  return (present * present - same) / 2 / ((n * (n - 1)) / 2);
}

/** Redondance de `candidate` avec `kept` corrigée du hasard : voir l'en-tête du fichier. */
function redundancyWith(candidate: Int32Array, kept: Int32Array, keptGain: number, n: number): number {
  let separates = 0;
  let both = 0;
  for (let i = 0; i < n; i++) {
    if (candidate[i] < 0) continue;
    for (let j = i + 1; j < n; j++) {
      if (candidate[j] < 0 || candidate[i] === candidate[j]) continue;
      separates++;
      if (kept[i] >= 0 && kept[j] >= 0 && kept[i] !== kept[j]) both++;
    }
  }
  if (!separates || keptGain >= 1) return 0;
  return Math.min(1, Math.max(0, (both / separates - keptGain) / (1 - keptGain)));
}

// ─── Sélection ────────────────────────────────────────────────────────────────

interface Prepared {
  profile: ColumnProfile;
  role: CriterionRole;
  handling: CriterionHandling;
  partition: Partition;
  factors: { reliability: number; clarity: number; engine: number; role: number };
  engine: { compatibility: EngineCompatibility; note: string };
  needsValidation: boolean;
  validationReason: string | null;
  warnings: string[];
}

function roleOf(profile: ColumnProfile): { role: CriterionRole; handling: CriterionHandling } {
  if (profile.source === "price") return { role: "budget", handling: "budget_range" };
  if (profile.source === "brand") return { role: "brand", handling: "categorical_choice" };
  if (profile.source === "tags") return { role: "tags", handling: "multi_label_choice" };
  if (profile.inferredType === "NUMERIC") return { role: "preference", handling: "numeric_preference" };
  if (profile.inferredType === "RANGE") return { role: "measure", handling: "budget_range" };
  if (profile.distinctCount === 2) return { role: "feature", handling: "yes_no" };
  return { role: "preference", handling: "categorical_choice" };
}

function engineOf(profile: ColumnProfile, handling: CriterionHandling): { compatibility: EngineCompatibility; note: string } {
  if (handling === "numeric_preference") {
    return profile.knownAxis
      ? { compatibility: "direct_axis", note: "Axe déjà défini : les impacts des réponses déplacent le profil, et le classement le compare aux valeurs des produits (40 % du score)." }
      : { compatibility: "derived_axis", note: "Valeurs entre 0 et 1 mais pas encore un axe du quiz : il faudrait en faire un axe (limité à 12 par quiz)." };
  }
  if (handling === "multi_label_choice") {
    return { compatibility: "needs_rerank", note: "Plusieurs mots-clés par produit : aucun mécanisme actuel ne les compare à une réponse (reclassement nécessaire)." };
  }
  return {
    compatibility: "needs_filter",
    note: "Le moteur sait restreindre les produits candidats (productIds) mais une réponse ne peut pas encore porter ce filtre : mécanisme de réponse à ajouter, sans toucher au scoring.",
  };
}

function prepare(profile: ColumnProfile, products: readonly ProfilableProduct[]): Prepared {
  const { role, handling } = roleOf(profile);
  const numeric = profile.inferredType === "NUMERIC" || profile.inferredType === "RANGE";
  const partition = numeric ? numericPartition(profile, products) : categoricalPartition(profile, products);
  const optionCount = partition.options.length + (partition.otherCount ? 1 : 0);
  const warnings: string[] = [];
  const optionsFactor = optionCount <= T.comfortableOptions ? 1 : 0.7;
  if (partition.otherCount > 0) warnings.push(`${partition.otherCount} valeur(s) rare(s) ou trop nombreuse(s) regroupée(s) dans « autres ».`);
  const labelLengths = partition.options.map((option) => option.label.length).sort((a, b) => a - b);
  const median = labelLengths.length ? labelLengths[Math.floor(labelLengths.length / 2)] : 0;
  const labelFactor = numeric || median <= T.maxLabelLength ? 1 : 0.8;
  const keyFactor = profile.name.startsWith("col_") ? 0.7 : 1;
  const engine = engineOf(profile, handling);
  let needsValidation = false;
  let validationReason: string | null = null;
  if (role === "brand") { needsValidation = true; validationReason = "Une marque n'est pas toujours un critère de choix pour un visiteur : à valider."; }
  else if (role === "tags") { needsValidation = true; validationReason = "Les mots-clés sont souvent du marketing ou du classement interne : à valider."; }
  else if (role === "measure") { needsValidation = true; validationReason = "Caractéristique mesurée (poids, capacité…) : critère de choix ou simple fiche technique ? À valider."; }
  else if (role === "feature") { needsValidation = true; validationReason = "Oui / non : préférence, exigence ou simple information ? À valider (une exigence ne doit jamais être décidée automatiquement)."; }
  return {
    profile, role, handling, partition, engine, needsValidation, validationReason, warnings,
    factors: { reliability: profile.parseRate, clarity: optionsFactor * labelFactor * keyFactor, engine: T.engineFactor[engine.compatibility], role: T.roleWeight[role] },
  };
}

const factorProduct = (f: Prepared["factors"]) => f.reliability * f.clarity * f.engine * f.role;

function reasonsFor(c: Prepared, marginal: number, redundancy: number): string[] {
  const { profile, partition } = c;
  const reasons = [`Renseigné sur ${profile.productCount} produit(s) sur ${profile.totalProducts} (${Math.round(profile.coverage * 100)} %).`];
  const options = partition.options.length;
  reasons.push(c.handling === "budget_range" || c.handling === "numeric_preference"
    ? `${options} tranche(s) tirée(s) des valeurs réelles du catalogue.`
    : `${options} choix réel(s) dans le catalogue${partition.otherCount ? ` (+ ${partition.otherCount} regroupé(s))` : ""}.`);
  reasons.push(`Sépare ${Math.round(marginal * 100)} % des paires de produits${redundancy > 0.05 ? ` après avoir retiré ce que les critères précédents font déjà (${Math.round(redundancy * 100)} % de recoupement)` : ""}.`);
  return reasons;
}

function makeCandidate(c: Prepared, over: Partial<CriterionCandidate>): CriterionCandidate {
  const { profile } = c;
  return {
    id: profile.key, type: profile.inferredType, source: profile.source, label: labelFor(profile), role: c.role, status: "rejected",
    rank: null, coverage: profile.coverage, productCount: profile.productCount, options: c.partition.options, otherCount: c.partition.otherCount,
    gain: 0, marginalGain: 0, redundancy: 0, mostSimilarTo: null, factors: c.factors, score: 0, handling: c.handling,
    mode: { default: "preference", strictPossible: profile.constraintCandidate, strictRequiresMerchant: true },
    engine: c.engine, needsValidation: c.needsValidation, validationReason: c.validationReason, reasons: [], warnings: [...c.warnings, ...profile.warnings.map((w) => w.message)],
    rejection: null, ...over,
  };
}

/** Candidat refusé avant tout calcul (diagnostic 10B ou nature du champ) : sans partition ni score. */
function rejectedEarly(profile: ColumnProfile, code: SelectionRejectionCode, message: string): CriterionCandidate {
  const { role, handling } = roleOf(profile);
  return {
    id: profile.key, type: profile.inferredType, source: profile.source, label: labelFor(profile), role, status: "rejected", rank: null,
    coverage: profile.coverage, productCount: profile.productCount, options: [], otherCount: 0, gain: 0, marginalGain: 0, redundancy: 0, mostSimilarTo: null,
    factors: { reliability: profile.parseRate, clarity: 0, engine: 0, role: T.roleWeight[role] }, score: 0, handling,
    mode: { default: "preference", strictPossible: false, strictRequiresMerchant: true },
    engine: { compatibility: null, note: "" }, needsValidation: false, validationReason: null, reasons: [], warnings: [],
    rejection: { code, message },
  };
}

export function selectQuizCriteria(
  profiles: readonly ColumnProfile[],
  products: readonly SelectableProduct[],
  options: SelectionOptions = {},
): CriteriaSelection {
  const maxCriteria = options.maxCriteria ?? T.maxCriteria;
  const minGain = options.minMarginalGain ?? T.minMarginalGain;
  // Sous-échantillon déterministe pour borner le coût : un produit sur k dans l'ordre des identifiants (fourni par l'appelant via l'ordre de `products`).
  const ordered = products.every((p) => typeof p.id === "string") ? [...products].sort((a, b) => a.id!.localeCompare(b.id!)) : products;
  const stride = Math.max(1, Math.ceil(ordered.length / T.maxProductsForGain));
  const sampled = stride > 1;
  const sample = ordered.filter((_, i) => i % stride === 0);
  const n = sample.length;

  const early: CriterionCandidate[] = [];
  const prepared: Prepared[] = [];
  for (const profile of [...profiles].sort((a, b) => a.key.localeCompare(b.key))) {
    if (!profile.usable) {
      early.push(rejectedEarly(profile, profile.rejection!.code, profile.rejection!.message));
      continue;
    }
    if (METADATA_NAME.test(foldName(profile.name)) && profile.source === "attribute") {
      early.push(rejectedEarly(profile, "METADATA_FIELD", "Champ interne (référence, stock, date…) : ce n'est pas un critère de choix pour un visiteur."));
      continue;
    }
    const candidate = prepare(profile, sample);
    if (profile.inferredType === "CATEGORICAL" && looksLikeCode(candidate.partition.options.map((o) => o.label))) {
      early.push(rejectedEarly(profile, "CODE_LIKE_VALUES", "Les valeurs ressemblent à des codes internes, pas à des choix compréhensibles."));
      continue;
    }
    prepared.push(candidate);
  }

  // Gain linéaire en couverture : un visiteur compare les produits qui ont une valeur, pas les paires de paires.
  // `raw` (part brute des paires séparées, quadratique en couverture) sert seulement de référence au calcul de redondance.
  const rawGain = new Map(prepared.map((c) => [c.profile.key, separatedFraction(c.partition.labels, n)]));
  const gainOf = new Map(prepared.map((c) => {
    const present = c.partition.labels.reduce((count, label) => count + (label >= 0 ? 1 : 0), 0);
    return [c.profile.key, present ? (rawGain.get(c.profile.key) ?? 0) / (present / n) : 0] as const;
  }));
  const selected: CriterionCandidate[] = [];
  // Redondance courante de chaque candidat : max sur les critères retenus (mise à jour à chaque retenue).
  const redundancy = new Map(prepared.map((c) => [c.profile.key, { value: 0, with: null as string | null }]));
  const marginal = (c: Prepared) => (gainOf.get(c.profile.key) ?? 0) * (1 - redundancy.get(c.profile.key)!.value);
  const describe = (c: Prepared) => {
    const r = redundancy.get(c.profile.key)!;
    return { gain: round(gainOf.get(c.profile.key) ?? 0), marginalGain: round(marginal(c)), redundancy: round(r.value), mostSimilarTo: r.value > 0.05 ? r.with : null, score: round(marginal(c) * factorProduct(c.factors)) };
  };

  // Glouton : critères sûrs d'abord (ceux qui ne demandent pas de validation du commerçant).
  const remaining = new Set(prepared.filter((c) => !c.needsValidation));
  while (selected.length < maxCriteria && remaining.size) {
    let best: Prepared | null = null;
    let bestScore = -1;
    for (const c of [...remaining].sort((a, b) => a.profile.key.localeCompare(b.profile.key))) {
      if (marginal(c) < minGain) continue;
      const score = marginal(c) * factorProduct(c.factors);
      if (score > bestScore + 1e-12) { best = c; bestScore = score; }
    }
    if (!best) break;
    remaining.delete(best);
    selected.push(makeCandidate(best, {
      ...describe(best), status: "selected", rank: selected.length + 1, reasons: reasonsFor(best, marginal(best), redundancy.get(best.profile.key)!.value),
    }));
    for (const c of prepared) {
      if (c === best || selected.some((s) => s.id === c.profile.key)) continue;
      const value = redundancyWith(c.partition.labels, best.partition.labels, rawGain.get(best.profile.key) ?? 0, n);
      const current = redundancy.get(c.profile.key)!;
      if (value > current.value) { current.value = value; current.with = best.profile.key; }
    }
  }

  // Les autres : à valider (rôle incertain) ou écartés (redondants, trop peu utiles, au-delà de la limite).
  const rest: CriterionCandidate[] = [];
  const leftovers = prepared.filter((c) => !selected.some((s) => s.id === c.profile.key)).sort((a, b) => a.profile.key.localeCompare(b.profile.key));
  for (const c of leftovers) {
    const info = describe(c);
    if (info.gain < minGain) {
      rest.push(makeCandidate(c, { ...info, rejection: { code: "INSUFFICIENT_GAIN", message: "Sépare trop peu de produits pour justifier une question." } }));
    } else if (info.marginalGain < minGain) {
      rest.push(makeCandidate(c, { ...info, rejection: { code: "REDUNDANT", message: `Sépare presque les mêmes produits que « ${info.mostSimilarTo ?? "un critère retenu"} » : une question de plus n'apporterait rien.` } }));
    } else if (c.needsValidation) {
      rest.push(makeCandidate(c, { ...info, status: "needs_validation", reasons: reasonsFor(c, marginal(c), redundancy.get(c.profile.key)!.value) }));
    } else {
      rest.push(makeCandidate(c, { ...info, rejection: { code: "LIMIT_REACHED", message: `Utile, mais au-delà des ${maxCriteria} critères conservés pour garder un quiz court.` }, reasons: reasonsFor(c, marginal(c), redundancy.get(c.profile.key)!.value) }));
    }
  }
  const validation = rest.filter((c) => c.status === "needs_validation").sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const rejected = [...rest.filter((c) => c.status === "rejected"), ...early].sort((a, b) => a.id.localeCompare(b.id));
  return { totalProducts: products.length, sampled, criteria: [...selected, ...validation, ...rejected] };
}

const round = (value: number) => Number(value.toFixed(4));
