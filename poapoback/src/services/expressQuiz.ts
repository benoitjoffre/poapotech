import type {
  ExpressAnalysis,
  ExpressAxis,
  ExpressAxisCandidate,
  ExpressDraft,
  ExpressPreviewResponse,
  ExpressProposal,
  ExpressQuestion,
  ExpressQuestionCount,
  ExpressReliability,
  ExpressSector,
  ExpressValidation,
  QuizAxis,
} from "@poapo/types";
import { prisma } from "../lib/prisma";
import { AiServiceError, callAiService } from "./aiClient";
import { computeProfile } from "./scoring";
import { AXIS_KEY_PATTERN, AxisValidationError, invalidAxisValue, isAxisValue, validateAxes } from "./axes";
import { catalogAxes, resolveCatalog } from "./catalogs";
import { createQuestionsWithAnswers, MANUAL_IMPACT_LIMIT } from "./questions";
import { DISCRIMINANT_SPREAD, DRAFT_TEXT_LIMITS, GENERATION_LIMITS, MIN_AXIS_AMPLITUDE, PREVIEW_TIMEOUT_MS } from "./quizGeneration";
import { createQuiz, ensureDefaultQuiz, QuizError } from "./quizzes";
import { type AxisTemplate, type QuestionTemplate, type SectorTemplate, sectorById, SECTORS } from "./expressSectors";

/**
 * Création express : génère un brouillon d'expérience (critères, questions, réponses, impacts) à partir des données
 * réelles d'un catalogue. Génération 100 % déterministe ; aucune valeur produit n'est jamais écrite ni inventée.
 * Le moteur de recommandation (scoring 60 % sémantique / 40 % axes) n'est pas modifié : on ne produit que des axes et
 * des impacts compatibles avec lui (axes à clé stable, valeurs produit et profil dans [0, 1], départ du profil à 0,5).
 */

export const MAX_EXPRESS_AXES = 6;
export const QUESTION_COUNTS: readonly ExpressQuestionCount[] = [3, 5, 7];
/** Part minimale de produits renseignés pour qu'un critère compte comme une donnée du catalogue. */
export const MIN_COVERAGE = 0.5;
const ANSWER_IMPACT = 0.25;

// ─── Contexte (chargé en base, ou construit directement dans les tests) ───────

export interface ExpressProduct {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  tags: string[];
  attributes: unknown;
  /** Embedding prêt : le moteur peut départager ce produit par similarité sémantique. */
  embeddingReady: boolean;
}

export interface ExpressContext {
  catalogId: string;
  catalogName: string;
  catalogDescription: string | null;
  /** Activité libre de la boutique. */
  industry: string;
  products: ExpressProduct[];
  /** Axes déjà définis par les quiz de ce catalogue. */
  existingAxes: QuizAxis[];
}

export interface ExpressOptions {
  questionCount?: ExpressQuestionCount;
  /** Force un modèle sectoriel (« Partir d'un modèle ») ; "generic" désactive la détection. */
  sector?: ExpressSector;
  /** Clés de critères que le commerçant a retirées : ni elles ni leur équivalent sectoriel ne sont reproposés. */
  exclude?: string[];
}

/** Point d'extension : une génération IA ultérieure implémentera la même interface sans toucher aux routes. */
export interface DraftGenerator {
  readonly name: string;
  generate(context: ExpressContext, options: ExpressOptions): ExpressProposal;
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const foldKey = (value: string) => fold(value).replace(/[^a-z0-9]/g, "");
const round2 = (value: number) => Math.round(value * 100) / 100;

function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function signature(impacts: Record<string, number>): string {
  return JSON.stringify(Object.entries(impacts).filter(([, v]) => v !== 0).sort(([a], [b]) => a.localeCompare(b)));
}

// ─── 1. Analyse du catalogue ──────────────────────────────────────────────────

interface AttributeStat {
  key: string;
  values: Map<string, number>;
  /** Valeurs numériques hors de l'échelle 0–1 : inutilisables comme axe sans normalisation. */
  outOfScale: number;
  spread: number;
  binary: boolean;
}

function scanAttributes(products: ExpressProduct[]): Map<string, AttributeStat> {
  const stats = new Map<string, AttributeStat>();
  for (const product of products) {
    const attributes = product.attributes;
    if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) continue;
    for (const [key, value] of Object.entries(attributes as Record<string, unknown>)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const stat = stats.get(key) ?? { key, values: new Map(), outOfScale: 0, spread: 0, binary: true };
      if (isAxisValue(value)) stat.values.set(product.id, value);
      else stat.outOfScale++;
      stats.set(key, stat);
    }
  }
  for (const stat of stats.values()) {
    const values = [...stat.values.values()];
    stat.spread = values.length ? Math.max(...values) - Math.min(...values) : 0;
    stat.binary = values.length > 0 && values.every((value) => value === 0 || value === 1);
  }
  return stats;
}

function isDiscriminant(stat: AttributeStat | undefined, productCount: number): boolean {
  return !!stat && stat.values.size >= 2 && stat.values.size / productCount >= MIN_COVERAGE && stat.spread >= DISCRIMINANT_SPREAD - 1e-9;
}

