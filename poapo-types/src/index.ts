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
  /** Occasion et période facultatives, informatives : sans effet sur l'accès public. */
  occasion?: QuizOccasion | null;
  occasionLabel?: string | null;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
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
// Occasion d'une expérience (informative)
// ─────────────────────────────────────────────
export type QuizOccasion =
  | "CHRISTMAS" | "VALENTINES_DAY" | "SPRING" | "MOTHERS_DAY" | "BACK_TO_SCHOOL"
  | "BLACK_FRIDAY" | "PROMOTION" | "PERMANENT" | "CUSTOM";

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
  /** false : la formule n'inclut pas l'estimation IA (l'estimation locale, sans IA, reste disponible). */
  aiAvailable?: boolean;
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
  /** Quiz enregistré dont on estime les axes ; ou, à défaut, `axes` (brouillon non encore enregistré, parcours express). */
  quizId?: string;
  axes?: QuizAxis[];
  axisKeys: string[];
  /** Estimation locale uniquement : absent = tous les produits actifs du catalogue (500 maximum). */
  productIds?: string[];
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
  /** Renseigné par l'estimation locale (affichage sans second appel). */
  productName?: string;
  /** Valeurs en base au moment de l'estimation, pour les axes demandés. */
  currentValues: Record<string, number | null>;
  estimates: AxisEstimate[];
}

