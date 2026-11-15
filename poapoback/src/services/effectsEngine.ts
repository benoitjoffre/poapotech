import { classifyCell, isBlank, normalizeText, quantile } from "./catalogProfile";
import { ANSWER_EFFECTS_LIMITS, type AnswerEffect, type AnswerEffects } from "./answerEffects";

/**
 * Exploitation des effets de réponse (lot 10D-2A) : fonctions pures, sans base ni réseau, sans scoring.
 *
 *   Réponse → effets → [contraintes strictes] → produits candidats (productIds, mécanisme existant du moteur)
 *                    → [préférences souples] → re-classement côté Node des produits déjà notés par le moteur.
 *
 * Le moteur Python n'est ni appelé ni modifié ici : ce module reçoit des scores déjà calculés.
 */

export interface EffectProduct {
  id: string;
  price?: number | null;
  brand?: string | null;
  tags?: readonly string[] | null;
  attributes?: unknown;
}

export interface SelectedAnswer {
  questionId: string;
  /** null = réponse sans effets (ancien comportement, aucune contrainte ni bonus). */
  effects: AnswerEffects | null;
}

/**
 * Poids du bonus de préférence, relatif à l'écart de scores des candidats (voir `rerankSoft`). Mesuré par simulation (lot 10D-2A,
 * moteur proxy) : λ = 1 est la plus petite valeur testée qui obtient ≥ 90 % du gain de pertinence de λ = 2 sur 60, 120 et 400 produits
 * (λ = 0,5 : 75 à 80 %). À recalibrer avec le vrai moteur et des jugements humains avant toute mise en production.
 */
export const SOFT_PREFERENCE_LAMBDA = 1;
/** Sous ce nombre de produits conformes, on le signale (« sélection restreinte ») sans jamais en inventer. */
export const FEW_RESULTS = 3;

type Cell = { kind: "missing" } | { kind: "list"; tokens: string[] } | { kind: "text"; token: string } | { kind: "number"; value: number };

function readCell(product: EffectProduct, criterion: string): Cell {
  let raw: unknown;
  if (criterion === "price") raw = product.price;
  else if (criterion === "brand") raw = product.brand;
  else if (criterion === "tags") raw = product.tags ? [...product.tags] : [];
  else {
    const attributes = product.attributes && typeof product.attributes === "object" && !Array.isArray(product.attributes) ? product.attributes as Record<string, unknown> : {};
    raw = attributes[criterion.slice("attribute.".length)];
  }
  if (isBlank(raw)) return { kind: "missing" };
  const cell = classifyCell(raw);
  if (cell.kind === "number") return { kind: "number", value: cell.number! };
  if (cell.kind === "list") return { kind: "list", tokens: cell.tokens! };
  if (cell.kind === "text" || cell.kind === "boolean") return { kind: "text", token: cell.tokens![0] };
  return { kind: "missing" };
}

type Verdict = "match" | "no" | "missing";

function categoryVerdict(cell: Cell, values: ReadonlySet<string>): Verdict {
  if (cell.kind === "missing") return "missing";
  if (cell.kind === "list") return cell.tokens.some((t) => values.has(t)) ? "match" : "no";
  if (cell.kind === "text") return values.has(cell.token) ? "match" : "no";
  return values.has(String(cell.value)) ? "match" : "no";
}

function rangeVerdict(cell: Cell, min?: number, max?: number): Verdict {
  if (cell.kind !== "number") return cell.kind === "missing" ? "missing" : "no";
  return (min === undefined || cell.value >= min) && (max === undefined || cell.value <= max) ? "match" : "no";
}

function verdictOf(product: EffectProduct, effect: Extract<AnswerEffect, { type: "category" | "range" }>): Verdict {
  const cell = readCell(product, effect.criterion);
  return effect.type === "category"
    ? categoryVerdict(cell, new Set(effect.values.map(normalizeText)))
    : rangeVerdict(cell, effect.min, effect.max);
}

