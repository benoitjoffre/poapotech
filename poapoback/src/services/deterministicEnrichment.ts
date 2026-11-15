import type { AxisEstimate, AxisEstimateConfidence, QuizAxis } from "@poapo/types";
import { sectorById } from "./expressSectors";

/**
 * Estimation déterministe (sans IA) des axes du secteur Parfum à partir du nom, des tags et de la description.
 * Fonction pure : aucune écriture, aucun appel réseau. Principes :
 *  - une absence de mention n'est JAMAIS une valeur (ni 0, ni 0,5) : le résultat est `insufficient_data` ;
 *  - des indices contradictoires (pôle haut ET bas) donnent aussi `insufficient_data` ;
 *  - une valeur déjà présente sur le produit n'est jamais reproposée ;
 *  - les valeurs proposées sont des niveaux (0,15 à 0,85), jamais 0 ou 1.
 */

type Pole = "high" | "low" | "mid";
type Strength = "strong" | "weak";

interface Rule {
  /** Mots entiers, sans accents, en minuscules ; un espace = un ou plusieurs blancs. */
  phrase: string;
  pole: Pole;
  strength: Strength;
}

const r = (pole: Pole, strength: Strength, ...phrases: string[]): Rule[] => phrases.map((phrase) => ({ phrase, pole, strength }));

/**
 * Règles par clé canonique du modèle Parfum (expressSectors.ts).
 * Les occasions et saisons (soirée, bureau, été…) sont volontairement exclues : ce ne sont pas des propriétés du parfum.
 */
const RULES: Record<string, Rule[]> = {
  freshness: [
    ...r("high", "strong", "frais", "fraiche", "fraiches", "fraicheur", "aerien", "aerienne", "aquatique", "aquatiques",
      "agrume", "agrumes", "citron", "bergamote", "pamplemousse", "marin", "marine", "tonique", "embruns"),
    ...r("high", "weak", "menthe", "the vert", "the blanc", "mineral", "minerale", "lin", "coton", "vif", "vive", "propre"),
    ...r("low", "strong", "chaud", "chaude", "chauds", "chaudes", "chaleureux", "chaleureuse", "ambre", "ambree", "epice", "epicee", "cannelle"),
    ...r("low", "weak", "oriental", "orientale", "enveloppant", "enveloppante", "cocooning", "reconfortant", "reconfortante"),
  ],
  intensity: [
    ...r("high", "strong", "intense", "intenses", "puissant", "puissante", "puissants", "sillage marque", "sillage puissant",
      "sillage important", "fort sillage", "grand sillage", "tres sillage"),
    ...r("low", "strong", "discret", "discrete", "discrets", "discretes", "leger", "legere", "legers", "legeres", "subtil", "subtile",
      "sillage discret", "sillage leger", "de pres"),
    ...r("low", "weak", "delicat", "delicate"),
    ...r("mid", "strong", "modere", "moderee", "moyen", "moyenne"),
  ],
  sweetness: [
    ...r("high", "strong", "gourmand", "gourmande", "gourmands", "gourmandes", "gourmandise", "vanille", "vanillee",
      "caramel", "praline", "sucre", "sucree", "sucres", "sucrees", "tonka", "chocolat"),
    ...r("high", "weak", "miel", "doux", "douce", "douceur"),
    ...r("low", "strong", "sec", "seche", "peu sucre", "peu sucree"),
    ...r("low", "weak", "amer", "amere"),
  ],
  woody: [
    ...r("high", "strong", "boise", "boisee", "boises", "boisees", "cedre", "santal", "vetiver"),
    ...r("high", "weak", "bois blond", "bois blonds", "bois precieux", "bois clair", "bois clairs", "bouleau", "patchouli", "oud", "mousse de chene"),
    ...r("low", "strong", "peu boise", "peu boisee"),
  ],
};

/**
 * Expressions contextuelles neutralisées avant l'application des règles : elles contiennent un mot-clé
 * qui n'a pas ici le sens recherché (« bois de figuier » n'est pas une note boisée, « ambre gris » n'est pas un accord ambré chaud).
 */
const NEUTRAL_PHRASES = ["bois de figuier", "bois de figue", "figuier", "ambre gris"];
/** Un mot-clé précédé d'une négation n'est pas une preuve : « sans vanille », « pas frais ». */
const NEGATIONS = new Set(["sans", "pas", "ni", "non", "aucun", "aucune", "moins"]);

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phraseRegex = (phrase: string) => new RegExp(`(?<![a-z0-9])${phrase.split(" ").map(escape).join("\\s+")}(?![a-z0-9])`, "g");

interface CompiledRule extends Rule { regex: RegExp }
const COMPILED: Record<string, CompiledRule[]> = Object.fromEntries(
  Object.entries(RULES).map(([key, rules]) => [key, rules.map((rule) => ({ ...rule, regex: phraseRegex(rule.phrase) }))]),
);
const NEUTRAL = NEUTRAL_PHRASES.map(phraseRegex);

/** Texte sans accents ni majuscules, avec la position d'origine de chaque caractère (pour citer le texte tel qu'écrit). */
function fold(text: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = text[i].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const char of f) { folded += char; origin.push(i); }
  }
  return { folded, origin };
}

type Source = "tag" | "name" | "description";
interface Segment { source: Source; text: string }

interface Hit { rule: Rule; source: Source; quote: string }