function assessReliability(keys: Iterable<string>, stats: Map<string, AttributeStat>, products: ExpressProduct[]): { reliability: ExpressReliability; discriminantKeys: Set<string> } {
  const discriminantKeys = new Set([...keys].filter((key) => isDiscriminant(stats.get(key), products.length)));
  const semanticProducts = products.filter((product) => product.embeddingReady).length;
  const reliability: ExpressReliability = discriminantKeys.size >= 2 ? "reliable"
    : discriminantKeys.size === 1 || semanticProducts >= 2 ? "limited" : "insufficient";
  return { reliability, discriminantKeys };
}

function correlation(a: AttributeStat, b: AttributeStat): number | null {
  const shared = [...a.values.keys()].filter((id) => b.values.has(id));
  // Sous 5 produits communs, une corrélation ne prouve rien : on ne déclare pas de doublon.
  if (shared.length < 5) return null;
  const xs = shared.map((id) => a.values.get(id)!);
  const ys = shared.map((id) => b.values.get(id)!);
  const mean = (list: number[]) => list.reduce((sum, v) => sum + v, 0) / list.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

function matchCount(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/** Secteur détecté dans l'activité, le nom du catalogue puis les produits (nom, marque, tags, début de description). */
export function detectSector(context: ExpressContext): SectorTemplate | null {
  const head = fold([context.industry, context.catalogName, context.catalogDescription ?? ""].join(" "));
  const productTexts = context.products.map((product) => fold([product.name, product.brand ?? "", product.tags.join(" "), (product.description ?? "").slice(0, 300)].join(" ")));
  let best: { sector: SectorTemplate; score: number } | null = null;
  for (const sector of SECTORS) {
    const headScore = 3 * (matchCount(head, sector.keywords) + matchCount(head, new RegExp(`\\b${fold(sector.label)}\\b`, "g")));
    const matching = productTexts.filter((text) => matchCount(text, sector.keywords) > 0).length;
    const productScore = matching >= Math.max(2, Math.ceil(context.products.length * 0.3)) ? matching : 0;
    const score = headScore + productScore;
    if (score >= 3 && (!best || score > best.score)) best = { sector, score };
  }
  return best?.sector ?? null;
}

interface AxisPlan {
  key: string;
  label: string;
  description: string;
  lowLabel: string | null;
  highLabel: string | null;
  justification: string;
  evidence: "data" | "semantic";
  reused: boolean;
  /** Clé canonique du modèle sectoriel, pour remapper ses questions. */
  canonical: string | null;
  template: AxisTemplate | null;
  stat: AttributeStat | undefined;
}

function toExpressAxis(plan: AxisPlan): ExpressAxis {
  return {
    key: plan.key, label: plan.label, lowLabel: plan.lowLabel, highLabel: plan.highLabel,
    description: plan.description, justification: plan.justification, evidence: plan.evidence, reused: plan.reused,
    valuedProducts: plan.stat?.values.size ?? 0, spread: round2(plan.stat?.spread ?? 0),
  };
}

interface Analysis {
  sector: SectorTemplate | null;
  sectorDetected: boolean;
  stats: Map<string, AttributeStat>;
  selected: AxisPlan[];
  semanticPlans: AxisPlan[];
  candidates: ExpressAxisCandidate[];
  missingForSector: { key: string; label: string }[];
  messages: string[];
  reliability: ExpressReliability;
  semanticProducts: number;
}

/** Choisit les critères : d'abord ceux qui séparent réellement les produits, puis (si besoin) des critères sectoriels sans donnée. */
function analyse(context: ExpressContext, options: ExpressOptions): Analysis {
  const count = context.products.length;
  const stats = scanAttributes(context.products);
  const forced = options.sector ? (options.sector === "generic" ? null : sectorById(options.sector)) : undefined;
  const sector = forced !== undefined ? forced : detectSector(context);
  const existing = new Map(context.existingAxes.map((axis) => [axis.key, axis]));
  const existingByFolded = new Map(context.existingAxes.flatMap((axis) => [[foldKey(axis.key), axis], [foldKey(axis.label), axis]] as const));
  const excluded = new Set((options.exclude ?? []).map(foldKey));
  const messages: string[] = [];
  const semanticProducts = context.products.filter((product) => product.embeddingReady).length;

  const templateFor = (key: string): AxisTemplate | null => {
    const folded = foldKey(key);
    return sector?.axes.find((axis) => axis.aliases.includes(folded)) ?? null;
  };
  // Attribut produit correspondant à un critère de modèle (même nom ou alias).
  const statForTemplate = (template: AxisTemplate): AttributeStat | undefined =>
    [...stats.values()].filter((stat) => AXIS_KEY_PATTERN.test(stat.key) && template.aliases.includes(foldKey(stat.key)))
      .sort((a, b) => b.values.size - a.values.size)[0];

  const planFor = (stat: AttributeStat | undefined, template: AxisTemplate | null, key: string, evidence: "data" | "semantic"): AxisPlan => {
    const prior = existing.get(key) ?? existingByFolded.get(foldKey(key)) ?? (template ? existingByFolded.get(foldKey(template.label)) : undefined);
    const label = prior?.label ?? template?.label ?? humanize(key);
    const dataNote = stat ? `renseigné sur ${stat.values.size} produit(s) sur ${count}, écart ${round2(stat.spread)}` : "aucune valeur produit";
    const origin = prior ? "axe déjà défini pour ce catalogue" : template ? `critère typique du secteur ${sector!.label.toLowerCase()}` : "caractéristique numérique de vos produits";
    return {
      key,
      label,
      description: template?.description ?? `Position du produit sur « ${label} », de 0 (faible) à 1 (fort).`,
      lowLabel: prior?.lowLabel ?? template?.lowLabel ?? null,
      highLabel: prior?.highLabel ?? template?.highLabel ?? null,
      justification: evidence === "data"
        ? `${origin[0].toUpperCase()}${origin.slice(1)} ; ${dataNote} : il permet de départager les produits.`
        : `${origin[0].toUpperCase()}${origin.slice(1)} ; ${dataNote} : ne départage les produits que par leurs descriptions.`,
      evidence,
      reused: !!prior,
      canonical: template?.key ?? null,
      template,
      stat,
    };
  };

  // Candidats : tous les attributs numériques utilisables comme axe.
  const usable = [...stats.values()].filter((stat) => AXIS_KEY_PATTERN.test(stat.key));
  const unusableNames = [...stats.values()].filter((stat) => !AXIS_KEY_PATTERN.test(stat.key) && stat.values.size > 0).map((stat) => stat.key);
  const candidates: ExpressAxisCandidate[] = [];
  const eligible: AttributeStat[] = [];
  for (const stat of usable) {
    const template = templateFor(stat.key);
    if (excluded.has(foldKey(stat.key)) || (template && excluded.has(foldKey(template.key)))) continue;
    const known = !!template || existing.has(stat.key);
    const label = existing.get(stat.key)?.label ?? template?.label ?? humanize(stat.key);
    let note: string | null = null;
    let discriminant = isDiscriminant(stat, count);
    if (stat.values.size === 0) {
      if (!known) continue;
      note = "valeurs hors de l'échelle 0–1 : à normaliser dans le catalogue";
    } else if (stat.binary && !known) {
      note = "indicateur oui/non, pas un degré";
      discriminant = false;
    } else if (!discriminant) {
      note = stat.values.size < 2 || stat.values.size / count < MIN_COVERAGE
        ? `renseigné sur trop peu de produits (${stat.values.size}/${count})`
        : "valeurs trop proches : ne départage pas les produits";
    } else if (stat.outOfScale > 0 && known) note = `${stat.outOfScale} valeur(s) hors 0–1 ignorée(s)`;
    candidates.push({ key: stat.key, label, valuedProducts: stat.values.size, spread: round2(stat.spread), discriminant, used: false, note });
    if (discriminant) eligible.push(stat);
  }

  // Ordre de priorité : critères du modèle (dans l'ordre du modèle), puis axes existants, puis plus fort écart.
  const templateRank = (stat: AttributeStat) => {
    const template = templateFor(stat.key);
    return template ? sector!.axes.indexOf(template) : Number.POSITIVE_INFINITY;
  };
  eligible.sort((a, b) =>
    templateRank(a) - templateRank(b) ||
    Number(existing.has(b.key)) - Number(existing.has(a.key)) ||
    b.spread - a.spread || a.key.localeCompare(b.key));

  const selected: AxisPlan[] = [];
  const usedTemplates = new Set<AxisTemplate>();
  for (const stat of eligible) {
    const entry = candidates.find((candidate) => candidate.key === stat.key)!;
    const template = templateFor(stat.key);
    if (template && usedTemplates.has(template)) { entry.note = "doublon d'un critère déjà retenu"; entry.discriminant = false; continue; }
    if (selected.length >= MAX_EXPRESS_AXES) { entry.note = `au-delà de ${MAX_EXPRESS_AXES} critères : écarté pour garder un quiz court`; continue; }
    const twin = selected.find((plan) => plan.stat && (correlation(plan.stat, stat) ?? 0) >= 0.97);
    if (twin) { entry.note = `évolue comme « ${twin.label} » : doublon écarté`; entry.discriminant = false; continue; }
    if (template) usedTemplates.add(template);
    selected.push(planFor(stat, template, stat.key, "data"));
    entry.used = true;
  }

  // Critères du secteur sans donnée exploitable.
  const missing = (sector?.axes ?? []).filter((template) => !selected.some((plan) => plan.template === template) && !excluded.has(foldKey(template.key)));
  const missingForSector = missing.map((template) => ({ key: template.key, label: template.label }));

  // Fiabilité réelle, indépendante de ce qu'on affiche ensuite.
  const reliability = assessReliability(selected.map((plan) => plan.key), stats, context.products).reliability;

  const semanticPlans: AxisPlan[] = [];
  if (selected.length < 2 && sector) {
    for (const template of missing) {
      if (excluded.has(foldKey(template.key))) continue;
      if (selected.length + semanticPlans.length >= Math.min(4, sector.axes.length)) break;
      const stat = statForTemplate(template);
      const key = stat?.key ?? existingByFolded.get(foldKey(template.label))?.key ?? template.key;
      semanticPlans.push(planFor(stat, template, AXIS_KEY_PATTERN.test(key) ? key : template.key, "semantic"));
    }
  }

  if (count === 0) messages.push("Ce catalogue ne contient aucun produit actif : ajoutez des produits avant de créer une expérience.");
  else if (count < 3) messages.push(`Seulement ${count} produit(s) actif(s) : trop peu pour que les recommandations soient variées.`);
  if (unusableNames.length) messages.push(`Attributs ignorés (nom incompatible avec le moteur) : ${unusableNames.slice(0, 5).join(", ")}.`);
  const unscaled = [...stats.values()].filter((stat) => stat.values.size === 0 && AXIS_KEY_PATTERN.test(stat.key)).map((stat) => stat.key);
  if (unscaled.length) messages.push(`Attributs numériques hors de l'échelle 0–1, non utilisés comme critères : ${unscaled.slice(0, 5).join(", ")}.`);
  if (reliability === "reliable" && missingForSector.length) {
    messages.push(`Critères habituels du secteur non renseignés sur vos produits, donc non proposés : ${missingForSector.map((m) => m.label).join(", ")}.`);
  }
  if (reliability === "limited") {
    messages.push(selected.length === 1
      ? "Un seul critère sépare vos produits : les recommandations seront peu variées. Renseignez d'autres caractéristiques (page Enrichissement) pour les fiabiliser."
      : "Aucune caractéristique chiffrée ne sépare vos produits : les recommandations reposeront uniquement sur la similarité entre les réponses et les descriptions. Elles seront approximatives.");
  }
  if (reliability === "insufficient") {
    messages.push("Les données du catalogue ne permettent pas de différencier vos produits : renseignez leurs caractéristiques (page Enrichissement) ou complétez leurs descriptions avant de publier. Les recommandations ne seraient pas fiables.");
  }
  if (!selected.length && !semanticPlans.length) {
    messages.push("Aucun secteur reconnu et aucune caractéristique chiffrée exploitable : impossible de proposer des critères sans les inventer. Enrichissez le catalogue, choisissez un modèle ou utilisez la création manuelle.");
  }

  return { sector, sectorDetected: forced === undefined && !!sector, stats, selected, semanticPlans, candidates, missingForSector, messages, reliability, semanticProducts };
}

// ─── 2. Questions et réponses ─────────────────────────────────────────────────

function amplitude(questions: ExpressQuestion[], key: string): number {
  let total = 0;
  for (const question of questions) {
    const impacts = question.answers.map((answer) => answer.impacts[key] ?? 0);
    total += Math.max(0, ...impacts) - Math.min(0, ...impacts);
  }
  return total;
}

function touched(question: ExpressQuestion): Set<string> {
  return new Set(question.answers.flatMap((answer) => Object.keys(answer.impacts)));
}

function remapTemplate(template: QuestionTemplate, map: Map<string, string>, allowed: Set<string>): ExpressQuestion | null {
  const answers = template.answers.map((answer) => ({
    text: answer.text,
    emoji: answer.emoji,
    impacts: Object.fromEntries(Object.entries(answer.impacts).flatMap(([canonical, value]) => {
      const key = map.get(canonical);
      return key && allowed.has(key) ? [[key, value]] : [];
    })),
  })).filter((answer) => Object.keys(answer.impacts).length > 0);
  if (answers.length < 2 || new Set(answers.map((answer) => signature(answer.impacts))).size < 2) return null;
  return { text: template.text, helpText: null, answers };
}

/** Question de repli pour un critère sans question de modèle : deux réponses opposées. */
function axisQuestion(axis: Pick<QuizAxis, "key" | "label" | "lowLabel" | "highLabel">): ExpressQuestion {
  const label = lowerFirst(axis.label);
  return {
    text: `Côté ${label}, qu'est-ce qui vous correspond le mieux ?`,
    helpText: null,
    answers: [
      { text: axis.lowLabel || `Plutôt peu de ${label}`, emoji: null, impacts: { [axis.key]: -ANSWER_IMPACT } },
      { text: axis.highLabel || `Plutôt beaucoup de ${label}`, emoji: null, impacts: { [axis.key]: ANSWER_IMPACT } },
    ],
  };
}

interface QuestionSet {
  questions: ExpressQuestion[];
  alternatives: ExpressQuestion[];
  weak: AxisPlan[];
}

/** Sélection gloutonne : couvre d'abord les critères pas assez mesurés, puis complète avec les questions les moins redondantes. */
function selectQuestions(plans: AxisPlan[], sector: SectorTemplate | null, count: number): QuestionSet {
  const keys = new Set(plans.map((plan) => plan.key));
  const map = new Map(plans.flatMap((plan) => plan.canonical ? [[plan.canonical, plan.key] as const] : []));
  let pool = (sector?.questions ?? []).flatMap((template) => remapTemplate(template, map, keys) ?? []);
  const chosen: ExpressQuestion[] = [];
  const seenText = new Set<string>();
  const seenSignature = new Set<string>();
  const take = (question: ExpressQuestion) => {
    chosen.push(question);
    seenText.add(fold(question.text));
    seenSignature.add(question.answers.map((answer) => signature(answer.impacts)).join("|"));
    pool = pool.filter((item) => item !== question);
  };
  const redundant = (question: ExpressQuestion) =>
    seenText.has(fold(question.text)) || seenSignature.has(question.answers.map((answer) => signature(answer.impacts)).join("|"));

  const weakKeys = () => plans.filter((plan) => amplitude(chosen, plan.key) < MIN_AXIS_AMPLITUDE - 1e-9);
  while (chosen.length < count) {
    const weak = weakKeys();
    if (!weak.length) break;
    let best: { question: ExpressQuestion; score: number } | null = null;
    for (const question of pool) {
      if (redundant(question)) continue;
      const score = weak.reduce((sum, plan) => {
        const impacts = question.answers.map((answer) => answer.impacts[plan.key] ?? 0);
        const delta = Math.max(0, ...impacts) - Math.min(0, ...impacts);
        return sum + Math.min(delta, MIN_AXIS_AMPLITUDE - amplitude(chosen, plan.key));
      }, 0);
      if (score > (best?.score ?? 1e-9)) best = { question, score };
    }
    take(best?.question ?? axisQuestion(weak[0]));
  }
  while (chosen.length < count) {
    let best: { question: ExpressQuestion; score: number } | null = null;
    for (const question of pool) {
      if (redundant(question)) continue;
      const score = [...touched(question)].reduce((sum, key) => sum + 1 / (1 + chosen.filter((item) => touched(item).has(key)).length), 0);
      if (score > (best?.score ?? 0)) best = { question, score };
    }
    if (!best) break;
    take(best.question);
  }

  const alternatives = [...pool.filter((question) => !redundant(question)), ...plans.map(axisQuestion).filter((question) => !redundant(question))].slice(0, 8);
  return { questions: chosen, alternatives, weak: weakKeys() };
}

// ─── 3. Assemblage du brouillon ───────────────────────────────────────────────

export function defaultQuestionCount(axisCount: number): ExpressQuestionCount {
  return axisCount <= 3 ? 3 : axisCount === 4 ? 5 : 7;
}

function emptyAnalysis(context: ExpressContext, analysis: Analysis): ExpressAnalysis {
  return {
    catalogId: context.catalogId,
    catalogName: context.catalogName,
    productCount: context.products.length,
    semanticProducts: analysis.semanticProducts,
    sector: analysis.sector?.id ?? "generic",
    sectorLabel: analysis.sector?.label ?? "Générique",
    sectorDetected: analysis.sectorDetected,
    reliability: analysis.reliability,
    messages: analysis.messages,
    candidates: analysis.candidates,
    missingForSector: analysis.missingForSector,
  };
}

export const deterministicGenerator: DraftGenerator = {
  name: "deterministic",
  generate(context, options) {
    const analysis = analyse(context, options);
    let plans = [...analysis.selected, ...analysis.semanticPlans];
    const dropped: string[] = [];
    let set: QuestionSet = { questions: [], alternatives: [], weak: [] };
    const requested = options.questionCount && QUESTION_COUNTS.includes(options.questionCount) ? options.questionCount : null;
    const count = requested ?? defaultQuestionCount(plans.length);

    // Un critère que les questions ne peuvent pas mesurer est retiré (le moins prioritaire d'abord), jamais gardé sans effet.
    while (plans.length) {
      set = selectQuestions(plans, analysis.sector, count);
      if (!set.weak.length) break;
      const removed = set.weak[set.weak.length - 1];
      plans = plans.filter((plan) => plan !== removed);
      dropped.push(removed.label);
    }
    if (dropped.length) {
      analysis.messages.push(`Avec ${count} questions, ${dropped.join(", ")} ne peu${dropped.length > 1 ? "vent" : "t"} pas être mesuré${dropped.length > 1 ? "s" : ""} : ${dropped.length > 1 ? "ces critères sont retirés" : "ce critère est retiré"}. Choisissez plus de questions pour les conserver.`);
    }
    if (plans.length && set.questions.length < count) {
      analysis.messages.push(`Seulement ${set.questions.length} question(s) non redondantes disponibles pour ces critères (${count} demandées).`);
    }
    if (analysis.semanticPlans.length && plans.some((plan) => plan.evidence === "semantic")) {
      analysis.messages.push("Certains critères ne sont renseignés sur aucun produit : ils influencent la recommandation seulement via les descriptions. Renseignez-les pour obtenir un vrai classement.");
    }

    analysis.reliability = assessReliability(plans.filter((plan) => plan.evidence === "data").map((plan) => plan.key), analysis.stats, context.products).reliability;
    const result = emptyAnalysis(context, analysis);
    if (!plans.length) return { analysis: result, draft: null, alternatives: [] };
    const sectorName = analysis.sector?.label.toLowerCase();
    const draft: ExpressDraft = {
      name: `Expérience express – ${context.catalogName}`.slice(0, DRAFT_TEXT_LIMITS.name),
      quizTitle: analysis.sector?.quizTitle ?? (sectorName ? `Trouvez ${sectorName} idéal` : "Trouvez le produit qui vous correspond"),
      ctaText: "Découvrir ma sélection",
      industry: context.industry || analysis.sector?.label || "",
      axes: plans.map(toExpressAxis),
      questions: set.questions,
    };
    return { analysis: result, draft, alternatives: set.alternatives };
  },
};

export function proposeExpressQuiz(context: ExpressContext, options: ExpressOptions = {}, generator: DraftGenerator = deterministicGenerator): ExpressProposal {
  return generator.generate(context, options);
}

// ─── 4. Validation backend ────────────────────────────────────────────────────

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new QuizError(400, `${field} est requis`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new QuizError(400, `${field} dépasse ${max} caractères`);
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, field, max);
}

export interface ValidatedExpressDraft {
  draft: {
    name: string;
    quizTitle: string;
    ctaText: string;
    industry: string;
    axes: QuizAxis[];
    questions: { text: string; helpText: string | null; answers: { text: string; emoji: string | null; impacts: Record<string, number> }[] }[];
  };
  validation: ExpressValidation;
}

/**
 * Revalide entièrement un brouillon envoyé par le client, quel que soit son origine. Refuse tout brouillon structurellement
 * invalide (erreur 400) ; les limites dues aux données du catalogue deviennent une fiabilité et des avertissements.
 */
export function validateExpressDraft(raw: unknown, context: ExpressContext): ValidatedExpressDraft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new QuizError(400, "Brouillon invalide");
  const body = raw as Record<string, unknown>;
  const warnings: string[] = [];

  let axes: QuizAxis[];
  try {
    if (!Array.isArray(body.axes)) throw new AxisValidationError("axes doit être une liste");
    axes = validateAxes(body.axes.map((item) => item && typeof item === "object"
      ? { key: (item as QuizAxis).key, label: (item as QuizAxis).label, lowLabel: (item as QuizAxis).lowLabel, highLabel: (item as QuizAxis).highLabel }
      : item));
  } catch (err) {
    if (err instanceof AxisValidationError) throw new QuizError(400, err.message);
    throw err;
  }
  if (axes.length < 1 || axes.length > MAX_EXPRESS_AXES) throw new QuizError(400, `Entre 1 et ${MAX_EXPRESS_AXES} critères de recommandation sont attendus`);
  const axisKeys = new Set(axes.map((axis) => axis.key));
  const labels = new Set<string>();
  for (const axis of axes) {
    if (labels.has(fold(axis.label))) throw new QuizError(400, `Deux critères portent le même nom : ${axis.label}`);
    labels.add(fold(axis.label));
  }

  if (!Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > GENERATION_LIMITS.maxDraftQuestions) {
    throw new QuizError(400, `Le quiz doit contenir entre 1 et ${GENERATION_LIMITS.maxDraftQuestions} questions`);
  }
  const seenQuestions = new Set<string>();
  const seenSignatures = new Map<string, number>();
  const questions = body.questions.map((rawQuestion: unknown, qi) => {
    const label = `Question ${qi + 1}`;
    if (!rawQuestion || typeof rawQuestion !== "object") throw new QuizError(400, `${label} invalide`);
    const question = rawQuestion as Record<string, unknown>;
    const text = requiredText(question.text, label, DRAFT_TEXT_LIMITS.question);
    if (seenQuestions.has(fold(text))) throw new QuizError(400, `${label} : question en double`);
    seenQuestions.add(fold(text));
    const answers = question.answers;
    if (!Array.isArray(answers) || answers.length < GENERATION_LIMITS.minAnswers || answers.length > GENERATION_LIMITS.maxAnswers) {
      throw new QuizError(400, `${label} : ${GENERATION_LIMITS.minAnswers} à ${GENERATION_LIMITS.maxAnswers} réponses attendues`);
    }
    const seen = new Set<string>();
    const parsed = answers.map((rawAnswer: unknown, ai) => {
      const where = `${label}, réponse ${ai + 1}`;
      if (!rawAnswer || typeof rawAnswer !== "object") throw new QuizError(400, `${where} invalide`);
      const answer = rawAnswer as Record<string, unknown>;
      const answerText = requiredText(answer.text, where, DRAFT_TEXT_LIMITS.answer);
      if (seen.has(fold(answerText))) throw new QuizError(400, `${label} : réponses en double`);
      seen.add(fold(answerText));
      const rawImpacts = answer.impacts ?? {};
      if (typeof rawImpacts !== "object" || Array.isArray(rawImpacts)) throw new QuizError(400, `${where} : impacts invalides`);
      const impacts: Record<string, number> = {};
      for (const [key, value] of Object.entries(rawImpacts as Record<string, unknown>)) {
        if (!axisKeys.has(key)) throw new QuizError(400, `${where} : référence à un critère inexistant (${key})`);
        if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MANUAL_IMPACT_LIMIT) {
          throw new QuizError(400, `${where} : l'impact sur ${key} doit être un nombre entre -${MANUAL_IMPACT_LIMIT} et ${MANUAL_IMPACT_LIMIT}`);
        }
        if (value !== 0) impacts[key] = value;
      }
      return { text: answerText, emoji: optionalText(answer.emoji, `${where} (emoji)`, DRAFT_TEXT_LIMITS.emoji), impacts };
    });
    if (new Set(parsed.map((answer) => signature(answer.impacts))).size < 2) {
      throw new QuizError(400, `${label} : les réponses n'ont aucun effet distinct sur les critères, la question ne change pas la recommandation`);
    }
    const empty = parsed.filter((answer) => !Object.keys(answer.impacts).length).length;
    if (empty) warnings.push(`${label} : ${empty} réponse(s) sans effet sur les critères.`);
    const sig = parsed.map((answer) => signature(answer.impacts)).sort().join("|");
    if (seenSignatures.has(sig)) warnings.push(`${label} produit les mêmes effets que la question ${seenSignatures.get(sig)! + 1} : elle est probablement redondante.`);
    else seenSignatures.set(sig, qi);
    return { text, helpText: optionalText(question.helpText, `${label} (aide)`, DRAFT_TEXT_LIMITS.helpText), answers: parsed };
  });

  for (const axis of axes) {
    const total = amplitude(questions, axis.key);
    if (total === 0) throw new QuizError(400, `Le critère « ${axis.label} » n'est influencé par aucune réponse : supprimez-le ou ajoutez une question.`);
    if (total < MIN_AXIS_AMPLITUDE - 1e-9) {
      throw new QuizError(400, `Le critère « ${axis.label} » est trop peu influencé par les réponses (amplitude ${round2(total)}, minimum ${MIN_AXIS_AMPLITUDE}) : il ne changerait pas la recommandation.`);
    }
    const values = questions.flatMap((question) => question.answers.map((answer) => answer.impacts[axis.key] ?? 0));
    if (!values.some((value) => value > 0) || !values.some((value) => value < 0)) {
      warnings.push(`Le critère « ${axis.label} » ne peut être poussé que dans une direction.`);
    }
  }

  // Cohérence avec les produits du catalogue.
  const stats = scanAttributes(context.products);
  for (const product of context.products) {
    const bad = product.attributes && typeof product.attributes === "object" && !Array.isArray(product.attributes)
      ? invalidAxisValue(product.attributes as Record<string, unknown>, axisKeys)
      : null;
    if (bad) throw new QuizError(400, `Le produit « ${product.name} » a une valeur hors de l'échelle 0–1 pour « ${bad} » : corrigez le catalogue avant d'utiliser ce critère.`);
  }
  const { reliability, discriminantKeys } = assessReliability(axisKeys, stats, context.products);
  for (const axis of axes) {
    if (!discriminantKeys.has(axis.key)) warnings.push(`« ${axis.label} » ne distingue pas vos produits (valeurs absentes ou trop proches) : il n'agit que via les descriptions.`);
  }
  questions.forEach((question, qi) => {
    const keys = [...touched(question)];
    if (keys.length && !keys.some((key) => discriminantKeys.has(key))) {
      warnings.push(`Question ${qi + 1} : elle n'agit que sur des critères qui ne distinguent pas vos produits.`);
    }
  });

  if (reliability !== "reliable") warnings.push(reliability === "limited"
    ? "Les données du catalogue ne séparent que partiellement vos produits : recommandations approximatives."
    : "Les données du catalogue ne permettent pas de départager vos produits : recommandations non fiables.");

  return {
    draft: {
      name: requiredText(body.name, "Le nom de l'expérience", DRAFT_TEXT_LIMITS.name),
      quizTitle: requiredText(body.quizTitle, "Le titre du quiz", DRAFT_TEXT_LIMITS.quizTitle),
      ctaText: requiredText(body.ctaText, "Le texte du bouton", DRAFT_TEXT_LIMITS.ctaText),
      industry: optionalText(body.industry, "L'activité", 80) ?? "",
      axes,
      questions,
    },
    validation: { reliability, warnings },
  };
}

