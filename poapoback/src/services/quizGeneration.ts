import { Prisma } from "@prisma/client";
import type {
  CampaignOccasion,
  QuizAxis,
  QuizDraft,
  QuizDraftQuestion,
  QuizGenerationLimits,
  QuizGenerationMode,
  QuizGenerationObjective,
  QuizGenerationProduct,
} from "@poapo/types";
import { prisma } from "../lib/prisma";
import { isAxisValue, parseAxes } from "./axes";
import { CAMPAIGN_LIMITS, CAMPAIGN_OCCASIONS } from "./campaigns";
import { MANUAL_IMPACT_LIMIT } from "./questions";
import { QuizError } from "./quizzes";

export const GENERATION_LIMITS = {
  minProducts: 2,
  maxProducts: 40,
  minQuestions: 3,
  maxQuestions: 6,
  maxDraftQuestions: 10,
  minAnswers: 2,
  maxAnswers: 6,
  instructions: 1000,
  generationImpact: 0.15,
  manualImpact: MANUAL_IMPACT_LIMIT,
} as const satisfies QuizGenerationLimits;

export const DRAFT_TEXT_LIMITS = { name: 120, quizTitle: 120, ctaText: 60, question: 300, helpText: 300, answer: 150, emoji: 16 } as const;

/** Écart minimal entre produits sur un axe pour qu'il serve à les départager. */
export const DISCRIMINANT_SPREAD = 0.2;
/** Amplitude cumulée en dessous de laquelle un axe bouge trop peu pour changer la recommandation. */
export const MIN_AXIS_AMPLITUDE = 0.3;
export const GENERATION_TIMEOUT_MS = 35_000;
export const PREVIEW_TIMEOUT_MS = 10_000;
export const MAX_GENERATION_ATTEMPTS = 2;
const CONTEXT_PRODUCT_LIMIT = 500;

export const GENERATION_OBJECTIVES: Record<QuizGenerationObjective, string> = {
  GIFT_FINDER: "Aider à trouver un cadeau adapté à la personne qui le recevra",
  PRODUCT_DISCOVERY: "Faire découvrir le produit le plus adapté aux goûts du client",
  CROSS_SELL: "Orienter vers un produit complémentaire de ses habitudes",
  HIGHLIGHT_NEW: "Mettre en avant les nouveautés de la sélection",
  CLEAR_STOCK: "Valoriser les produits de la sélection à écouler en priorité",
};

const OCCASION_LABELS: Record<CampaignOccasion, string> = {
  CHRISTMAS: "Noël",
  VALENTINES_DAY: "Saint-Valentin",
  SPRING: "Printemps",
  MOTHERS_DAY: "Fête des mères",
  BACK_TO_SCHOOL: "Rentrée",
  BLACK_FRIDAY: "Black Friday",
  PROMOTION: "Promotion",
  PERMANENT: "Toute l'année",
  CUSTOM: "Événement personnalisé",
};

// ─── Chargement tenant-scopé ──────────────────────────────────────────────────

const scopeSelect = {
  id: true,
  tenantId: true,
  name: true,
  status: true,
  startsAt: true,
  endsAt: true,
  occasion: true,
  occasionLabel: true,
  quiz: { select: { id: true, name: true, industry: true, axes: true, catalogId: true, catalog: { select: { id: true, name: true } } } },
  tenant: { select: { industry: true } },
} satisfies Prisma.CampaignSelect;

export type GenerationCampaign = Prisma.CampaignGetPayload<{ select: typeof scopeSelect }>;

export interface GenerationScope {
  campaign: GenerationCampaign;
  /** Catalogue du quiz de la campagne : seul périmètre de produits autorisé pour la génération. */
  catalogId: string;
  axes: QuizAxis[];
  industry: string;
}