function findHits(segment: Segment, rules: CompiledRule[]): Hit[] {
  const { folded, origin } = fold(segment.text);
  const taken: boolean[] = new Array(folded.length).fill(false);
  const mark = (start: number, end: number) => { for (let i = start; i < end; i++) taken[i] = true; };
  const free = (start: number, end: number) => { for (let i = start; i < end; i++) if (taken[i]) return false; return true; };
  // 1. Expressions neutres : consommées pour qu'aucune règle ne s'y applique.
  for (const regex of NEUTRAL) for (const m of folded.matchAll(regex)) mark(m.index!, m.index! + m[0].length);
  // 2. Règles, expressions les plus longues d'abord (« sillage discret » avant « discret »).
  const hits: Hit[] = [];
  for (const rule of [...rules].sort((a, b) => b.phrase.length - a.phrase.length)) {
    for (const m of folded.matchAll(rule.regex)) {
      const start = m.index!, end = start + m[0].length;
      if (!free(start, end)) continue;
      const previous = folded.slice(0, start).trimEnd().split(/[^a-z0-9]+/).pop() ?? "";
      mark(start, end);
      if (NEGATIONS.has(previous)) continue; // négation : ni preuve pour, ni preuve contre
      let last = origin[end - 1] + 1;
      while (last < segment.text.length && /[̀-ͯ]/.test(segment.text[last])) last++; // accents combinants de fin de mot
      hits.push({ rule, source: segment.source, quote: segment.text.slice(origin[start], last) });
    }
  }
  return hits;
}

const NO_RULE = "Aucune règle automatique pour cet axe : à renseigner à la main ou avec l'estimation IA.";

function insufficient(axis: string, rationale: string, evidence: string[] = []): AxisEstimate {
  return { axis, status: "insufficient_data", value: null, confidence: null, rationale, evidence };
}

/** Clé canonique du modèle Parfum correspondant à l'axe (clé ou libellé, sans accents ni séparateurs), sinon null. */
export function canonicalPerfumeAxis(axis: Pick<QuizAxis, "key" | "label">): string | null {
  const foldKey = (value: string) => fold(value).folded.replace(/[^a-z0-9]/g, "");
  const keys = [foldKey(axis.key), foldKey(axis.label)];
  const template = sectorById("perfume")?.axes.find((candidate) => candidate.aliases.some((alias) => keys.includes(alias)));
  return template && template.key in RULES ? template.key : null;
}

export interface EnrichableProduct {
  name: string;
  tags: readonly string[];
  description: string | null;
  attributes: unknown;
}

function hasValue(attributes: unknown, key: string): boolean {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return false;
  const value = (attributes as Record<string, unknown>)[key];
  return value !== undefined && value !== null;
}

const distinct = (hits: Hit[]) => new Set(hits.map((hit) => hit.rule.phrase.replace(/\s+/g, " "))).size;

function estimateOne(axis: QuizAxis, product: EnrichableProduct, segments: Segment[]): AxisEstimate {
  if (hasValue(product.attributes, axis.key)) return insufficient(axis.key, "Valeur déjà renseignée : elle est conservée.");
  const canonical = canonicalPerfumeAxis(axis);
  if (!canonical) return insufficient(axis.key, NO_RULE);
  const rules = COMPILED[canonical];
  const hits = segments.flatMap((segment) => findHits(segment, rules));
  if (!hits.length) return insufficient(axis.key, "Aucune mention exploitable dans la fiche : l'absence d'indice n'est pas une valeur.");
  const quotes = [...new Set(hits.map((hit) => hit.quote))].slice(0, 3);
  const by = (pole: Pole) => hits.filter((hit) => hit.rule.pole === pole);
  const poles = (["high", "low", "mid"] as const).filter((pole) => by(pole).length);
  if (poles.length > 1) {
    return insufficient(axis.key, `Indices contradictoires (${quotes.map((q) => `« ${q} »`).join(", ")}) : à trancher à la main.`, quotes);
  }
  const pole = poles[0];
  const found = by(pole);
  const strong = found.filter((hit) => hit.rule.strength === "strong");
  const declared = strong.some((hit) => hit.source === "tag");
  let value: number;
  let confidence: AxisEstimateConfidence;
  if (!strong.length) { value = pole === "high" ? 0.65 : 0.35; confidence = "low"; }
  else if (pole === "mid") { value = 0.5; confidence = declared ? "high" : "medium"; }
  else {
    const many = distinct(strong) >= 2;
    value = pole === "high" ? (many ? 0.85 : 0.8) : (many ? 0.15 : 0.2);
    confidence = many || declared ? "high" : "medium";
  }
  const wording = pole === "high" ? axis.highLabel ?? "niveau élevé" : pole === "low" ? axis.lowLabel ?? "niveau faible" : "niveau intermédiaire";
  return { axis: axis.key, status: "estimated", value, confidence, rationale: `Fiche cohérente avec « ${wording} » : ${quotes.map((q) => `« ${q} »`).join(", ")}.`, evidence: quotes };
}

/** Une estimation par axe, dans l'ordre des axes. Les axes hors modèle Parfum ou déjà renseignés restent `insufficient_data`. */
export function estimateAxes(product: EnrichableProduct, axes: readonly QuizAxis[]): AxisEstimate[] {
  const segments: Segment[] = [
    ...product.tags.map((text) => ({ source: "tag" as const, text })),
    { source: "name" as const, text: product.name },
    { source: "description" as const, text: product.description ?? "" },
  ].filter((segment) => segment.text.trim());
  return axes.map((axis) => estimateOne(axis, product, segments));
}