// ─── Contraintes strictes ─────────────────────────────────────────────────────

type Rule = Extract<AnswerEffect, { type: "category" | "range" }>;

export interface ConstraintGroup {
  questionId: string;
  criterion: string;
  /** Alternatives (OU) : plusieurs réponses d'une même question à choix multiples. Les groupes entre eux sont en ET. */
  alternatives: Rule[];
  description: string;
  /** Produits conformes à ce groupe pris seul (pour expliquer un échec). */
  matching: number;
}

export interface StrictResolution {
  state: "unconstrained" | "ok" | "no_match" | "unreliable";
  /** Identifiants à envoyer au moteur (`productIds`) ; null = aucun filtre. Jamais élargi en cas d'échec. */
  candidateIds: string[] | null;
  matched: number;
  /** 1 ou 2 produits : proposés tels quels, sans en inventer d'autres. */
  limited: boolean;
  reason: "no_product" | "contradiction" | "unreliable_data" | null;
  message: string | null;
  groups: ConstraintGroup[];
}

const describeRule = (rule: Rule) => rule.type === "category"
  ? `${rule.criterion} ∈ {${rule.values.join(", ")}}`
  : `${rule.criterion} ${rule.min !== undefined ? `≥ ${rule.min}` : ""}${rule.min !== undefined && rule.max !== undefined ? " et " : ""}${rule.max !== undefined ? `≤ ${rule.max}` : ""}`.trim();

function strictRules(answers: readonly SelectedAnswer[]): { questionId: string; rule: Rule }[] {
  return answers.flatMap((answer) => (answer.effects?.effects ?? []).flatMap((effect) =>
    (effect.type === "category" || effect.type === "range") && effect.mode === "strict" ? [{ questionId: answer.questionId, rule: effect }] : []));
}

function softRules(answers: readonly SelectedAnswer[]): { questionId: string; rule: Rule }[] {
  return answers.flatMap((answer) => (answer.effects?.effects ?? []).flatMap((effect) =>
    (effect.type === "category" || effect.type === "range") && effect.mode === "soft" ? [{ questionId: answer.questionId, rule: effect }] : []));
}

/**
 * Applique les contraintes strictes. Politique des données absentes (STRICT) : un produit sans valeur est EXCLU, sauf si la
 * contrainte porte `onMissing: "include"` (choix explicite). Une contrainte sur une caractéristique renseignée à moins de 90 %
 * n'est pas appliquée : l'état est `unreliable` (explicite), jamais un filtre silencieusement ignoré.
 */