export async function loadGenerationScope(tenantId: string, campaignId: unknown): Promise<GenerationScope> {
  if (typeof campaignId !== "string" || !campaignId) throw new QuizError(404, "Campagne introuvable");
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId }, select: scopeSelect });
  if (!campaign) throw new QuizError(404, "Campagne introuvable");
  return {
    campaign,
    catalogId: campaign.quiz.catalogId,
    axes: parseAxes(campaign.quiz.axes),
    industry: campaign.quiz.industry.trim() || campaign.tenant.industry.trim(),
  };
}

const productSelect = {
  id: true,
  name: true,
  brand: true,
  description: true,
  tags: true,
  price: true,
  imageUrl: true,
  attributes: true,
} satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;
export type GenerationProductRow = ProductRow & { hasEmbedding: boolean };

async function idsWithEmbedding(tenantId: string, catalogId: string, ids?: string[]) {
  const rows = await prisma.product.findMany({
    where: { tenantId, catalogId, active: true, ...(ids && { id: { in: ids } }), embedding: { not: Prisma.AnyNull } },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/** Produits actifs du catalogue demandés ; refuse tout identifiant étranger, inconnu, inactif ou d'un autre catalogue. */
export async function loadSelectedProducts(
  tenantId: string,
  catalogId: string,
  productIds: string[],
): Promise<GenerationProductRow[]> {
  const rows = await prisma.product.findMany({
    where: { tenantId, catalogId, active: true, id: { in: productIds } },
    select: productSelect,
  });
  if (rows.length !== productIds.length) {
    throw new QuizError(400, "Certains produits sont inactifs ou n'appartiennent pas au catalogue du quiz de cette campagne");
  }
  const embedded = await idsWithEmbedding(tenantId, catalogId, productIds);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return productIds.map((id) => ({ ...byId.get(id)!, hasEmbedding: embedded.has(id) }));
}

export async function listContextProducts(
  tenantId: string,
  catalogId: string,
  axes: QuizAxis[],
): Promise<QuizGenerationProduct[]> {
  const [rows, embedded] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId, catalogId, active: true },
      select: productSelect,
      orderBy: [{ featured: "desc" }, { name: "asc" }],
      take: CONTEXT_PRODUCT_LIMIT,
    }),
    idsWithEmbedding(tenantId, catalogId),
  ]);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand,
    imageUrl: row.imageUrl,
    price: row.price,
    hasEmbedding: embedded.has(row.id),
    axisValues: axisValuesOf(row.attributes, axes),
  }));
}

export function axisValuesOf(attributes: unknown, axes: QuizAxis[]): Record<string, number> {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return {};
  const values: Record<string, number> = {};
  for (const axis of axes) {
    const value = (attributes as Record<string, unknown>)[axis.key];
    if (isAxisValue(value)) values[axis.key] = value;
  }
  return values;
}

// ─── Requête de génération ────────────────────────────────────────────────────

export interface GenerationInput {
  occasion: CampaignOccasion;
  occasionLabel: string | null;
  objective: QuizGenerationObjective;
  productIds: string[];
  axisKeys: string[];
  instructions: string;
  questionCount: number;
}

function optionalTrimmed(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new QuizError(400, `Le champ ${field} doit être un texte`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new QuizError(400, `Le champ ${field} dépasse ${max} caractères`);
  return trimmed || null;
}

function parseIdList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id.trim())) {
    throw new QuizError(400, `${field} doit être une liste d'identifiants`);
  }
  const ids = value.map((id: string) => id.trim());
  if (new Set(ids).size !== ids.length) throw new QuizError(400, `${field} contient des doublons`);
  return ids;
}

function parseProductIds(value: unknown): string[] {
  const ids = parseIdList(value, "productIds");
  if (ids.length < GENERATION_LIMITS.minProducts || ids.length > GENERATION_LIMITS.maxProducts) {
    throw new QuizError(400, `Sélectionnez entre ${GENERATION_LIMITS.minProducts} et ${GENERATION_LIMITS.maxProducts} produits`);
  }
  return ids;
}

