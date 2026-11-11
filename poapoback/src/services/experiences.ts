import { Prisma } from "@prisma/client";
import type { ExperienceListItem, ExperiencesOverview, ExperienceStats } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { QuizError } from "./quizzes";

const PERIOD_DAYS = 30;

/** Synthèse de « Mes expériences » : un nombre constant de requêtes, quel que soit le nombre de quiz. */
export async function experiencesOverview(tenantId: string, now = new Date()): Promise<ExperiencesOverview> {
  const since = new Date(now.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return prisma.$transaction(async (db) => {
    const shop = await db.tenant.findUnique({ where: { id: tenantId }, select: { active: true } });
    if (!shop) throw new QuizError(404, "Boutique introuvable");
    const [quizzes, products, events, drafts] = await Promise.all([
      db.quiz.findMany({
        where: { tenantId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, name: true, quizTitle: true, industry: true, active: true, isDefault: true, useAllProducts: true,
          updatedAt: true, catalogId: true, occasion: true, occasionLabel: true, startsAt: true, endsAt: true, catalog: { select: { id: true, name: true } },
          _count: { select: {
            questions: { where: { active: true } },
            products: { where: { product: { active: true } } },
          } },
        },
      }),
      db.product.groupBy({ by: ["catalogId"], where: { tenantId, active: true }, _count: { _all: true } }),
      db.metric.groupBy({
        by: ["quizId", "type"],
        where: { tenantId, createdAt: { gte: since, lte: now }, type: { in: ["quiz_start", "quiz_complete", "buy_click"] } },
        _count: { _all: true },
      }),
      // Draft metadata only: the editor document can be large.
      db.$queryRaw<{ quizId: string; updatedAt: Date }[]>`
        SELECT "quizId", "updatedAt" FROM "QuizEditorDraft"
        WHERE "tenantId" = ${tenantId} AND content IS NOT NULL AND content <> 'null'::jsonb`,
    ]);
    const activeProducts = new Map(products.map((group) => [group.catalogId, group._count._all]));
    const draftByQuiz = new Map(drafts.map((draft) => [draft.quizId, draft.updatedAt]));
    const stats = new Map<string, ExperienceStats>();
    for (const event of events) {
      const value = stats.get(event.quizId) ?? { started: 0, completed: 0, productClicks: 0 };
      if (event.type === "quiz_start") value.started += event._count._all;
      if (event.type === "quiz_complete") value.completed += event._count._all;
      if (event.type === "buy_click") value.productClicks += event._count._all;
      stats.set(event.quizId, value);
    }
    const experiences = quizzes.map((quiz): ExperienceListItem => {
      const productCount = quiz.useAllProducts ? activeProducts.get(quiz.catalogId) ?? 0 : quiz._count.products;
      const draftAt = draftByQuiz.get(quiz.id) ?? null;
      const lastModified = draftAt && draftAt > quiz.updatedAt ? draftAt : quiz.updatedAt;
      return {
        id: quiz.id, name: quiz.name, quizTitle: quiz.quizTitle, industry: quiz.industry, isDefault: quiz.isDefault,
        catalog: quiz.catalog, accessible: shop.active && quiz.active, questionCount: quiz._count.questions,
        hasDraft: draftAt !== null, draftUpdatedAt: draftAt?.toISOString() ?? null,
        correction: !quiz._count.questions ? "Aucune question active."
          : !productCount ? "Aucun produit actif recommandable." : null,
        updatedAt: quiz.updatedAt.toISOString(), lastModifiedAt: lastModified.toISOString(),
        stats: stats.get(quiz.id) ?? null,
        occasion: quiz.occasion, occasionLabel: quiz.occasionLabel,
        startsAt: quiz.startsAt?.toISOString() ?? null, endsAt: quiz.endsAt?.toISOString() ?? null,
      };
    });
    return {
      shopActive: shop.active,
      period: { from: since.toISOString(), to: now.toISOString(), days: PERIOD_DAYS },
      experiences,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