export interface ProductEnrichmentEstimateResponse {
  results: ProductEnrichmentResult[];
  warnings: string[];
  generation: { model: string; durationMs: number; attempts: number; aiProducts: number };
  remaining: number;
  /** Estimation locale : clés d'axes pour lesquels une règle automatique existe (les autres restent à renseigner à la main). */
  supportedAxes?: string[];
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
  quizId?: string;
  /** Axes d'un brouillon non enregistré (parcours express), à défaut de `quizId`. */
  axes?: QuizAxis[];
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

/** Effets additifs d'une réponse (lot 10D-2B). Validés côté serveur par `parseAnswerEffects` ; absents = comportement historique. */
export type EffectMissingPolicy = "exclude" | "include";
export type AnswerEffect =
  | { type: "category"; criterion: string; mode: "soft" | "strict"; values: string[]; onMissing?: EffectMissingPolicy }
  | { type: "range"; criterion: string; mode: "soft" | "strict"; min?: number; max?: number; onMissing?: EffectMissingPolicy }
  | { type: "axis"; axis: string }
  | { type: "none"; criterion: string };
export interface AnswerEffects { v: 1; effects: AnswerEffect[] }

export interface Answer {
  id: string;
  questionId: string;
  text: string;
  emoji: string | null;
  imageUrl: string | null;
  order: number;
  active: boolean;
  impacts: AnswerImpact;
  /** Absent ou null : aucun effet (comportement historique). */
  effects?: AnswerEffects | null;
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
  /** Caractéristiques présentables (libellé visiteur + valeur lisible), choisies parmi celles que le quiz utilise. */
  characteristics?: { key: string; label: string; value: string }[];
  /** Présent seulement quand des critères stricts ou des préférences avancées ont été appliqués (quiz avancés). */
  selection?: { state: "matched" | "unconstrained"; matched: number; limited: boolean };
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

/** Nature d'une question générée, en langage commerçant (jamais d'identifiant technique). */
export type ExpressQuestionKind = "axis" | "choice" | "budget" | "yesno" | "measure";

export interface ExpressQuestionInfo {
  /** Libellé de la caractéristique du catalogue que la question exploite (ex. « Famille »). */
  criterion: string;
  kind: ExpressQuestionKind;
  /** true : le plafond est une exigence (aucun produit au-dessus n'est proposé). */
  strict: boolean;
  /** Le rôle de ce critère pour un visiteur ne peut pas être déduit avec assez de confiance : à valider par le commerçant. */
  needsValidation: boolean;
  validationReason: string | null;
  /** Limite de couverture à connaître (ex. « renseigné sur 62 % des produits »). */
  coverageNote: string | null;
}

export interface ExpressCriterionSummary {
  label: string;
  kind: ExpressQuestionKind;
  status: "used" | "to_validate" | "left_out";
  coverage: number;
  /** Phrase compréhensible : pourquoi ce critère est utilisé, à valider ou écarté. */
  reason: string;
}

export interface ExpressAnswer {
  text: string;
  emoji?: string | null;
  /** Effet attendu en une phrase (ex. « Favorise les produits Floral »). Jamais de structure technique. */
  effectSummary?: string | null;
  /** Effets avancés (préférence catégorielle, plage de prix, plafond strict). Opaque pour l'interface : à renvoyer tel quel. */
  effects?: AnswerEffects | null;
  /** Deltas appliqués au profil (départ à 0,5, borné 0–1), uniquement sur des axes du brouillon. */
  impacts: Record<string, number>;
}

export interface ExpressQuestion {
  text: string;
  helpText?: string | null;
  /** Présent pour les questions générées par le générateur avancé. */
  info?: ExpressQuestionInfo;
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

// ─────────────────────────────────────────────
// Import CSV : lecture des colonnes (lot 10C) — informations pour le commerçant, additives
// ─────────────────────────────────────────────
/** standard : reconnue automatiquement ; suggested : information supplémentaire proposée (à confirmer) ; unrecognized : aucune proposition ; empty : aucune valeur. */
export type ImportColumnStatus = "standard" | "suggested" | "unrecognized" | "empty";
export type ImportColumnKind = "number" | "yesno" | "category" | "text" | "identifier" | "mixed" | "empty";

export interface ImportColumnInsight {
  sourceColumn: string;
  status: ImportColumnStatus;
  detected: ImportColumnKind;
  example: string | null;
  filled: number;
  total: number;
  distinct: number;
  /** Destination proposée pour une information supplémentaire ; jamais appliquée sans confirmation. */
  suggestion: { targetField: string; key: string; recommended: boolean; renamed: boolean } | null;
  /** Messages en français destinés au commerçant. */
  notes: string[];
}

// ─────────────────────────────────────────────
// Diagnostic de colonnes d'un catalogue (lot 10B) — descriptif, sans effet sur la génération
// ─────────────────────────────────────────────
/** Famille descriptive d'un critère. UNKNOWN : valeurs non exploitables (structure inconnue, aucune valeur). */
export type ColumnType = "NUMERIC" | "CATEGORICAL" | "RANGE" | "UNKNOWN";
export type ColumnSource = "price" | "brand" | "tags" | "attribute";
export type ColumnValueKind = "number" | "boolean" | "text" | "list" | "mixed" | "other" | "none";
export type ColumnRejectionCode =
  | "TOO_FEW_PRODUCTS"
  | "INSUFFICIENT_COVERAGE"
  | "UNSUPPORTED_STRUCTURE"
  | "INVALID_VALUES"
  | "IDENTIFIER_LIKE"
  | "CONSTANT_VALUE"
  | "HIGH_CARDINALITY"
  | "INSUFFICIENT_VARIATION";
export type ColumnWarningCode = "PARTIAL_COVERAGE" | "IMBALANCED_DISTRIBUTION" | "MERGED_VARIANTS" | "OUT_OF_AXIS_SCALE";

export interface ColumnCategoryValue {
  /** Libellé affiché : forme d'origine la plus fréquente (jamais réécrite). */
  value: string;
  count: number;
  /** Part des valeurs renseignées (pour une liste : part des occurrences). */
  share: number;
}

export type ColumnDistribution =
  | { kind: "numeric"; min: number; p10: number; p25: number; median: number; p75: number; p90: number; max: number }
  | { kind: "categorical"; values: ColumnCategoryValue[]; otherCount: number }
  | { kind: "none" };

export interface ColumnProfile {
  /** Clé stable : "price", "brand", "tags" ou "attribute.<clé>". */
  key: string;
  source: ColumnSource;
  /** Nom de l'attribut ou du champ produit. */
  name: string;
  inferredType: ColumnType;
  valueKind: ColumnValueKind;
  totalProducts: number;
  /** Produits ayant une valeur non vide. */
  productCount: number;
  coverage: number;
  /** Part des valeurs renseignées conformes au type dominant. */
  parseRate: number;
  distinctCount: number;
  distribution: ColumnDistribution;
  /** Entropie / ln(nombre de valeurs) ; null hors catégories ou avec moins de 2 valeurs. */
  normalizedEntropy: number | null;
  /** Part de la valeur dominante (catégories) ; null sinon. */
  dominantShare: number | null;
  /** Part des paires de produits séparées par ce critère (3 tranches pour un nombre) : 0 = rien ne départage, plafonnée par la couverture. */
  discriminance: number;
  usable: boolean;
  rejection: { code: ColumnRejectionCode; message: string } | null;
  warnings: { code: ColumnWarningCode; message: string }[];
  /** Marqueur descriptif seul : ce critère pourrait un jour servir de contrainte. Aucune contrainte n'est créée. */
  constraintCandidate: boolean;
  /** Clé d'un axe de recommandation déjà défini pour ce catalogue. */
  knownAxis: boolean;
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
  /** Diagnostic additif (lot 10B) de toutes les colonnes du catalogue : lecture seule, n'influence pas le brouillon. */
  columns?: ColumnProfile[];
  /** Générateur utilisé pour le brouillon : « legacy » (modèles sectoriels) ou « universal » (critères tirés des données). */
  generator?: "legacy" | "universal";
  /** Critères examinés par le générateur avancé, en langage commerçant. */
  criteria?: ExpressCriterionSummary[];
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

// ── Abonnement (GET /api/subscription) ──
export type SubscriptionPlanId = "STARTER" | "PRO" | "BUSINESS";
export type SubscriptionQuotaKey = "catalogs" | "publishedExperiences" | "recommendationsPerMonth";
export type SubscriptionFeatureKey = "aiEnrichment" | "advancedAnalytics";

export interface SubscriptionOverview {
  plan: SubscriptionPlanId;
  planLabel: string;
  status: "ACTIVE" | "EXPIRED" | "CANCELED";
  source: "SIGNUP" | "PROMO" | "LEGACY" | "STRIPE";
  /** Accès offert en cours de validité (« Offert pendant le pilote »). */
  promotional: boolean;
  startsAt: string | null;
  endsAt: string | null;
  /** Plan stocké lorsque l'accès offert a expiré. */
  previousPlan: SubscriptionPlanId | null;
  /** null = illimité. */
  limits: Record<SubscriptionQuotaKey, number | null>;
  features: Record<SubscriptionFeatureKey, boolean>;
  usage: Record<SubscriptionQuotaKey, number>;
  usagePeriod: { period: string; resetsAt: string };
  plans: { id: SubscriptionPlanId; label: string; limits: Record<SubscriptionQuotaKey, number | null>; features: Record<SubscriptionFeatureKey, boolean> }[];
  featureLabels: Record<SubscriptionFeatureKey, string>;
}