// ─── 5. Accès base (toujours scopé au tenant) ─────────────────────────────────

export async function loadExpressContext(tenantId: string, catalogId: unknown): Promise<ExpressContext> {
  if (typeof catalogId !== "string" || !catalogId) throw new QuizError(400, "catalogId est requis");
  const catalog = await resolveCatalog(tenantId, catalogId);
  const [tenant, products, existingAxes] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { industry: true } }),
    prisma.product.findMany({
      where: { tenantId, catalogId: catalog.id, active: true },
      select: { id: true, name: true, brand: true, description: true, tags: true, attributes: true, embeddingStatus: true },
      orderBy: [{ featured: "desc" }, { name: "asc" }],
      take: 2000,
    }),
    catalogAxes(tenantId, catalog.id),
  ]);
  return {
    catalogId: catalog.id,
    catalogName: catalog.name,
    catalogDescription: catalog.description,
    industry: tenant?.industry?.trim() ?? "",
    products: products.map(({ embeddingStatus, ...product }) => ({ ...product, embeddingReady: embeddingStatus === "READY" })),
    existingAxes,
  };
}

export function parseExpressOptions(raw: unknown): ExpressOptions {
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const options: ExpressOptions = {};
  if (body.questionCount !== undefined) {
    if (!QUESTION_COUNTS.includes(body.questionCount as ExpressQuestionCount)) throw new QuizError(400, "questionCount doit valoir 3, 5 ou 7");
    options.questionCount = body.questionCount as ExpressQuestionCount;
  }
  if (body.sector !== undefined) {
    if (body.sector !== "generic" && !sectorById(body.sector)) throw new QuizError(400, "Modèle sectoriel inconnu");
    options.sector = body.sector as ExpressSector;
  }
  if (body.exclude !== undefined) {
    if (!Array.isArray(body.exclude) || body.exclude.length > 12 || body.exclude.some((key) => typeof key !== "string" || key.length > 40)) {
      throw new QuizError(400, "exclude doit être une liste de clés de critères");
    }
    options.exclude = body.exclude as string[];
  }
  return options;
}

