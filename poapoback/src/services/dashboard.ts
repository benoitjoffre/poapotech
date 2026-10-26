import { Prisma } from "@prisma/client";
import type { DashboardExperience, DashboardSummary } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { QuizError } from "./quizzes";

export function selectNextAction(experiences: DashboardExperience[]): DashboardSummary["nextAction"] {
  const drafts = experiences.filter((quiz) => quiz.hasDraft).sort((a, b) =>
    (b.draftUpdatedAt ?? "").localeCompare(a.draftUpdatedAt ?? "") || a.id.localeCompare(b.id));
  if (drafts[0]) return { kind: "draft", quizId: drafts[0].id };
  const correction = experiences.find((quiz) => quiz.correction !== null);
  return correction ? { kind: "correction", quizId: correction.id } : { kind: "create", quizId: null };
}

export async function dashboardSummary(tenantId: string, now = new Date()): Promise<DashboardSummary> {
  const days = 30;
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return prisma.$transaction(async (db) => {
    const shop = await db.tenant.findUnique({
      where: { id: tenantId }, select: { name: true, email: true, active: true },
    });
    if (!shop) throw new QuizError(404, "Boutique introuvable");
    const [quizzes, products, catalogs, events, drafts] = await Promise.all([
      db.quiz.findMany({
        where: { tenantId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, name: true, active: true, catalogId: true, useAllProducts: true,
          catalog: { select: { id: true, name: true } },
          _count: { select: {
            questions: { where: { active: true } },
            products: { where: { product: { active: true } } },
          } },
        },
      }),
      db.product.groupBy({
        by: ["catalogId", "active"], where: { tenantId }, _count: { _all: true },
      }),
      db.catalog.count({ where: { tenantId } }),
      db.metric.groupBy({
        by: ["quizId", "type"],
        where: { tenantId, createdAt: { gte: since, lte: now }, type: { in: ["quiz_start", "quiz_complete", "buy_click"] } },
        _count: { _all: true },
      }),
      // Fetch only draft metadata, never the potentially large editor document.
      db.$queryRaw<{ quizId: string; updatedAt: Date }[]>`
        SELECT "quizId", "updatedAt" FROM "QuizEditorDraft"
        WHERE "tenantId" = ${tenantId} AND content IS NOT NULL AND content <> 'null'::jsonb`,
    ]);
    const draftByQuiz = new Map(drafts.map((draft) => [draft.quizId, draft]));
    const activeProducts = new Map<string, number>();
    for (const group of products) if (group.active) activeProducts.set(group.catalogId, group._count._all);
    const counts = new Map<string, { started: number; completed: number; productClicks: number }>();
    for (const event of events) {
      const value = counts.get(event.quizId) ?? { started: 0, completed: 0, productClicks: 0 };
      if (event.type === "quiz_start") value.started += event._count._all;
      if (event.type === "quiz_complete") value.completed += event._count._all;
      if (event.type === "buy_click") value.productClicks += event._count._all;
      counts.set(event.quizId, value);
    }
    const experiences: DashboardExperience[] = quizzes.map((quiz) => {
      const productCount = quiz.useAllProducts ? activeProducts.get(quiz.catalogId) ?? 0 : quiz._count.products;
      return {
        id: quiz.id, name: quiz.name, catalog: quiz.catalog, accessible: shop.active && quiz.active,
        hasDraft: draftByQuiz.has(quiz.id), draftUpdatedAt: draftByQuiz.get(quiz.id)?.updatedAt.toISOString() ?? null,
        correction: !quiz._count.questions ? "Aucune question active."
          : !productCount ? "Aucun produit actif recommandable." : null,
        ...(counts.get(quiz.id) ?? { started: 0, completed: 0, productClicks: 0 }),
      };
    });
    return {
      shop, period: { from: since.toISOString(), to: now.toISOString(), days },
      totals: experiences.reduce((total, quiz) => ({
        started: total.started + quiz.started, completed: total.completed + quiz.completed,
        productClicks: total.productClicks + quiz.productClicks, accessible: total.accessible + Number(quiz.accessible),
      }), { started: 0, completed: 0, productClicks: 0, accessible: 0 }),
      products: products.reduce((total, group) => total + group._count._all, 0), catalogs, experiences,
      nextAction: selectNextAction(experiences),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
