// ─────────────────────────────────────────────
// Tenant
// ─────────────────────────────────────────────
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
  quizId: string;
  industry: string;
  axes: QuizAxis[];
  primaryColor: string;
  logoUrl: string | null;
  quizTitle: string;
  ctaText: string;
  active: boolean;
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

export interface Quiz {
  id: string;
  tenantId: string;
  name: string;
  /** Libellé libre de l'activité (ex. « Café de spécialité »). */
  industry: string;
  axes: QuizAxis[];
  quizTitle: string;
  ctaText: string;
  active: boolean;
  isDefault: boolean;
  useAllProducts: boolean;
  products: { productId: string }[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface QuizInput {
  name?: string;
  industry?: string;
  axes?: QuizAxis[];
  quizTitle?: string;
  ctaText?: string;
  active?: boolean;
  useAllProducts?: boolean;
  productIds?: string[];
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

export type ProductCreateInput = Omit<Product, "id" | "tenantId" | "embedding" | "createdAt" | "updatedAt" | "attributes"> & {
  attributes?: ProductAttributes;
};
export type ProductUpdateInput = Partial<ProductCreateInput>;

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
  abandoned: number;
  completionRate: number;
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
  cta: MetricsCTA;
  feedback: { positive: number; negative: number };
  topProducts: MetricsTopProduct[];
  steps: MetricsStep[];
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
export type CatalogField = Exclude<keyof ProductCreateInput, "attributes"> | `attribute.${string}`;

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