/** Axes demandés : sous-ensemble non vide des axes du quiz de la campagne, jamais de nouvelle clé. */
function parseAxisKeys(value: unknown, available: QuizAxis[]): string[] {
  const keys = parseIdList(value, "axisKeys");
  const known = new Set(available.map((axis) => axis.key));
  const unknown = keys.filter((key) => !known.has(key));
  if (unknown.length) throw new QuizError(400, `Axes absents du quiz de la campagne : ${unknown.join(", ")}`);
  if (!keys.length) throw new QuizError(400, "Sélectionnez au moins un axe");
  return keys;
}

export function parseGenerationInput(raw: unknown, scope: GenerationScope): GenerationInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new QuizError(400, "Paramètres de génération invalides");
  const body = raw as Record<string, unknown>;

  if (!scope.axes.length) {
    throw new QuizError(422, "Le quiz de la campagne ne définit aucun axe de recommandation : ajoutez des axes depuis sa fiche avant de générer un quiz");
  }

  const occasion = body.occasion === undefined ? scope.campaign.occasion : body.occasion;
  if (!CAMPAIGN_OCCASIONS.includes(occasion as CampaignOccasion)) throw new QuizError(400, "Occasion invalide");
  const occasionLabel = body.occasionLabel === undefined
    ? scope.campaign.occasionLabel
    : optionalTrimmed(body.occasionLabel, "occasionLabel", CAMPAIGN_LIMITS.occasionLabel);
  if (occasion === "CUSTOM" && !occasionLabel) throw new QuizError(400, "Précisez le nom de l'événement personnalisé");

  if (typeof body.objective !== "string" || !(body.objective in GENERATION_OBJECTIVES)) {
    throw new QuizError(400, "Objectif marketing invalide");
  }

  const questionCount = body.questionCount === undefined ? 5 : body.questionCount;
  if (!Number.isInteger(questionCount) || (questionCount as number) < GENERATION_LIMITS.minQuestions || (questionCount as number) > GENERATION_LIMITS.maxQuestions) {
    throw new QuizError(400, `Le nombre de questions doit être compris entre ${GENERATION_LIMITS.minQuestions} et ${GENERATION_LIMITS.maxQuestions}`);
  }

  return {
    occasion: occasion as CampaignOccasion,
    occasionLabel: occasion === "CUSTOM" ? occasionLabel : null,
    objective: body.objective as QuizGenerationObjective,
    productIds: parseProductIds(body.productIds),
    axisKeys: body.axisKeys === undefined ? scope.axes.map((axis) => axis.key) : parseAxisKeys(body.axisKeys, scope.axes),
    instructions: optionalTrimmed(body.instructions, "instructions", GENERATION_LIMITS.instructions) ?? "",
    questionCount: questionCount as number,
  };
}

// ─── Plan : axes, mode et avertissements ──────────────────────────────────────

export interface AxisStats {
  key: string;
  valued: number;
  spread: number;
  discriminant: boolean;
}

export function axisStats(axes: QuizAxis[], products: { attributes: unknown }[]): AxisStats[] {
  return axes.map((axis) => {
    const values = products.map((product) => axisValuesOf(product.attributes, [axis])[axis.key]).filter((v) => v !== undefined);
    const spread = values.length ? Math.max(...values) - Math.min(...values) : 0;
    return { key: axis.key, valued: values.length, spread, discriminant: values.length >= 2 && spread >= DISCRIMINANT_SPREAD - 1e-9 };
  });
}

export interface GenerationPlan {
  mode: QuizGenerationMode;
  axes: QuizAxis[];
  products: GenerationProductRow[];
  warnings: string[];
}

/**
 * Mode AXES si au moins un axe sépare les produits. Sinon repli sémantique : le moteur compare l'embedding
 * du texte de profil (dérivé des axes) aux embeddings produits, ce qui n'est possible que si des produits en ont.
 */