/** Enregistre le brouillon comme nouvelle expérience INACTIVE (jamais publiée). */
export async function saveExpressDraft(tenantId: string, body: Record<string, unknown>) {
  const context = await loadExpressContext(tenantId, body.catalogId);
  const { draft, validation } = validateExpressDraft(body.draft, context);
  if (validation.reliability !== "reliable" && body.acknowledgeLimits !== true) {
    throw new QuizError(409, "Les données du catalogue ne permettent pas des recommandations pleinement fiables : confirmez que vous enregistrez ce brouillon en connaissance de cause.");
  }
  await ensureDefaultQuiz(tenantId);
  const result = await prisma.$transaction(async (tx) => {
    const quiz = await createQuiz(tenantId, {
      name: draft.name, catalogId: context.catalogId, industry: draft.industry, axes: draft.axes,
      quizTitle: draft.quizTitle, ctaText: draft.ctaText, active: false, useAllProducts: true, productIds: [],
    }, tx);
    const counts = await createQuestionsWithAnswers(tx, { tenantId, quizId: quiz.id, startOrder: 0 }, draft.questions.map((question) => ({
      text: question.text, helpText: question.helpText, type: "single" as const,
      answers: question.answers.map((answer) => ({ text: answer.text, emoji: answer.emoji, impacts: answer.impacts })),
    })));
    return { quiz, counts };
  });
  return {
    quizId: result.quiz.id, quizName: result.quiz.name,
    questionCount: result.counts.createdQuestions, answerCount: result.counts.createdAnswers,
    ...validation,
  };
}

