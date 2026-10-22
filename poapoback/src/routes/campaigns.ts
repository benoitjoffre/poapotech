import { Router } from "express";
import type { RequestHandler } from "express";
import type { CampaignListResponse, CampaignOccasion, CampaignStatus } from "@poapo/types";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { SUPER_ADMIN_TENANT_ID, verifyToken } from "../middleware/auth";
import type { AuthRequest } from "../middleware/auth";
import { asyncRoute, QuizError, resolveQuiz } from "../services/quizzes";
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

router.use(verifyToken, requireTenant);
router.use("/:id/quiz-generation", quizGenerationRouter);

function tenantOf(req: AuthRequest) {
  return req.tenant!.tenantId;
}

async function activeProductCount(tenantId: string, campaigns: CampaignWithQuiz[]) {
  if (!campaigns.some((campaign) => campaign.quiz.useAllProducts)) return 0;
  return prisma.product.count({ where: { tenantId, active: true } });
}

async function respondWith(tenantId: string, campaign: CampaignWithQuiz) {
  return serializeCampaign(campaign, await activeProductCount(tenantId, [campaign]));
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
    const sort = queryString(req.query.sort, "sort") ?? "recent";

    if (search && search.length > CAMPAIGN_LIMITS.search) throw new QuizError(400, "Recherche trop longue");
    if (status && !CAMPAIGN_STATUSES.includes(status as CampaignStatus)) throw new QuizError(400, "Statut invalide");
    if (occasion && !CAMPAIGN_OCCASIONS.includes(occasion as CampaignOccasion)) throw new QuizError(400, "Occasion invalide");
    if (!Object.prototype.hasOwnProperty.call(SORTS, sort)) throw new QuizError(400, "Tri invalide");

    const filters: Prisma.CampaignWhereInput[] = [{ tenantId }];
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
      prisma.campaign.findMany({ where: { tenantId }, select: { status: true, startsAt: true, endsAt: true } }),
    ]);

    const counts: CampaignListResponse["counts"] = { total: all.length, DRAFT: 0, SCHEDULED: 0, ACTIVE: 0, PAUSED: 0, COMPLETED: 0 };
    for (const campaign of all) counts[effectiveStatus(campaign, now)] += 1;

    const products = await activeProductCount(tenantId, campaigns);
    res.json({ data: campaigns.map((campaign) => serializeCampaign(campaign, products, now)), counts } satisfies CampaignListResponse);
  }),
);

router.post(
  "/",
  asyncRoute(async (req: AuthRequest, res) => {
    const tenantId = tenantOf(req);
    const input = parseCampaignInput(req.body, true);
    const quiz = await resolveQuiz(tenantId, input.quizId);
    const merged = {
      occasion: input.occasion!,
      occasionLabel: input.occasionLabel ?? null,
      status: input.status ?? "DRAFT",
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
    };
    assertCampaignConsistency(merged, quiz.active);

    const campaign = await prisma.campaign.create({
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
    const quiz = input.quizId !== undefined && input.quizId !== existing.quizId
      ? await resolveQuiz(tenantId, input.quizId)
      : existing.quiz;

    assertCampaignConsistency({
      occasion: input.occasion ?? existing.occasion,
      occasionLabel: input.occasionLabel !== undefined ? input.occasionLabel : existing.occasionLabel,
      status: input.status ?? existing.status,
      startsAt: input.startsAt !== undefined ? input.startsAt : existing.startsAt,
      endsAt: input.endsAt !== undefined ? input.endsAt : existing.endsAt,
    }, quiz.active);

    const campaign = await prisma.campaign.update({
      where: { id: existing.id },
      data: { ...input, ...(input.quizId !== undefined && { quizId: quiz.id }) },
      include: campaignInclude,
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
    const copy = await prisma.campaign.create({
      data: {
        tenantId,
        quizId: source.quizId,
        name: `${source.name.slice(0, CAMPAIGN_LIMITS.name - suffix.length)}${suffix}`,
        occasion: source.occasion,
        occasionLabel: source.occasionLabel,
        description: source.description,
        objectives: source.objectives,
        imageUrl: source.imageUrl,
        status: "DRAFT",
        startsAt: null,
        endsAt: null,
      },
      include: campaignInclude,
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
    const { count } = await prisma.campaign.deleteMany({ where: { id: existing.id, tenantId, status: "DRAFT" } });
    if (count === 0) throw new QuizError(409, "Seules les campagnes en brouillon peuvent être supprimées");
    res.status(204).end();
  }),
);

export default router;