export function planGeneration(scope: GenerationScope, input: GenerationInput, products: GenerationProductRow[]): GenerationPlan {
  const axes = scope.axes.filter((axis) => input.axisKeys.includes(axis.key));
  const stats = axisStats(axes, products);
  const embedded = products.filter((product) => product.hasEmbedding).length;
  const warnings: string[] = [];
  let mode: QuizGenerationMode;

  if (stats.some((stat) => stat.discriminant)) {
    mode = "AXES";
    const flat = stats.filter((stat) => !stat.discriminant).map((stat) => axes.find((axis) => axis.key === stat.key)!.label);
    if (flat.length) warnings.push(`Axes peu différenciés entre les produits choisis : ${flat.join(", ")}.`);
    const unvalued = products.filter((product) => !Object.keys(axisValuesOf(product.attributes, axes)).length).length;
    if (unvalued) warnings.push(`${unvalued} produit(s) n'ont aucune valeur sur les axes retenus et seront départagés uniquement par leur description.`);
  } else if (embedded > 0) {
    mode = "SEMANTIC";
    warnings.push("Aucun axe ne distingue nettement les produits choisis : la recommandation reposera sur la similarité sémantique entre le profil et les descriptions produits.");
  } else {
    throw new QuizError(
      422,
      "Le moteur ne peut pas départager ces produits : renseignez leurs valeurs sur les axes du quiz (écart d'au moins 0,2) ou enregistrez-les depuis le catalogue pour calculer leurs embeddings.",
    );
  }

  const missingEmbeddings = products.length - embedded;
  if (missingEmbeddings) {
    warnings.push(`${missingEmbeddings} produit(s) sans embedding sont désavantagés par le moteur : ré-enregistrez-les depuis le catalogue.`);
  }
  return { mode, axes, products, warnings };
}

export function buildAiRequest(scope: GenerationScope, input: GenerationInput, plan: GenerationPlan, feedback: string[]) {
  return {
    industry: scope.industry.slice(0, 80),
    occasion: input.occasion === "CUSTOM" && input.occasionLabel ? input.occasionLabel : OCCASION_LABELS[input.occasion],
    objective: GENERATION_OBJECTIVES[input.objective],
    instructions: input.instructions,
    mode: plan.mode,
    questionCount: input.questionCount,
    axes: plan.axes.map((axis) => ({ key: axis.key, label: axis.label, lowLabel: axis.lowLabel ?? null, highLabel: axis.highLabel ?? null })),
    // Références locales : aucun identifiant réel n'est transmis au modèle.
    products: plan.products.map((product, index) => ({
      ref: `p${index + 1}`,
      name: product.name.slice(0, 200),
      brand: product.brand?.slice(0, 120) ?? null,
      description: product.description?.slice(0, 300) ?? null,
      tags: product.tags.slice(0, 10).map((tag) => tag.slice(0, 40)),
      price: product.price,
      axisValues: axisValuesOf(product.attributes, plan.axes),
    })),
    feedback,
  };
}

// ─── Normalisation de la sortie IA ────────────────────────────────────────────

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export interface NormalizedGeneration {
  draft: QuizDraft;
  errors: string[];
  warnings: string[];
}

