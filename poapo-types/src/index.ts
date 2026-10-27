// ─────────────────────────────────────────────
// Tenant
// ─────────────────────────────────────────────
export * from "./quizTheme";
export * from "./quizFlow";
export * from "./dashboard";
export * from "./experiences";

export interface Tenant {
  id: string;
  email: string;
  name: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
  quizTitle: string | null;
  ctaText: string | null;
  embedDomain: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantBranding {
  name?: string;
  industry?: string;
  primaryColor?: string;
  logoUrl?: string;
  quizTitle?: string;
  ctaText?: string;
  embedDomain?: string;
}

export interface EmbedConfig {
  tenantId: string;
  /** Nom de la boutique, pour la signature quand aucun logo n'est configuré. */
  tenantName?: string | null;
  quizId: string;
  industry: string;
  axes: QuizAxis[];
  primaryColor: string;
  logoUrl: string | null;
  quizTitle: string;
  ctaText: string;
  active: boolean;
  /** Published overrides only. Absent for historical, uncustomized quizzes. */
  theme?: import("./quizTheme").QuizTheme;
}

/**
 * Axe numérique de recommandation défini par quiz. Les valeurs vont de 0 à 1 :
 * les produits les portent dans `attributes[key]`, les réponses les modifient via `impacts[key]`.
 */
export interface QuizAxis {
  key: string;
  label: string;
  lowLabel?: string | null;
  highLabel?: string | null;
}

// ─────────────────────────────────────────────
// Catalogues — ensembles indépendants de produits d'un tenant
// ─────────────────────────────────────────────
export interface CatalogRef {
  id: string;
  name: string;
}

export interface Catalog extends CatalogRef {
  tenantId: string;
  description: string | null;
  /** Catalogue utilisé lorsque aucun catalogId n'est fourni (anciennes API, nouveaux quiz). */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogSummary extends Catalog {
  productCount: number;
  activeProductCount: number;
  quizCount: number;
  campaignCount: number;
}

export interface CatalogInput {
  name?: string;
  description?: string | null;
}

export interface Quiz {
  id: string;
  tenantId: string;
  /** Le quiz ne recommande que des produits de ce catalogue. */
  catalogId: string;
  catalog?: CatalogRef;
  name: string;
  /** Libellé libre de l'activité (ex. « Café de spécialité »). */
  industry: string;
  axes: QuizAxis[];
  quizTitle: string;
  ctaText: string;
  active: boolean;
  isDefault: boolean;
  /** Tous les produits actifs du catalogue du quiz ; sinon la sélection `products`. */
  useAllProducts: boolean;
  products: { productId: string }[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface QuizInput {
  name?: string;
  /** Catalogue par défaut du tenant si absent à la création. */
  catalogId?: string;
  industry?: string;
  axes?: QuizAxis[];
  quizTitle?: string;
  ctaText?: string;
  active?: boolean;
  useAllProducts?: boolean;
  /** Produits du catalogue du quiz uniquement. */
  productIds?: string[];
}

// ─────────────────────────────────────────────
// Campaign Studio
// ─────────────────────────────────────────────
export type CampaignStatus = "DRAFT" | "SCHEDULED" | "ACTIVE" | "PAUSED" | "COMPLETED";

export type CampaignOccasion =
  | "CHRISTMAS" | "VALENTINES_DAY" | "SPRING" | "MOTHERS_DAY" | "BACK_TO_SCHOOL"
  | "BLACK_FRIDAY" | "PROMOTION" | "PERMANENT" | "CUSTOM";

export interface CampaignQuizSummary {
  id: string;
  name: string;
  active: boolean;
  /** Nombre de questions actives du quiz. */
  questionCount: number;
  /** Produits proposés par le quiz (catalogue actif si useAllProducts). */
  productCount: number;
  catalog: CatalogRef;
}

export interface Campaign {
  id: string;
  tenantId: string;
  quizId: string;
  name: string;
  occasion: CampaignOccasion;
  occasionLabel: string | null;
  description: string | null;
  objectives: string[];
  imageUrl: string | null;
  /** Statut enregistré, choisi par le tenant. */
  status: CampaignStatus;
  /** Statut calculé à partir du statut enregistré et des dates (SCHEDULED/ACTIVE/COMPLETED). */
  effectiveStatus: CampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  quiz: CampaignQuizSummary;
}

export interface CampaignInput {
  quizId?: string;
  name?: string;
  occasion?: CampaignOccasion;
  occasionLabel?: string | null;
  description?: string | null;
  objectives?: string[];
  imageUrl?: string | null;
  status?: CampaignStatus;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface CampaignListResponse {
  data: Campaign[];
  /** Nombre de campagnes du tenant par statut calculé, indépendamment des filtres. */
  counts: Record<CampaignStatus, number> & { total: number };
}

// ─────────────────────────────────────────────
// Campaign Studio — génération de quiz par IA
// ─────────────────────────────────────────────
export type QuizGenerationObjective =
  | "GIFT_FINDER" | "PRODUCT_DISCOVERY" | "CROSS_SELL" | "HIGHLIGHT_NEW" | "CLEAR_STOCK";

/**
 * AXES : au moins un axe sépare les produits sélectionnés (écart ≥ 0,2).
 * SEMANTIC : aucun axe discriminant, la recommandation repose sur la similarité sémantique
 * (embeddings) du moteur existant, alimentée par le texte du profil construit à partir des axes.
 */
export type QuizGenerationMode = "AXES" | "SEMANTIC";

export interface QuizGenerationProduct {
  id: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  price: number | null;
  /** Le produit dispose d'un embedding : il peut être départagé sémantiquement. */
  hasEmbedding: boolean;
  /** Valeurs 0–1 du produit sur les axes du quiz de la campagne. */
  axisValues: Record<string, number>;
}

export interface QuizGenerationLimits {
  minProducts: number;
  maxProducts: number;
  minQuestions: number;
  maxQuestions: number;
  maxDraftQuestions: number;
  minAnswers: number;
  maxAnswers: number;
  instructions: number;
  /** Borne des impacts proposés par l'IA. */
  generationImpact: number;
  /** Borne des impacts modifiés manuellement, identique au Quiz Builder. */
  manualImpact: number;
}

export interface QuizGenerationContext {
  campaign: {
    id: string;
    name: string;
    status: CampaignStatus;
    effectiveStatus: CampaignStatus;
    occasion: CampaignOccasion;
    occasionLabel: string | null;
    quizId: string;
    quizName: string;
  };
  /** Catalogue du quiz de la campagne : seuls ses produits sont proposés. */
  catalog: CatalogRef;
  industry: string;
  /** Axes du quiz de la campagne : les seuls utilisables par la génération. */
  axes: QuizAxis[];
  products: QuizGenerationProduct[];
  /** Le quiz généré peut être rattaché automatiquement (campagne en brouillon). */
  canAttach: boolean;
  limits: QuizGenerationLimits;
}

export interface QuizGenerationRequest {
  occasion?: CampaignOccasion;
  occasionLabel?: string | null;
  objective: QuizGenerationObjective;
  productIds: string[];
  /** Sous-ensemble des axes du quiz de la campagne ; tous par défaut. */
  axisKeys?: string[];
  instructions?: string | null;
  questionCount?: number;
}

export interface QuizDraftAnswer {
  text: string;
  emoji: string | null;
  impacts: AnswerImpact;
  /** Produits visés par l'IA, indicatif : jamais enregistré. */
  targetProductIds?: string[];
}

export interface QuizDraftQuestion {
  text: string;
  helpText: string | null;
  answers: QuizDraftAnswer[];
}

/** Quiz généré ou modifié, non enregistré. Toutes les questions sont à choix unique. */
export interface QuizDraft {
  name: string;
  quizTitle: string;
  ctaText: string;
  axisKeys: string[];
  productIds: string[];
  questions: QuizDraftQuestion[];
}

export interface GeneratedQuizDraft {
  draft: QuizDraft;
  mode: QuizGenerationMode;
  axes: QuizAxis[];
  industry: string;
  warnings: string[];
  generation: { model: string; durationMs: number; attempts: number };
}

export interface QuizDraftPreviewRequest {
  draft: QuizDraft;
  /** Index de la réponse choisie pour chaque question, dans l'ordre. */
  answers: number[];
}

export interface QuizDraftRecommendation {
  product: Pick<Product, "id" | "name" | "brand" | "imageUrl" | "price">;
  score: number;
}

export interface QuizDraftPreviewResponse {
  profile: Record<string, number>;
  profileSummary: ProfileSummary;
  explanation: string[];
  recommendations: QuizDraftRecommendation[];
}

export interface QuizDraftSaveRequest {
  draft: QuizDraft;
  attachToCampaign: boolean;
}

export interface QuizDraftSaveResponse {
  quizId: string;
  quizName: string;
  questionCount: number;
  answerCount: number;
  attachedToCampaign: boolean;
  /** Raison du non-rattachement lorsqu'il était demandé. */
  attachMessage: string | null;
}

// ─────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────
export interface MagicLinkRequest {
  email: string;
}

export interface AuthToken {
  tenantId: string;
  email: string;
  isSuperAdmin?: boolean;
  /** Identité Auth0 valide sans boutique : l'administration affiche l'onboarding. */
  onboardingRequired?: boolean;
  emailVerified?: boolean;
  role?: "OWNER" | "ADMIN" | "MEMBER";
  iat?: number;
  exp?: number;
}

export interface TenantAdminItem {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
  quizTitle: string | null;
  ctaText: string | null;
  primaryColor: string | null;
}

export interface TenantAdminCreateInput {
  email: string;
  name?: string;
  password?: string;
  active?: boolean;
}

export interface TenantAdminUpdateInput {
  name?: string | null;
  active?: boolean;
  quizTitle?: string | null;
  ctaText?: string | null;
  primaryColor?: string | null;
  embedDomain?: string | null;
}

// ─────────────────────────────────────────────
// Product
// ─────────────────────────────────────────────
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
/** Caractéristiques propres à l'activité : valeurs des axes (0–1) et attributs libres. */
export type ProductAttributes = { [key: string]: JsonValue };

export interface Product {
  id: string;
  tenantId: string;
  catalogId: string;
  name: string;
  brand: string | null;
  description: string | null;
  price: number | null;
  imageUrl: string | null;
  purchaseUrl: string | null;
  active: boolean;
  featured: boolean;
  tags: string[];
  attributes: ProductAttributes;
  embedding: number[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ProductCreateInput = Omit<Product, "id" | "tenantId" | "catalogId" | "embedding" | "createdAt" | "updatedAt" | "attributes"> & {
  attributes?: ProductAttributes;
  /** Catalogue par défaut du tenant si absent. */
  catalogId?: string;
};
export type ProductUpdateInput = Partial<ProductCreateInput>;

// ─────────────────────────────────────────────
// Enrichissement des produits par IA — valeurs d'axes proposées puis validées
// ─────────────────────────────────────────────

export type AxisEstimateStatus = "estimated" | "insufficient_data";
/** Échelle qualitative : un pourcentage produit par le modèle ne serait pas calibré. */
export type AxisEstimateConfidence = "low" | "medium" | "high";

export interface EnrichmentQuizOption {
  id: string;
  name: string;
  active: boolean;
  axes: QuizAxis[];
}

export interface EnrichmentProduct {
  id: string;
  name: string;
  brand: string | null;
  active: boolean;
  /** Valeur actuelle sur chaque axe du quiz choisi ; null si absente. */
  axisValues: Record<string, number | null>;
  /** Axes dont la valeur existante n'est pas un nombre entre 0 et 1 (non estimables sans correction manuelle). */
  invalidAxes: string[];
  /** Fiche avec description, tags ou caractéristiques libres : sinon aucune estimation n'est demandée à l'IA. */
  hasData: boolean;
}

export interface ProductEnrichmentLimits {
  batchSize: number;
  hourlyProducts: number;
  remaining: number;
}

export interface ProductEnrichmentContext {
  catalog: CatalogRef;
  quizzes: EnrichmentQuizOption[];
  /** Quiz dont les axes sont estimés ; null si le catalogue n'a aucun quiz avec axes. */
  quiz: EnrichmentQuizOption | null;
  products: EnrichmentProduct[];
  /** Pour chaque clé d'axe du quiz : les autres quiz du catalogue qui utilisent la même clé. */
  sharedAxes: Record<string, string[]>;
  limits: ProductEnrichmentLimits;
}

export interface ProductEnrichmentEstimateInput {
  quizId: string;
  axisKeys: string[];
  productIds: string[];
}

export interface AxisEstimate {
  axis: string;
  status: AxisEstimateStatus;
  /** Entre 0 et 1 si `estimated`, null sinon. */
  value: number | null;
  confidence: AxisEstimateConfidence | null;
  rationale: string;
  /** Extraits présents dans la fiche produit transmise (les autres sont écartés). */
  evidence: string[];
}

export interface ProductEnrichmentResult {
  productId: string;
  /** Valeurs en base au moment de l'estimation, pour les axes demandés. */
  currentValues: Record<string, number | null>;
  estimates: AxisEstimate[];
}

export interface ProductEnrichmentEstimateResponse {
  results: ProductEnrichmentResult[];
  warnings: string[];
  generation: { model: string; durationMs: number; attempts: number; aiProducts: number };
  remaining: number;
}

export interface ProductEnrichmentUpdate {
  productId: string;
  /** Valeurs validées par le commerçant (0–1) pour les axes du quiz. */
  values: Record<string, number>;
  /** Valeur vue par le commerçant pour chaque axe de `values` (null = absente) ; tout écart est refusé. */
  expected: Record<string, number | null>;
  /** Axes dont le remplacement d'une valeur existante est explicitement confirmé. */
  overwrite: string[];
}

export interface ProductEnrichmentApplyInput {
  quizId: string;
  updates: ProductEnrichmentUpdate[];
}

export interface ProductEnrichmentApplyResponse {
  updatedProducts: number;
  added: number;
  replaced: number;
}

// ─────────────────────────────────────────────
// Quiz — Questions & Answers
// ─────────────────────────────────────────────
export type QuestionType = "single" | "multi" | "scale";

export type AnswerImpact = Record<string, number>;

export interface Answer {
  id: string;
  questionId: string;
  text: string;
  emoji: string | null;
  imageUrl: string | null;
  order: number;
  active: boolean;
  impacts: AnswerImpact;
}

export interface Question {
  id: string;
  tenantId: string;
  quizId: string;
  text: string;
  helpText: string | null;
  type: QuestionType;
  imageUrl: string | null;
  order: number;
  active: boolean;
  conditionAnswerId: string | null;
  abVariant: string | null;
  answers: Answer[];
}

// Builder — inputs CRUD admin
export interface QuestionCreateInput {
  text: string;
  helpText?: string | null;
  type?: QuestionType;
  imageUrl?: string | null;
  conditionAnswerId?: string | null;
  abVariant?: string | null;
}

export interface QuestionUpdateInput extends Partial<QuestionCreateInput> {
  active?: boolean;
}

export interface AnswerCreateInput {
  text: string;
  emoji?: string | null;
  imageUrl?: string | null;
  impacts?: Partial<AnswerImpact>;
}

export interface AnswerUpdateInput extends Partial<AnswerCreateInput> {
  active?: boolean;
}

export interface ReorderPayload {
  order: { id: string; order: number }[];
}

export type QuizEditorAnswer = Omit<Answer, "questionId">;
export type QuizEditorQuestion = Omit<Question, "tenantId" | "quizId" | "answers"> & {
  answers: QuizEditorAnswer[];
};

/** Independent of the single-choice draft returned by AI generation. */
export interface QuizEditorDraft {
  schemaVersion: 1;
  theme?: import("./quizTheme").QuizTheme | null;
  config: {
    name: string;
    catalogId: string;
    industry: string;
    axes: QuizAxis[];
    quizTitle: string;
    ctaText: string;
    active: boolean;
    useAllProducts: boolean;
    productIds: string[];
  };
  questions: QuizEditorQuestion[];
}

export interface QuizEditorDraftResponse {
  quizId: string;
  revision: number;
  hasChanges: boolean;
  updatedAt: string | null;
  draft: QuizEditorDraft;
}

export interface QuizEditorDraftSaveInput {
  revision: number;
  draft: QuizEditorDraft;
}

export interface QuizPreviewSnapshot {
  quizId: string;
  draft: QuizEditorDraft;
  branding: import("./quizTheme").QuizBranding;
}

export interface QuizPublicationIssue {
  code: string;
  message: string;
  section: "questions" | "appearance" | "configuration" | "publication";
  questionId?: string;
  answerId?: string;
}

export interface QuizPublicationDiagnostic {
  quizId: string;
  revision: number;
  hasChanges: boolean;
  valid: boolean;
  errors: QuizPublicationIssue[];
  warnings: QuizPublicationIssue[];
  campaigns: { id: string; name: string }[];
  summary: { name: string; catalogId: string; catalogName: string; questions: number; products: number; active: boolean };
}

// ─────────────────────────────────────────────
// Quiz Session
// ─────────────────────────────────────────────
export type FeedbackType = "positive" | "negative";

export interface SessionAnswer {
  questionId: string;
  answerId: string;
}

export interface QuizSession {
  id: string;
  tenantId: string;
  quizId: string;
  answers: SessionAnswer[];
  resultProductId: string | null;
  feedback: FeedbackType | null;
  feedbackReasons: string[];
  decisionTime: number | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface QuizSubmitPayload {
  clientId: string;
  quizId?: string;
  abVariant?: string;
  answers: SessionAnswer[];
  decisionTime?: number;
}

export interface QuizResult {
  quizId: string;
  industry: string;
  product: Pick<
    Product,
    "id" | "name" | "brand" | "imageUrl" | "purchaseUrl" | "price" | "description" | "tags" | "attributes"
  >;
  explanation: string[];
  profileSummary: ProfileSummary;
}

// ─────────────────────────────────────────────
// AI — User Profile
// ─────────────────────────────────────────────
export type ProfileLevel = "faible" | "modéré" | "élevé";

export interface ProfileAxisSummary {
  key: string;
  label: string;
  value: number;
  level: ProfileLevel;
  /** Libellé du pôle correspondant (lowLabel / highLabel), si défini. */
  description: string | null;
}

export interface ProfileSummary {
  axes: ProfileAxisSummary[];
}

// ─────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────
export type MetricType = "quiz_start" | "quiz_complete" | "quiz_abandon" | "step_view" | "step_answer" | "buy_click" | "feedback" | "decision_time";

export interface Metric {
  id: string;
  tenantId: string;
  quizId: string;
  type: MetricType;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface MetricsFunnel {
  started: number;
  completed: number;
  /** Abandons émis par le widget corrigé (payload `reason`) ; ne contient pas les anciens événements. */
  abandoned: number;
  /** Anciens `quiz_abandon` (émis à chaque changement de question) : non fiables, exclus de `abandoned`. */
  legacyAbandonEvents?: number;
  completionRate: number;
}

export interface MetricIndicator {
  value: number | null;
  reliable: boolean;
  reason: string | null;
}

export interface MetricIndicators {
  started: number;
  completed: number;
  recommendations: number;
  productClicks: number;
  completionRate: MetricIndicator;
  clicksPer100Recommendations: MetricIndicator;
  consistency: { completedMinusRecommendations: number; consistent: boolean };
}

export interface MetricsCTA {
  clicks: number;
  clickThroughRate: number;
}

export interface MetricsStep {
  step: string;
  views: number;
  answers: number;
  dropOffRate: number;
}

export interface MetricsVariant {
  variant: string;
  started: number;
  completed: number;
  clicks: number;
  completionRate: number;
  clickThroughRate: number;
}

export interface MetricsTopProduct {
  product: { id: string | null; name: string; brand?: string | null };
  count: number;
}

export interface QuizMetricsResponse {
  period: { from: string | Date; to: string | Date };
  funnel: MetricsFunnel;
  indicators?: MetricIndicators;
  cta: MetricsCTA;
  feedback: { positive: number; negative: number };
  topProducts: MetricsTopProduct[];
  steps: MetricsStep[];
  variants: MetricsVariant[];
}

// ─────────────────────────────────────────────
// Page Résultats (synthèse tenant-scopée)
// ─────────────────────────────────────────────
export interface ResultsCounts {
  started: number;
  completed: number;
  recommendations: number;
  productClicks: number;
}

export interface ResultsDailyPoint extends ResultsCounts { date: string }

export interface ResultsExperienceRow extends ResultsCounts {
  id: string;
  name: string;
  active: boolean;
  catalogId: string;
  catalogName: string;
}

export interface ResultsSummary {
  period: { from: string; to: string; days: number };
  totals: ResultsCounts;
  previous: ResultsCounts;
  daily: ResultsDailyPoint[];
  experiences: ResultsExperienceRow[];
  catalogs: { id: string; name: string }[];
  /** Vrai si le périmètre dépasse `quizLimit` expériences : totaux et séries ne couvrent alors que les `quizLimit` premières. */
  truncated: boolean;
  quizLimit: number;
}

export interface ResultsQuestionStat {
  questionId: string;
  label: string;
  views: number;
  answers: number;
  options: { answerId: string; label: string; count: number }[];
  /** Question à choix multiple dont le suivi des réponses est absent ou incomplet sur tout ou partie de la période. */
  partial?: boolean;
}

export interface ResultsExperienceDetail {
  period: { from: string; to: string; days: number };
  experience: { id: string; name: string; catalogId: string; catalogName: string };
  totals: ResultsCounts;
  daily: ResultsDailyPoint[];
  questions: ResultsQuestionStat[];
  /** Étapes de collecte dont l'identifiant ne correspond à aucune question actuelle. */
  unmatchedSteps: number;
  topProducts: { productId: string | null; name: string; count: number }[];
  clickedProducts: { productId: string; name: string; count: number }[];
  variants: MetricsVariant[];
}

export interface MetricsAIInsight {
  title: string;
  insight: string;
  priority: "high" | "medium" | "low";
  actions: string[];
}

export interface QuizMetricsAIResponse {
  source: "openai" | "fallback";
  generatedAt: string | Date;
  insights: MetricsAIInsight[];
}

// ─────────────────────────────────────────────
// Catalog import
// ─────────────────────────────────────────────
/** Champ produit, ou `attribute.<clé>` pour une caractéristique propre à l'activité. */
export type CatalogField = Exclude<keyof ProductCreateInput, "attributes" | "catalogId"> | `attribute.${string}`;

export interface ColumnMapping {
  sourceColumn: string;
  targetField: CatalogField | null;
}

export interface MappingSuggestion {
  mappings: ColumnMapping[];
  sampleRows: Record<string, string>[];
  confidence: number;
}

// ─────────────────────────────────────────────
// Création express — brouillon d'expérience généré de façon déterministe
// ─────────────────────────────────────────────
export type ExpressSector = "coffee" | "perfume" | "travel" | "fashion" | "generic";
/** reliable : au moins 2 critères séparent réellement les produits ; limited : 1 critère ou similarité sémantique seule ; insufficient : rien ne départage les produits. */
export type ExpressReliability = "reliable" | "limited" | "insufficient";
export type ExpressQuestionCount = 3 | 5 | 7;

export interface ExpressAxis extends QuizAxis {
  description: string;
  /** Pourquoi ce critère est proposé (données du catalogue, modèle sectoriel, axe existant). */
  justification: string;
  /** data : valeurs renseignées sur les produits ; semantic : aucune valeur produit, départage par les descriptions seulement. */
  evidence: "data" | "semantic";
  reused: boolean;
  valuedProducts: number;
  spread: number;
}

export interface ExpressAnswer {
  text: string;
  emoji?: string | null;
  /** Deltas appliqués au profil (départ à 0,5, borné 0–1), uniquement sur des axes du brouillon. */
  impacts: Record<string, number>;
}

export interface ExpressQuestion {
  text: string;
  helpText?: string | null;
  answers: ExpressAnswer[];
}

export interface ExpressDraft {
  name: string;
  quizTitle: string;
  ctaText: string;
  industry: string;
  axes: ExpressAxis[];
  questions: ExpressQuestion[];
}

export interface ExpressAxisCandidate {
  key: string;
  label: string;
  valuedProducts: number;
  spread: number;
  discriminant: boolean;
  used: boolean;
  note: string | null;
}

export interface ExpressAnalysis {
  catalogId: string;
  catalogName: string;
  productCount: number;
  /** Produits dont l'embedding est prêt (départage sémantique possible). */
  semanticProducts: number;
  sector: ExpressSector;
  sectorLabel: string;
  sectorDetected: boolean;
  reliability: ExpressReliability;
  /** Messages à afficher tels quels : limites, données manquantes, critères écartés. */
  messages: string[];
  candidates: ExpressAxisCandidate[];
  /** Critères typiques du secteur absents des produits : à renseigner (enrichissement) pour fiabiliser. */
  missingForSector: { key: string; label: string }[];
}

export interface ExpressProposal {
  analysis: ExpressAnalysis;
  /** null si le catalogue ne permet aucune proposition honnête (enrichissement requis). */
  draft: ExpressDraft | null;
  /** Questions compatibles avec les critères du brouillon, non utilisées : pour remplacer une question. */
  alternatives: ExpressQuestion[];
}

export interface ExpressValidation {
  reliability: ExpressReliability;
  warnings: string[];
}

export interface ExpressPreviewResponse {
  reliability: ExpressReliability;
  profileSummary: ProfileSummary;
  recommendations: { product: { id: string; name: string; brand: string | null; imageUrl: string | null; price: number | null }; score: number }[];
}

export interface ExpressSaveResponse extends ExpressValidation {
  quizId: string;
  quizName: string;
  questionCount: number;
  answerCount: number;
}

// ─────────────────────────────────────────────
// API responses
// ─────────────────────────────────────────────
export interface ApiError {
  error: string;
  details?: unknown;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
