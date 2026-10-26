import { prisma } from "../lib/prisma";

export interface StepRow { step: string; type: string; count: number }
export interface VariantRow { variant: string; type: string; count: number }
export interface AbandonCounts { reliable: number; legacy: number }

export interface Indicator {
  value: number | null;
  reliable: boolean;
  reason: string | null;
}

export interface MetricIndicators {
  /** Compteurs d'événements : un visiteur qui recommence est compté plusieurs fois. */
  started: number;
  completed: number;
  /** Sessions persistées côté serveur : source de vérité des recommandations générées. */
  recommendations: number;
  productClicks: number;
  completionRate: Indicator;
  /** Clics produits pour 100 recommandations : pas un taux par session (aucun identifiant de session sur buy_click). */
  clicksPer100Recommendations: Indicator;
  consistency: { completedMinusRecommendations: number; consistent: boolean };
}

const pct = (numerator: number, denominator: number): number => Math.round((numerator / denominator) * 1000) / 10;

// Les valeurs aberrantes ne sont jamais plafonnées : l'indicateur est masqué et la cause est indiquée.
export function computeIndicators(c: { started: number; completed: number; recommendations: number; productClicks: number }): MetricIndicators {
  let completionRate: Indicator;
  if (c.started === 0) {
    completionRate = { value: null, reliable: false, reason: "Aucun démarrage enregistré sur la période." };
  } else if (c.completed > c.started) {
    completionRate = {
      value: null, reliable: false,
      reason: "Plus de quiz terminés que de démarrages : événements de démarrage perdus ou période à cheval sur une version antérieure du widget.",
    };
  } else {
    completionRate = { value: pct(c.completed, c.started), reliable: true, reason: null };
  }
  const clicksPer100Recommendations: Indicator = c.recommendations === 0
    ? { value: null, reliable: false, reason: "Aucune recommandation générée sur la période." }
    : { value: pct(c.productClicks, c.recommendations), reliable: false, reason: "Les clics ne sont pas rattachés à une session : ratio indicatif, pas un taux de clic par session." };
  return {
    started: c.started, completed: c.completed, recommendations: c.recommendations, productClicks: c.productClicks,
    completionRate, clicksPer100Recommendations,
    consistency: { completedMinusRecommendations: c.completed - c.recommendations, consistent: c.completed === c.recommendations },
  };
}

export function buildSteps(rows: StepRow[]) {
  const byStep = new Map<string, { views: number; answers: number }>();
  for (const row of rows) {
    const entry = byStep.get(row.step) ?? { views: 0, answers: 0 };
    if (row.type === "step_view") entry.views += row.count;
    if (row.type === "step_answer") entry.answers += row.count;
    byStep.set(row.step, entry);
  }
  return [...byStep.entries()]
    .map(([step, { views, answers }]) => ({
      step, views, answers,
      dropOffRate: views > 0 ? Math.round(((views - answers) / views) * 100) : 0,
    }))
    .sort((a, b) => b.views - a.views || a.step.localeCompare(b.step));
}

export function buildVariants(rows: VariantRow[]) {
  const byVariant = new Map<string, { started: number; completed: number; clicks: number }>();
  for (const row of rows) {
    const entry = byVariant.get(row.variant) ?? { started: 0, completed: 0, clicks: 0 };
    if (row.type === "quiz_start") entry.started += row.count;
    if (row.type === "quiz_complete") entry.completed += row.count;
    if (row.type === "buy_click") entry.clicks += row.count;
    byVariant.set(row.variant, entry);
  }
  return [...byVariant.entries()]
    .map(([variant, counts]) => ({
      variant, ...counts,
      completionRate: counts.started > 0 ? Math.round((counts.completed / counts.started) * 100) : 0,
      clickThroughRate: counts.completed > 0 ? Math.round((counts.clicks / counts.completed) * 100) : 0,
    }))
    .sort((a, b) => b.started - a.started || a.variant.localeCompare(b.variant));
}

// Agrégations PostgreSQL : aucune ligne de Metric n'est chargée en mémoire. Toujours filtrées par tenant ET quiz.
export function stepRows(tenantId: string, quizId: string, since: Date): Promise<StepRow[]> {
  return prisma.$queryRaw<StepRow[]>`
    SELECT COALESCE(payload->>'step', payload->>'questionId', 'unknown') AS step,
           "type"::text AS type, COUNT(*)::int AS count
    FROM "Metric"
    WHERE "tenantId" = ${tenantId} AND "quizId" = ${quizId} AND "createdAt" >= ${since}
      AND "type" IN ('step_view', 'step_answer')
    GROUP BY 1, 2
    LIMIT 400`;
}

export function variantRows(tenantId: string, quizId: string, since: Date): Promise<VariantRow[]> {
  return prisma.$queryRaw<VariantRow[]>`
    SELECT COALESCE(CASE WHEN jsonb_typeof(payload->'abVariant') = 'string' THEN NULLIF(btrim(payload->>'abVariant'), '') END, 'standard') AS variant,
           "type"::text AS type, COUNT(*)::int AS count
    FROM "Metric"
    WHERE "tenantId" = ${tenantId} AND "quizId" = ${quizId} AND "createdAt" >= ${since}
      AND "type" IN ('quiz_start', 'quiz_complete', 'buy_click')
    GROUP BY 1, 2
    LIMIT 400`;
}

// Les anciens quiz_abandon (émis à chaque changement de question) n'ont pas de `reason` : ils sont isolés, jamais réinterprétés.
export async function abandonCounts(tenantId: string, quizId: string, since: Date): Promise<AbandonCounts> {
  const rows = await prisma.$queryRaw<{ reliable: number; legacy: number }[]>`
    SELECT COUNT(*) FILTER (WHERE jsonb_typeof(payload->'reason') = 'string')::int AS reliable,
           COUNT(*) FILTER (WHERE jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string')::int AS legacy
    FROM "Metric"
    WHERE "tenantId" = ${tenantId} AND "quizId" = ${quizId} AND "createdAt" >= ${since} AND "type" = 'quiz_abandon'`;
  return { reliable: Number(rows[0]?.reliable ?? 0), legacy: Number(rows[0]?.legacy ?? 0) };
}
