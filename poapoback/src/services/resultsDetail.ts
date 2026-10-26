import type { ResultsExperienceDetail, ResultsQuestionStat } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { QuizError } from "./quizzes";
import { buildVariants, type VariantRow } from "./quizMetrics";
import { countsByQuiz, dailyCounts, type ResultsFilters } from "./results";

type StepAnswerRow = { questionId: string; answerId: string | null; type: string; count: number };

/** Étapes et réponses de la période, groupées en SQL (aucune ligne brute chargée). */
function stepAnswerRows(tenantId: string, quizId: string, from: Date, to: Date): Promise<StepAnswerRow[]> {
  return prisma.$queryRaw<StepAnswerRow[]>`
    SELECT COALESCE(payload->>'questionId', payload->>'step', 'unknown') AS "questionId",
           CASE WHEN "type" = 'step_answer' THEN payload->>'answerId' END AS "answerId",
           "type"::text AS type, COUNT(*)::int AS count
    FROM "Metric"
    WHERE "tenantId" = ${tenantId} AND "quizId" = ${quizId}
      AND "createdAt" >= ${from} AND "createdAt" < ${to}
      AND "type" IN ('step_view', 'step_answer')
    GROUP BY 1, 2, 3
    LIMIT 2000`;
}

/** Libellés uniquement quand l'identifiant correspond à une question de ce quiz ; sinon l'étape est ignorée et comptée à part. */
export function buildQuestionStats(
  rows: StepAnswerRow[],
  questions: { id: string; text: string; answers: { id: string; text: string }[] }[],
): { questions: ResultsQuestionStat[]; unmatchedSteps: number } {
  const known = new Map(questions.map((q) => [q.id, q]));
  const stats = new Map<string, ResultsQuestionStat>();
  const unmatched = new Set<string>();
  for (const row of rows) {
    const question = known.get(row.questionId);
    if (!question) { unmatched.add(row.questionId); continue; }
    const entry = stats.get(question.id) ?? { questionId: question.id, label: question.text, views: 0, answers: 0, options: [] };
    if (row.type === "step_view") entry.views += row.count;
    if (row.type === "step_answer") {
      entry.answers += row.count;
      const answer = question.answers.find((a) => a.id === row.answerId);
      if (answer) entry.options.push({ answerId: answer.id, label: answer.text, count: row.count });
    }
    stats.set(question.id, entry);
  }
  for (const entry of stats.values()) entry.options.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const order = new Map(questions.map((q, index) => [q.id, index]));
  return {
    questions: [...stats.values()].sort((a, b) => (order.get(a.questionId) ?? 0) - (order.get(b.questionId) ?? 0)),
    unmatchedSteps: unmatched.size,
  };
}

export async function experienceDetail(tenantId: string, quizId: string, filters: ResultsFilters): Promise<ResultsExperienceDetail> {
  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId, tenantId },
    select: { id: true, name: true, catalogId: true, catalog: { select: { name: true } } },
  });
  if (!quiz) throw new QuizError(404, "Expérience introuvable");
  const { from, to } = filters;
  const [counts, daily, questions, steps, sessionTop, clicks, variants] = await Promise.all([
    countsByQuiz(tenantId, [quizId], from, to),
    dailyCounts(tenantId, [quizId], from, to),
    prisma.question.findMany({
      where: { tenantId, quizId }, orderBy: [{ order: "asc" }, { id: "asc" }], take: 100,
      select: { id: true, text: true, answers: { orderBy: [{ order: "asc" }, { id: "asc" }], take: 50, select: { id: true, text: true } } },
    }),
    stepAnswerRows(tenantId, quizId, from, to),
    prisma.quizSession.groupBy({
      by: ["resultProductId"],
      where: { tenantId, quizId, resultProductId: { not: null }, completedAt: { gte: from, lt: to } },
      _count: { _all: true }, orderBy: [{ _count: { resultProductId: "desc" } }, { resultProductId: "asc" }], take: 5,
    }),
    prisma.$queryRaw<{ productId: string; count: number }[]>`
      SELECT payload->>'productId' AS "productId", COUNT(*)::int AS count
      FROM "Metric"
      WHERE "tenantId" = ${tenantId} AND "quizId" = ${quizId} AND "type" = 'buy_click'
        AND "createdAt" >= ${from} AND "createdAt" < ${to} AND payload->>'productId' IS NOT NULL
      GROUP BY 1 ORDER BY count DESC, 1 LIMIT 5`,
    prisma.$queryRaw<VariantRow[]>`
      SELECT COALESCE(CASE WHEN jsonb_typeof(payload->'abVariant') = 'string' THEN NULLIF(btrim(payload->>'abVariant'), '') END, 'standard') AS variant,
             "type"::text AS type, COUNT(*)::int AS count
      FROM "Metric"
      WHERE "tenantId" = ${tenantId} AND "quizId" = ${quizId}
        AND "createdAt" >= ${from} AND "createdAt" < ${to}
        AND "type" IN ('quiz_start', 'quiz_complete', 'buy_click')
      GROUP BY 1, 2 LIMIT 400`,
  ]);
  const productIds = [...new Set([
    ...sessionTop.map((row) => row.resultProductId).filter((id): id is string => !!id),
    ...clicks.map((row) => row.productId),
  ])];
  const products = productIds.length
    ? await prisma.product.findMany({ where: { tenantId, id: { in: productIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(products.map((p) => [p.id, p.name]));
  const questionStats = buildQuestionStats(steps, questions);
  return {
    period: { from: from.toISOString(), to: to.toISOString(), days: filters.days },
    experience: { id: quiz.id, name: quiz.name, catalogId: quiz.catalogId, catalogName: quiz.catalog.name },
    totals: counts.get(quizId) ?? { started: 0, completed: 0, recommendations: 0, productClicks: 0 },
    daily,
    ...questionStats,
    topProducts: sessionTop.map((row) => ({
      productId: row.resultProductId, name: names.get(row.resultProductId ?? "") ?? "Produit supprimé", count: row._count._all,
    })),
    clickedProducts: clicks.map((row) => ({ productId: row.productId, name: names.get(row.productId) ?? "Produit supprimé", count: row.count })),
    variants: buildVariants(variants),
  };
}