/** Valide la sortie IA sur des règles fixes ; les erreurs déclenchent une seule relance avec ces messages. */
export function normalizeGeneratedQuiz(raw: unknown, plan: GenerationPlan, input: Pick<GenerationInput, "axisKeys">): NormalizedGeneration {
  const errors: string[] = [];
  const warnings: string[] = [];
  const quiz = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const axisKeys = new Set(plan.axes.map((axis) => axis.key));
  const refToId = new Map(plan.products.map((product, index) => [`p${index + 1}`, product]));
  const limit = GENERATION_LIMITS.generationImpact;

  const rawQuestions = list(quiz.questions);
  if (rawQuestions.length < GENERATION_LIMITS.minQuestions || rawQuestions.length > GENERATION_LIMITS.maxQuestions) {
    errors.push(`Le quiz doit contenir entre ${GENERATION_LIMITS.minQuestions} et ${GENERATION_LIMITS.maxQuestions} questions (reçu : ${rawQuestions.length}).`);
  }

  const questions: QuizDraftQuestion[] = rawQuestions.map((rawQuestion, qi) => {
    const question = rawQuestion && typeof rawQuestion === "object" ? rawQuestion as Record<string, unknown> : {};
    const label = `Question ${qi + 1}`;
    const questionText = text(question.text, DRAFT_TEXT_LIMITS.question);
    if (!questionText) errors.push(`${label} : texte manquant.`);
    const rawAnswers = list(question.answers);
    if (rawAnswers.length < GENERATION_LIMITS.minAnswers || rawAnswers.length > GENERATION_LIMITS.maxAnswers) {
      errors.push(`${label} : ${GENERATION_LIMITS.minAnswers} à ${GENERATION_LIMITS.maxAnswers} réponses attendues (reçu : ${rawAnswers.length}).`);
    }
    const seen = new Set<string>();
    const answers = rawAnswers.map((rawAnswer, ai) => {
      const answer = rawAnswer && typeof rawAnswer === "object" ? rawAnswer as Record<string, unknown> : {};
      const answerLabel = `${label}, réponse ${ai + 1}`;
      const answerText = text(answer.text, DRAFT_TEXT_LIMITS.answer);
      if (!answerText) errors.push(`${answerLabel} : texte manquant.`);
      else if (seen.has(answerText.toLowerCase())) errors.push(`${label} : réponses en double (« ${answerText} »).`);
      seen.add(answerText.toLowerCase());

      const impacts: Record<string, number> = {};
      for (const rawImpact of list(answer.impacts)) {
        const impact = rawImpact && typeof rawImpact === "object" ? rawImpact as Record<string, unknown> : {};
        if (typeof impact.axis !== "string" || !axisKeys.has(impact.axis)) {
          errors.push(`${answerLabel} : axe non autorisé (${String(impact.axis)}).`);
          continue;
        }
        if (typeof impact.value !== "number" || !Number.isFinite(impact.value)) {
          errors.push(`${answerLabel} : impact non numérique sur ${impact.axis}.`);
          continue;
        }
        impacts[impact.axis] = (impacts[impact.axis] ?? 0) + impact.value;
      }
      for (const key of Object.keys(impacts)) {
        impacts[key] = round2(Math.max(-limit, Math.min(limit, impacts[key])));
        if (impacts[key] === 0) delete impacts[key];
      }
      if (!Object.keys(impacts).length) errors.push(`${answerLabel} : aucun impact sur les axes.`);

      const targetProductIds: string[] = [];
      for (const ref of list(answer.targetProductRefs)) {
        const product = typeof ref === "string" ? refToId.get(ref) : undefined;
        if (!product) errors.push(`${answerLabel} : référence produit inconnue (${String(ref)}).`);
        else if (!targetProductIds.includes(product.id)) targetProductIds.push(product.id);
      }

      const emoji = text(answer.emoji, DRAFT_TEXT_LIMITS.emoji) || null;
      return { text: answerText, emoji, impacts, targetProductIds };
    });

    const signatures = new Set(answers.map((answer) => JSON.stringify(Object.entries(answer.impacts).sort())));
    if (answers.length >= 2 && signatures.size === 1) errors.push(`${label} : toutes les réponses ont les mêmes impacts.`);

    return { text: questionText, helpText: text(question.helpText, DRAFT_TEXT_LIMITS.helpText) || null, answers };
  });

  // Avertissements de qualité : n'empêchent pas l'enregistrement.
  for (const axis of plan.axes) {
    const values = questions.flatMap((question) => question.answers.map((answer) => answer.impacts[axis.key] ?? 0));
    const amplitude = questions.reduce((sum, question) => {
      const impacts = question.answers.map((answer) => answer.impacts[axis.key] ?? 0);
      return impacts.length ? sum + Math.max(...impacts) - Math.min(...impacts) : sum;
    }, 0);
    if (!values.some((value) => value !== 0)) warnings.push(`L'axe « ${axis.label} » n'est modifié par aucune réponse.`);
    else if (!values.some((value) => value > 0) || !values.some((value) => value < 0)) {
      warnings.push(`L'axe « ${axis.label} » n'est modifié que dans un seul sens.`);
    } else if (amplitude < MIN_AXIS_AMPLITUDE - 1e-9) {
      warnings.push(`L'axe « ${axis.label} » varie peu (amplitude ${round2(amplitude)}).`);
    }
  }

  if (plan.mode === "AXES") {
    let incoherent = 0;
    const byId = new Map(plan.products.map((product) => [product.id, axisValuesOf(product.attributes, plan.axes)]));
    for (const answer of questions.flatMap((question) => question.answers)) {
      for (const productId of answer.targetProductIds ?? []) {
        const values = byId.get(productId) ?? {};
        for (const [key, impact] of Object.entries(answer.impacts)) {
          const position = values[key];
          if (position !== undefined && Math.abs(position - 0.5) >= 0.15 && Math.sign(position - 0.5) !== Math.sign(impact)) incoherent++;
        }
      }
    }
    if (incoherent) warnings.push(`${incoherent} impact(s) orientent à l'opposé du produit visé : vérifiez-les dans l'aperçu.`);
  }

  const targeted = new Set(questions.flatMap((question) => question.answers.flatMap((answer) => answer.targetProductIds)));
  const untargeted = plan.products.filter((product) => !targeted.has(product.id)).length;
  if (untargeted) warnings.push(`${untargeted} produit(s) ne sont visés par aucune réponse.`);

  return {
    draft: {
      name: text(quiz.name, DRAFT_TEXT_LIMITS.name) || "Quiz généré",
      quizTitle: text(quiz.quizTitle, DRAFT_TEXT_LIMITS.quizTitle) || "Trouve ton produit idéal",
      ctaText: text(quiz.ctaText, DRAFT_TEXT_LIMITS.ctaText) || "Découvrir ma sélection",
      axisKeys: input.axisKeys.filter((key) => axisKeys.has(key)),
      productIds: plan.products.map((product) => product.id),
      questions,
    },
    errors,
    warnings,
  };
}