export function resolveStrict(products: readonly EffectProduct[], answers: readonly SelectedAnswer[]): StrictResolution {
  const entries = strictRules(answers);
  if (!entries.length) return { state: "unconstrained", candidateIds: null, matched: products.length, limited: false, reason: null, message: null, groups: [] };

  // Fiabilité des données, mesurée sur tout le catalogue fourni.
  const unreliable = [...new Set(entries.map((e) => e.rule.criterion))].filter((criterion) => {
    const present = products.filter((p) => readCell(p, criterion).kind !== "missing").length;
    return products.length === 0 || present / products.length < ANSWER_EFFECTS_LIMITS.strictMinCoverage;
  });
  if (unreliable.length) {
    return { state: "unreliable", candidateIds: [], matched: 0, limited: false, reason: "unreliable_data", groups: [],
      message: `Contrainte impossible à appliquer de façon fiable : ${unreliable.join(", ")} n'est pas assez renseigné.` };
  }

  // Groupes : (question, caractéristique). OU à l'intérieur d'un groupe, ET entre groupes.
  const groups = new Map<string, { questionId: string; criterion: string; rules: Rule[] }>();
  for (const { questionId, rule } of entries) {
    const key = `${questionId}\u0000${rule.criterion}`;
    const group = groups.get(key) ?? { questionId, criterion: rule.criterion, rules: [] };
    group.rules.push(rule);
    groups.set(key, group);
  }
  const passes = (product: EffectProduct, rules: Rule[]): boolean => {
    const verdicts = rules.map((rule) => ({ rule, verdict: verdictOf(product, rule) }));
    if (verdicts.some((v) => v.verdict === "match")) return true;
    const missing = verdicts.filter((v) => v.verdict === "missing");
    return missing.length > 0 && missing.every((v) => v.rule.onMissing === "include");
  };
  const described: ConstraintGroup[] = [...groups.values()].map((g) => ({
    questionId: g.questionId, criterion: g.criterion, alternatives: g.rules,
    description: g.rules.map(describeRule).join(" ou "), matching: products.filter((p) => passes(p, g.rules)).length,
  }));
  const candidates = products.filter((p) => [...groups.values()].every((g) => passes(p, g.rules)));
  if (candidates.length === 0) {
    const empty = described.find((g) => g.matching === 0);
    return {
      state: "no_match", candidateIds: [], matched: 0, limited: false, groups: described,
      reason: empty ? "no_product" : "contradiction",
      message: empty ? `Aucun produit ne correspond à : ${empty.description}.`
        : `Aucun produit ne satisfait ensemble : ${described.map((g) => g.description).join(" ET ")}.`,
    };
  }
  return { state: "ok", candidateIds: candidates.map((p) => p.id).sort(), matched: candidates.length, limited: candidates.length < FEW_RESULTS, reason: null, message: null, groups: described };
}

// ─── Préférences souples ──────────────────────────────────────────────────────

export interface ScoredProduct { id: string; score: number }

export interface RankedProduct extends ScoredProduct {
  bonus: number;
  adjusted: number;
  /** Caractéristiques pour lesquelles ce produit répond à une préférence. */
  matched: string[];
}

/**
 * Amplitude du bonus de préférence (bonus d'un produit = amplitude × degré moyen de correspondance, de 0 à 1) :
 *  - window_spread : λ × écart max−min des scores de la fenêtre récupérée (formule historique ; DÉPEND de la fenêtre, donc de la stratégie de récupération) ;
 *  - constant      : beta, en points de score moteur ;
 *  - anchored      : κ × `reference`, écart des scores du PREMIER appel (général), identique quelle que soit la stratégie de récupération.
 */
export type BonusModel =
  | { kind: "window_spread"; lambda: number }
  | { kind: "constant"; beta: number }
  | { kind: "anchored"; kappa: number };

/** Plancher de la référence d'un bonus ancré : si les scores du premier appel sont identiques, la préférence doit quand même départager. */
export const REFERENCE_FLOOR = 0.01;

export interface SoftResult {
  ranked: RankedProduct[];
  /** Caractéristiques préférées (après fusion). */
  criteria: string[];
  /** Préférences souples ignorées car une contrainte stricte porte déjà sur la même caractéristique. */
  ignored: string[];
  /** Préférences contradictoires (ex. deux familles demandées) : expliquées, pas arbitrées en silence. */
  conflicts: string[];
}

/** Part d'une préférence respectée par un produit, de 0 à 1. Valeur absente : 0 (ni bonus ni pénalité par rapport à un produit non conforme). */
function degree(rule: Rule, cell: Cell, scale: number): number {
  if (rule.type === "category") return categoryVerdict(cell, new Set(rule.values.map(normalizeText))) === "match" ? 1 : 0;
  if (cell.kind !== "number") return 0;
  if (rangeVerdict(cell, rule.min, rule.max) === "match") return 1;
  const gap = rule.min !== undefined && cell.value < rule.min ? rule.min - cell.value : cell.value - (rule.max as number);
  return scale > 0 ? Math.max(0, 1 - gap / scale) : 0;
}

