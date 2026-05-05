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
  primaryColor?: string;
  logoUrl?: string;
  quizTitle?: string;
  ctaText?: string;
  embedDomain?: string;
}

export interface EmbedConfig {
  tenantId: string;
  primaryColor: string;
  logoUrl: string | null;
  quizTitle: string;
  ctaText: string;
  active: boolean;
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
export type GenderTarget = "male" | "female" | "unisex";
export type PriceTier = "entry" | "mid" | "luxury" | "niche";
export type Concentration = "EDT" | "EDP" | "Parfum" | "EDC" | "other";
export type Season = "spring" | "summer" | "autumn" | "winter";
export type Occasion = "daily" | "evening" | "office" | "sport" | "special";
export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export interface Product {
  id: string;
  tenantId: string;
  // Identity
  name: string;
  brand: string | null;
  description: string | null;
  price: number | null;
  priceTier: PriceTier | null;
  imageUrl: string | null;
  purchaseUrl: string | null;
  concentration: Concentration | null;
  active: boolean;
  featured: boolean;
  // Olfactory pyramid
  topNotes: string[];
  heartNotes: string[];
  baseNotes: string[];
  // Classification
  olfactoryFamily: string | null;
  subFamily: string | null;
  genderTarget: GenderTarget | null;
  tags: string[];
  // Numeric axes [0–1]
  freshness: number | null;
  intensity: number | null;
  sweetness: number | null;
  // Usage context
  seasons: Season[];
  occasions: Occasion[];
  timeOfDay: TimeOfDay[];
  // AI
  embedding: number[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ProductCreateInput = Omit<Product, "id" | "tenantId" | "embedding" | "createdAt" | "updatedAt">;
export type ProductUpdateInput = Partial<ProductCreateInput>;

// ─────────────────────────────────────────────
// Quiz — Questions & Answers
// ─────────────────────────────────────────────
export type QuestionType = "single" | "multi" | "scale";

export interface AnswerImpact {
  freshness: number;
  intensity: number;
  sweetness: number;
}

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
  gender: GenderTarget | null;
  mood: string | null;
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
  gender: GenderTarget | null;
  mood: string | null;
  answers: SessionAnswer[];
  decisionTime?: number;
}

export interface QuizResult {
  product: Pick<
    Product,
    | "id"
    | "name"
    | "brand"
    | "imageUrl"
    | "purchaseUrl"
    | "freshness"
    | "intensity"
    | "sweetness"
    | "olfactoryFamily"
    | "tags"
    | "topNotes"
    | "heartNotes"
    | "baseNotes"
    | "price"
    | "priceTier"
    | "concentration"
    | "description"
    | "genderTarget"
  >;
  explanation: string[];
  profileSummary: ProfileSummary;
}

// ─────────────────────────────────────────────
// AI — User Profile
// ─────────────────────────────────────────────
export interface OlfactoryProfile {
  freshness: number;
  intensity: number;
  sweetness: number;
}

export interface ProfileSummary {
  freshnessLevel: "faible" | "modéré" | "élevé";
  intensityLevel: "faible" | "modéré" | "élevé";
  sensualityLevel: "peu doux" | "doux" | "très doux";
  usageMoment: "quotidien" | "soirée" | "occasion";
  univers: string[];
}

// ─────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────
export type MetricType = "quiz_start" | "quiz_complete" | "quiz_abandon" | "step_view" | "step_answer" | "buy_click" | "feedback" | "decision_time";

export interface Metric {
  id: string;
  tenantId: string;
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
  genders: { gender: string; count: number }[];
  steps: MetricsStep[];
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
export type CatalogField = keyof ProductCreateInput;

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