// ─── Brouillon modifié par le commerçant (aperçu et enregistrement) ───────────

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new QuizError(400, `${field} est requis`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new QuizError(400, `${field} dépasse ${max} caractères`);
  return trimmed;
}

/**
 * Revalide entièrement un brouillon envoyé par le client. Les impacts suivent la borne manuelle du builder (±1),
 * mais seulement sur les axes retenus du quiz de la campagne. Les produits sont contrôlés par l'appelant.
 */
export function parseDraft(raw: unknown, scope: GenerationScope): { draft: QuizDraft; axes: QuizAxis[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new QuizError(400, "Brouillon de quiz invalide");
  const body = raw as Record<string, unknown>;
  const axisKeys = parseAxisKeys(body.axisKeys, scope.axes);
  const allowed = new Set(axisKeys);
  const limit = GENERATION_LIMITS.manualImpact;

  if (!Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > GENERATION_LIMITS.maxDraftQuestions) {
    throw new QuizError(400, `Le quiz doit contenir entre 1 et ${GENERATION_LIMITS.maxDraftQuestions} questions`);
  }

  const questions = body.questions.map((rawQuestion: unknown, qi: number): QuizDraftQuestion => {
    if (!rawQuestion || typeof rawQuestion !== "object") throw new QuizError(400, `Question ${qi + 1} invalide`);
    const question = rawQuestion as Record<string, unknown>;
    const label = `Question ${qi + 1}`;
    const answers = question.answers;
    if (!Array.isArray(answers) || answers.length < GENERATION_LIMITS.minAnswers || answers.length > GENERATION_LIMITS.maxAnswers) {
      throw new QuizError(400, `${label} : ${GENERATION_LIMITS.minAnswers} à ${GENERATION_LIMITS.maxAnswers} réponses attendues`);
    }
    const seen = new Set<string>();
    return {
      text: requiredText(question.text, label, DRAFT_TEXT_LIMITS.question),
      helpText: optionalTrimmed(question.helpText, `${label} (aide)`, DRAFT_TEXT_LIMITS.helpText),
      answers: answers.map((rawAnswer: unknown, ai: number) => {
        const answerLabel = `${label}, réponse ${ai + 1}`;
        if (!rawAnswer || typeof rawAnswer !== "object") throw new QuizError(400, `${answerLabel} invalide`);
        const answer = rawAnswer as Record<string, unknown>;
        const answerText = requiredText(answer.text, answerLabel, DRAFT_TEXT_LIMITS.answer);
        if (seen.has(answerText.toLowerCase())) throw new QuizError(400, `${label} : réponses en double`);
        seen.add(answerText.toLowerCase());
        const rawImpacts = answer.impacts ?? {};
        if (typeof rawImpacts !== "object" || Array.isArray(rawImpacts)) throw new QuizError(400, `${answerLabel} : impacts invalides`);
        const impacts: Record<string, number> = {};
        for (const [key, value] of Object.entries(rawImpacts as Record<string, unknown>)) {
          if (!allowed.has(key)) throw new QuizError(400, `${answerLabel} : axe non autorisé (${key})`);
          if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) {
            throw new QuizError(400, `${answerLabel} : l'impact sur ${key} doit être compris entre -${limit} et ${limit}`);
          }
          if (value !== 0) impacts[key] = value;
        }
        return {
          text: answerText,
          emoji: optionalTrimmed(answer.emoji, `${answerLabel} (emoji)`, DRAFT_TEXT_LIMITS.emoji),
          impacts,
        };
      }),
    };
  });

  return {
    draft: {
      name: requiredText(body.name, "Le nom du quiz", DRAFT_TEXT_LIMITS.name),
      quizTitle: requiredText(body.quizTitle, "Le titre du quiz", DRAFT_TEXT_LIMITS.quizTitle),
      ctaText: requiredText(body.ctaText, "Le texte du bouton", DRAFT_TEXT_LIMITS.ctaText),
      axisKeys,
      productIds: parseProductIds(body.productIds),
      questions,
    },
    axes: scope.axes.filter((axis) => allowed.has(axis.key)),
  };
}