/** Recommandation réelle (moteur existant, sans écriture) pour des réponses choisies dans le brouillon. */
export async function previewExpressDraft(tenantId: string, body: Record<string, unknown>): Promise<ExpressPreviewResponse> {
  const context = await loadExpressContext(tenantId, body.catalogId);
  const { draft, validation } = validateExpressDraft(body.draft, context);
  const choices = body.answers;
  if (!Array.isArray(choices) || choices.length !== draft.questions.length ||
      choices.some((choice, index) => !Number.isInteger(choice) || choice < 0 || choice >= draft.questions[index].answers.length)) {
    throw new QuizError(400, "Choisissez une réponse pour chaque question");
  }
  if (!context.products.length) throw new QuizError(422, "Ce catalogue ne contient aucun produit actif");
  const profile = computeProfile(draft.axes, choices.map((choice: number, index) => draft.questions[index].answers[choice].impacts));
  let result: { productId: string; profileSummary: ExpressPreviewResponse["profileSummary"]; topN?: { id: string; score: number }[] };
  try {
    result = await callAiService("/recommend", {
      tenantId, catalogId: context.catalogId, profile, industry: draft.industry, axes: draft.axes,
      productIds: context.products.map((product) => product.id), topN: 3,
    }, PREVIEW_TIMEOUT_MS);
  } catch (err) {
    if (!(err instanceof AiServiceError)) throw err;
    throw new QuizError(err.kind === "timeout" ? 504 : err.kind === "invalid_output" ? 502 : 503,
      "Le moteur de recommandation est momentanément indisponible. Réessayez dans un instant.");
  }
  const byId = new Map(context.products.map((product) => [product.id, product]));
  const ranked = result.topN?.length ? result.topN : [{ id: result.productId, score: 0 }];
  if (ranked.some((item) => !byId.has(item.id))) throw new QuizError(502, "La recommandation renvoyée ne fait pas partie de ce catalogue");
  const images = await prisma.product.findMany({
    where: { tenantId, catalogId: context.catalogId, id: { in: ranked.map((item) => item.id) } },
    select: { id: true, imageUrl: true, price: true },
  });
  const extra = new Map(images.map((row) => [row.id, row]));
  return {
    reliability: validation.reliability,
    profileSummary: result.profileSummary,
    recommendations: ranked.map((item) => {
      const product = byId.get(item.id)!;
      return { product: { id: product.id, name: product.name, brand: product.brand, imageUrl: extra.get(item.id)?.imageUrl ?? null, price: extra.get(item.id)?.price ?? null }, score: item.score };
    }),
  };
}
