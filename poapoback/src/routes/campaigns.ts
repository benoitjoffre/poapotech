import { Router } from "express";
import type { RequestHandler } from "express";
import type { CampaignListResponse, CampaignOccasion, CampaignStatus } from "@poapo/types";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { SUPER_ADMIN_TENANT_ID, verifyToken } from "../middleware/auth";
import { requireFeature } from "../services/entitlements";
import type { AuthRequest } from "../middleware/auth";
import { asyncRoute, QuizError, quizInclude, resolveQuiz } from "../services/quizzes";
import {
  assertCampaignConsistency,
  CAMPAIGN_LIMITS,
  CAMPAIGN_OCCASIONS,
  CAMPAIGN_STATUSES,
  campaignInclude,
  effectiveStatus,
  effectiveStatusWhere,
  parseCampaignInput,
  serializeCampaign,
} from "../services/campaigns";
import type { CampaignWithQuiz } from "../services/campaigns";
import quizGenerationRouter from "./quizGeneration";
import { lockQuiz } from "../services/quizPublication";
import { assertPublishedQuizValid } from "../services/quizPublicationDiagnostic";

const router = Router();

const SORTS = {
  recent: [{ createdAt: "desc" }],
  oldest: [{ createdAt: "asc" }],
  startsAt: [{ startsAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
  name: [{ name: "asc" }],
} satisfies Record<string, Prisma.CampaignOrderByWithRelationInput[]>;

// Un token super-admin sans tenant homonyme n'a pas de catalogue : il ne peut pas gérer de campagnes.
const requireTenant: RequestHandler = (req: AuthRequest, _res, next) => {
  const tenantId = req.tenant?.tenantId;
  if (!tenantId || tenantId === SUPER_ADMIN_TENANT_ID) {
    next(new QuizError(403, "Aucun espace client associé à ce compte"));
    return;
  }
  next();
};

router.use(verifyToken, requireTenant, requireFeature("campaigns"));
router.use("/:id/quiz-generation", quizGenerationRouter);

function tenantOf(req: AuthRequest) {
  return req.tenant!.tenantId;
}

/** Produits actifs par catalogue, uniquement pour les catalogues des quiz « tous les produits ». */
async function activeProductsByCatalog(tenantId: string, campaigns: CampaignWithQuiz[]): Promise<Map<string, number>> {
  const catalogIds = [...new Set(campaigns.filter((c) => c.quiz.useAllProducts).map((c) => c.quiz.catalogId))];
  if (!catalogIds.length) return new Map();
  const groups = await prisma.product.groupBy({
    by: ["catalogId"],
    where: { tenantId, active: true, catalogId: { in: catalogIds } },
    _count: { _all: true },
  });
  return new Map(groups.map((group) => [group.catalogId, group._count._all]));
}

async function respondWith(tenantId: string, campaign: CampaignWithQuiz) {
  return serializeCampaign(campaign, await activeProductsByCatalog(tenantId, [campaign]));
}

async function findCampaign(tenantId: string, id: unknown) {
  if (typeof id !== "string" || !id) throw new QuizError(404, "Campagne introuvable");
  const campaign = await prisma.campaign.findFirst({ where: { id, tenantId }, include: campaignInclude });
  if (!campaign) throw new QuizError(404, "Campagne introuvable");
  return campaign;
}

function queryString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new QuizError(400, `Paramètre ${label} invalide`);
  return value;
}

router.get(
  "/",
  asyncRoute(async (req: AuthRequest, res) => {
    const tenantId = tenantOf(req);
    const now = new Date();
    const search = queryString(req.query.search, "search")?.trim();
    const status = queryString(req.query.status, "status");
    const occasion = queryString(req.query.occasion, "occasion");
    const quizId = queryString(req.query.quizId, "quizId");
    const catalogId = queryString(req.query.catalogId, "catalogId");
    const sort = queryString(req.query.sort, "sort") ?? "recent";

    if (search && search.length > CAMPAIGN_LIMITS.search) throw new QuizError(400, "Recherche trop longue");
    if (status && !CAMPAIGN_STATUSES.includes(status as CampaignStatus)) throw new QuizError(400, "Statut invalide");
    if (occasion && !CAMPAIGN_OCCASIONS.includes(occasion as CampaignOccasion)) throw new QuizError(400, "Occasion invalide");
    if (!Object.prototype.hasOwnProperty.call(SORTS, sort)) throw new QuizError(400, "Tri invalide");

    // Le catalogue délimite l'espace de travail : il s'applique aussi aux compteurs par statut.
    const scope: Prisma.CampaignWhereInput = { tenantId, ...(catalogId && { quiz: { catalogId } }) };
    const filters: Prisma.CampaignWhereInput[] = [scope];
    if (status) filters.push(effectiveStatusWhere(status as CampaignStatus, now));
    if (occasion) filters.push({ occasion: occasion as CampaignOccasion });
    if (quizId) filters.push({ quizId });
    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { occasionLabel: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    const [campaigns, all] = await Promise.all([
      prisma.campaign.findMany({ where: { AND: filters }, include: campaignInclude, orderBy: SORTS[sort as keyof typeof SORTS] }),
      prisma.campaign.findMany({ where: scope, select: { status: true, startsAt: true, endsAt: true } }),
    ]);

    const counts: CampaignListResponse["counts"] = { total: all.length, DRAFT: 0, SCHEDULED: 0, ACTIVE: 0, PAUSED: 0, COMPLETED: 0 };
    for (const campaign of all) counts[effectiveStatus(campaign, now)] += 1;

    const products = await activeProductsByCatalog(tenantId, campaigns);
    res.json({ data: campaigns.map((campaign) => serializeCampaign(campaign, products, now)), counts } satisfies CampaignListResponse);
  }),
);

router.post(
  "/",
  asyncRoute(async (req: AuthRequest, res) => {
    const tenantId = tenantOf(req);
    const input = parseCampaignInput(req.body, true);
    const selected = await resolveQuiz(tenantId, input.quizId);
    const merged = {
      occasion: input.occasion!,
      occasionLabel: input.occasionLabel ?? null,
      status: input.status ?? "DRAFT",
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
    };
    const campaign = await prisma.$transaction(async (db) => {
      const quiz = await lockQuiz(db, tenantId, selected.id);
      assertCampaignConsistency(merged, quiz.active);
      if (merged.status === "ACTIVE" || merged.status === "SCHEDULED") await assertPublishedQuizValid(quiz, db);
      return db.campaign.create({
      data: {
        ...input,
        ...merged,
        tenantId,
        quizId: quiz.id,
        name: input.name!,
        objectives: input.objectives ?? [],
      },
      include: campaignInclude,
    });
    });
    res.status(201).json(await respondWith(tenantId, campaign));
  }),
);

router.get(
  "/:id",
  asyncRoute(async (req: AuthRequest, res) => {
    const tenantId = tenantOf(req);
    res.json(await respondWith(tenantId, await findCampaign(tenantId, req.params.id)));
  }),
);

router.put(
  "/:id",
  asyncRoute(async (req: AuthRequest, res) => {
    const tenantId = tenantOf(req);
    const input = parseCampaignInput(req.body, false);
    const existing = await findCampaign(tenantId, req.params.id);
    const campaign = await prisma.$transaction(async (db) => {
      const targetQuizId = input.quizId ?? existing.quizId;
      for (const id of [...new Set([existing.quizId, targetQuizId])].sort()) await lockQuiz(db, tenantId, id);
      const current = await db.campaign.findFirst({ where: { id: existing.id, tenantId }, include: campaignInclude });
      if (!current || current.quizId !== existing.quizId) throw new QuizError(409, "La campagne a changé ; rechargez-la");
      const quiz = await db.quiz.findFirstOrThrow({ where: { id: targetQuizId, tenantId }, include: quizInclude });
      const merged = {
        occasion: input.occasion ?? current.occasion,
        occasionLabel: input.occasionLabel !== undefined ? input.occasionLabel : current.occasionLabel,
        status: input.status ?? current.status,
        startsAt: input.startsAt !== undefined ? input.startsAt : current.startsAt,
        endsAt: input.endsAt !== undefined ? input.endsAt : current.endsAt,
      };
      assertCampaignConsistency(merged, quiz.active);
      if (merged.status === "ACTIVE" || merged.status === "SCHEDULED") await assertPublishedQuizValid(quiz, db);
      return db.campaign.update({
        where: { id: existing.id },
        data: { ...input, ...(input.quizId !== undefined && { quizId: quiz.id }) },
        include: campaignInclude,
      });
    });
    res.json(await respondWith(tenantId, campaign));
  }),
);

router.post(
  "/:id/duplicate",
  asyncRoute(async (req: AuthRequest, res) => {
    const tenantId = tenantOf(req);
    const source = await findCampaign(tenantId, req.params.id);
    const suffix = " (copie)";
    const copy = await prisma.$transaction(async (db) => {
      await lockQuiz(db, tenantId, source.quizId);
      return db.campaign.create({
        data: {
          tenantId, quizId: source.quizId,
          name: `${source.name.slice(0, CAMPAIGN_LIMITS.name - suffix.length)}${suffix}`,
          occasion: source.occasion, occasionLabel: source.occasionLabel,
          description: source.description, objectives: source.objectives, imageUrl: source.imageUrl,
          status: "DRAFT", startsAt: null, endsAt: null,
        },
        include: campaignInclude,
      });
    });
    res.status(201).json(await respondWith(tenantId, copy));
  }),
);

router.delete(
  "/:id",
  asyncRoute(async (req: AuthRequest, res) => {
    const tenantId = tenantOf(req);
    const existing = await findCampaign(tenantId, req.params.id);
    if (existing.status !== "DRAFT") throw new QuizError(409, "Seules les campagnes en brouillon peuvent être supprimées");
    const { count } = await prisma.$transaction(async (db) => {
      await lockQuiz(db, tenantId, existing.quizId);
      return db.campaign.deleteMany({ where: { id: existing.id, tenantId, status: "DRAFT" } });
    });
    if (count === 0) throw new QuizError(409, "Seules les campagnes en brouillon peuvent être supprimées");
    res.status(204).end();
  }),
);

export default router;