// ─── Limitation des appels IA ─────────────────────────────────────────────────

/**
 * Une génération à la fois par tenant et un quota glissant par heure.
 * État en mémoire : propre à une instance du backend.
 */
export class GenerationLimiter {
  private inFlight = new Set<string>();
  private history = new Map<string, number[]>();

  constructor(private maxPerHour: number, private now: () => number = Date.now) {}

  acquire(tenantId: string): () => void {
    if (this.inFlight.has(tenantId)) throw new QuizError(409, "Une génération est déjà en cours pour votre compte");
    const since = this.now() - 60 * 60 * 1000;
    const recent = (this.history.get(tenantId) ?? []).filter((time) => time > since);
    if (recent.length >= this.maxPerHour) {
      throw new QuizError(429, `Limite de ${this.maxPerHour} générations par heure atteinte, réessayez plus tard`);
    }
    recent.push(this.now());
    this.history.set(tenantId, recent);
    this.inFlight.add(tenantId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight.delete(tenantId);
    };
  }

  reset() {
    this.inFlight.clear();
    this.history.clear();
  }
}

const hourlyLimit = Number.parseInt(process.env.QUIZ_GENERATION_HOURLY_LIMIT ?? "", 10);
export const generationLimiter = new GenerationLimiter(Number.isInteger(hourlyLimit) && hourlyLimit > 0 ? hourlyLimit : 10);
