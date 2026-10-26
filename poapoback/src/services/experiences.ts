import { Prisma } from "@prisma/client";
import type { ExperienceListItem, ExperiencesOverview, ExperienceStats } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { QuizError } from "./quizzes";
import { effectiveStatus } from "./campaigns";

const PERIOD_DAYS = 30;

/** Synthèse de « Mes expériences » : un nombre constant de requêtes, quel que soit le nombre de quiz. */
export async function experiencesOverview(tenantId: string, now = new Date()): Promise<ExperiencesOverview> {
  const since = new Date(now.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return prisma.$transaction(async (db) => {
    const shop = await db.tenant.findUnique({ where: { id: tenantId }, select: { active: true } });
    if (!shop) throw new QuizError(404, "Boutique introuvable");
    const [quizzes, products, campaigns, events, drafts] = await Promise.all([
      db.quiz.findMany({
        where: { tenantId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, name: true, quizTitle: true, industry: true, active: true, isDefault: true, useAllProducts: true,
          updatedAt: true, catalogId: true, catalog: { select: { id: true, name: true } },
          _count: { select: {
            questions: { where: { active: true } },
            products: { where: { product: { active: true } } },
          } },
        },
      }),
      db.product.groupBy({ by: ["catalogId"], where: { tenantId, active: true }, _count: { _all: true } }),
      db.campaign.findMany({
        where: { tenantId }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        select: {
          id: true, quizId: true, name: true, status: true, occasion: true, occasionLabel: true,
          startsAt: true, endsAt: true, updatedAt: true,
        },
      }),
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
    const campaignsByQuiz = new Map<string, ExperienceListItem["campaigns"]>();
    for (const campaign of campaigns) {
      const list = campaignsByQuiz.get(campaign.quizId) ?? [];
      list.push({
        id: campaign.id, name: campaign.name, status: campaign.status, effectiveStatus: effectiveStatus(campaign, now),
        occasion: campaign.occasion, occasionLabel: campaign.occasionLabel,
        startsAt: campaign.startsAt?.toISOString() ?? null, endsAt: campaign.endsAt?.toISOString() ?? null,
        updatedAt: campaign.updatedAt.toISOString(),
      });
      campaignsByQuiz.set(campaign.quizId, list);
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
        stats: stats.get(quiz.id) ?? null, campaigns: campaignsByQuiz.get(quiz.id) ?? [],
      };
    });
    return {
      shopActive: shop.active,
      period: { from: since.toISOString(), to: now.toISOString(), days: PERIOD_DAYS },
      experiences,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