/** Échelle d'une mesure : écart p10–p90 observé dans le catalogue (à défaut, min–max). */
function scaleOf(products: readonly EffectProduct[], criterion: string): number {
  const values = products.map((p) => readCell(p, criterion)).flatMap((c) => (c.kind === "number" ? [c.value] : [])).sort((a, b) => a - b);
  if (values.length < 2) return 0;
  const spread = quantile(values, 0.9) - quantile(values, 0.1);
  return spread > 0 ? spread : values[values.length - 1] - values[0];
}

/**
 * Re-classement déterministe des produits déjà notés par le moteur.
 *   ajusté = score + λ × (écart max−min des scores candidats) × moyenne, sur les caractéristiques préférées, du degré de correspondance.
 * - tous les candidats restent éligibles (le bonus ne retire personne) ;
 * - une valeur absente ne donne aucun bonus ;
 * - une caractéristique citée plusieurs fois compte UNE fois (le meilleur degré) : répéter une préférence ne la renforce pas ;
 * - le bonus total est borné par λ × écart, quel que soit le nombre de préférences ;
 * - égalités : ajusté, puis score du moteur, puis identifiant.
 */
export function rerankSoft(
  scored: readonly ScoredProduct[],
  products: readonly EffectProduct[],
  answers: readonly SelectedAnswer[],
  options: { lambda?: number; bonus?: BonusModel; reference?: number } = {},
): SoftResult {
  const model: BonusModel = options.bonus ?? { kind: "window_spread", lambda: options.lambda ?? SOFT_PREFERENCE_LAMBDA };
  const strictCriteria = new Set(strictRules(answers).map((e) => e.rule.criterion));
  const prefs = softRules(answers);
  const ignored = [...new Set(prefs.filter((p) => strictCriteria.has(p.rule.criterion)).map((p) => p.rule.criterion))].sort();
  const active = prefs.filter((p) => !strictCriteria.has(p.rule.criterion));
  const criteria = [...new Set(active.map((p) => p.rule.criterion))].sort();

  const conflicts: string[] = [];
  for (const criterion of criteria) {
    const rules = active.filter((p) => p.rule.criterion === criterion);
    const questions = new Set(rules.map((r) => r.questionId));
    if (questions.size < 2) continue;
    const sets = rules.map((r) => r.rule.type === "category" ? new Set(r.rule.values.map(normalizeText)) : null);
    const disjoint = sets.some((a, i) => sets.some((b, j) => j > i && a && b && ![...a].some((v) => b.has(v))));
    const ranges = rules.filter((r) => r.rule.type === "range");
    const apart = ranges.some((a, i) => ranges.some((b, j) => j > i && ((a.rule as Rule & { max?: number }).max ?? Infinity) < ((b.rule as Rule & { min?: number }).min ?? -Infinity)));
    if (disjoint || apart) conflicts.push(`Préférences différentes sur ${criterion} (questions distinctes) : un produit est favorisé s'il correspond à l'une d'elles, sans cumul.`);
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  const scores = scored.map((s) => s.score);
  const spread = scores.length ? Math.max(...scores) - Math.min(...scores) : 0;
  // Écart nul (scores identiques) : le bonus doit quand même départager, sans fixer d'unité arbitraire.
  const unit = spread > 0 ? spread : 1e-6;
  const amplitude = model.kind === "window_spread" ? model.lambda * unit
    : model.kind === "constant" ? model.beta
    : model.kappa * Math.max(options.reference ?? 0, REFERENCE_FLOOR);
  const scales = new Map(criteria.map((criterion) => [criterion, scaleOf(products, criterion)]));

  const ranked: RankedProduct[] = scored.map((item) => {
    const product = byId.get(item.id);
    let total = 0;
    const matched: string[] = [];
    if (product) {
      for (const criterion of criteria) {
        const cell = readCell(product, criterion);
        const best = Math.max(0, ...active.filter((p) => p.rule.criterion === criterion).map((p) => degree(p.rule, cell, scales.get(criterion) ?? 0)));
        total += best;
        if (best > 0) matched.push(criterion);
      }
    }
    const bonus = criteria.length ? (amplitude * total) / criteria.length : 0;
    return { id: item.id, score: item.score, bonus, adjusted: item.score + bonus, matched };
  }).sort((a, b) => b.adjusted - a.adjusted || b.score - a.score || a.id.localeCompare(b.id));
  return { ranked, criteria, ignored, conflicts };
}

/**
 * Produits qui répondent EXACTEMENT à toutes les préférences souples actives (degré 1 partout). Sert de second appel au moteur
 * (productIds = ces produits) pour que des produits pertinents mais mal classés par le moteur entrent dans la fenêtre de
 * re-classement. Ne retire rien : la fenêtre principale reste entière.
 */
export function exactSoftMatches(products: readonly EffectProduct[], answers: readonly SelectedAnswer[]): string[] {
  const strictCriteria = new Set(strictRules(answers).map((e) => e.rule.criterion));
  const active = softRules(answers).filter((p) => !strictCriteria.has(p.rule.criterion));
  const criteria = [...new Set(active.map((p) => p.rule.criterion))];
  if (!criteria.length) return [];
  const scales = new Map(criteria.map((criterion) => [criterion, scaleOf(products, criterion)]));
  return products.filter((product) => criteria.every((criterion) => {
    const cell = readCell(product, criterion);
    return active.some((p) => p.rule.criterion === criterion && degree(p.rule, cell, scales.get(criterion) ?? 0) >= 1);
  })).map((p) => p.id).sort();
}

/** Y a-t-il au moins une préférence souple active (hors caractéristiques déjà contraintes) ? */
export function hasSoftPreferences(answers: readonly SelectedAnswer[]): boolean {
  const strictCriteria = new Set(strictRules(answers).map((e) => e.rule.criterion));
  return softRules(answers).some((p) => !strictCriteria.has(p.rule.criterion));
}

// ─── Degrés de correspondance par produit (lot 10D-2B.1) ──────────────────────

export interface SoftDegrees {
  /** Caractéristiques préférées (triées), hors celles déjà contraintes strictement. */
  criteria: string[];
  /** Préférences distinctes (une par règle, dédoublonnées), dans l'ordre des réponses. */
  rules: { criterion: string; key: string }[];
  /** Par produit : meilleur degré par caractéristique (même quantité que celle du bonus) et degré par règle. */
  byProduct: Map<string, { perCriterion: number[]; perRule: number[] }>;
}

/** Degrés de correspondance de chaque produit à chaque préférence souple. Pur ; ne retire aucun produit. */
export function softDegrees(products: readonly EffectProduct[], answers: readonly SelectedAnswer[]): SoftDegrees {
  const strictCriteria = new Set(strictRules(answers).map((e) => e.rule.criterion));
  const active = softRules(answers).filter((p) => !strictCriteria.has(p.rule.criterion));
  const unique = new Map<string, Rule>();
  for (const { rule } of active) unique.set(JSON.stringify(rule), rule);
  const rules = [...unique.entries()].map(([key, rule]) => ({ key, rule }));
  const criteria = [...new Set(rules.map((r) => r.rule.criterion))].sort();
  const scales = new Map(criteria.map((criterion) => [criterion, scaleOf(products, criterion)]));
  const byProduct = new Map<string, { perCriterion: number[]; perRule: number[] }>();
  for (const product of products) {
    const perRule = rules.map((r) => degree(r.rule, readCell(product, r.rule.criterion), scales.get(r.rule.criterion) ?? 0));
    const perCriterion = criteria.map((criterion) => Math.max(0, ...rules.flatMap((r, i) => (r.rule.criterion === criterion ? [perRule[i]] : []))));
    byProduct.set(product.id, { perCriterion, perRule });
  }
  return { criteria, rules: rules.map((r) => ({ criterion: r.rule.criterion, key: r.key })), byProduct };
}
