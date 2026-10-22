import type { Campaign as CampaignDto, CampaignOccasion, CampaignStatus } from "@poapo/types";
import type { Prisma } from "@prisma/client";
import { QuizError } from "./quizzes";

export const CAMPAIGN_STATUSES = ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED"] as const satisfies readonly CampaignStatus[];
export const CAMPAIGN_OCCASIONS = [
  "CHRISTMAS", "VALENTINES_DAY", "SPRING", "MOTHERS_DAY", "BACK_TO_SCHOOL", "BLACK_FRIDAY", "PROMOTION", "PERMANENT", "CUSTOM",
] as const satisfies readonly CampaignOccasion[];

export const CAMPAIGN_LIMITS = {
  name: 120,
  occasionLabel: 80,
  description: 1000,
  objectives: 10,
  objective: 200,
  imageUrl: 2048,
  search: 100,
} as const;

export const campaignInclude = {
  quiz: {
    select: {
      id: true,
      name: true,
      active: true,
      useAllProducts: true,
      _count: { select: { questions: { where: { active: true } }, products: { where: { product: { active: true } } } } },
    },
  },
} satisfies Prisma.CampaignInclude;

export type CampaignWithQuiz = Prisma.CampaignGetPayload<{ include: typeof campaignInclude }>;

type DatedCampaign = { status: CampaignStatus; startsAt: Date | null; endsAt: Date | null };

/**
 * Statut affiché. Seuls SCHEDULED et ACTIVE dépendent des dates : aucun job ne réécrit le statut enregistré.
 */
export function effectiveStatus(campaign: DatedCampaign, now = new Date()): CampaignStatus {
  if (campaign.status !== "SCHEDULED" && campaign.status !== "ACTIVE") return campaign.status;
  if (campaign.startsAt && now < campaign.startsAt) return "SCHEDULED";
  if (campaign.endsAt && now > campaign.endsAt) return "COMPLETED";
  return "ACTIVE";
}

/** Traduction de effectiveStatus en filtre Prisma, pour filtrer la liste côté base. */
export function effectiveStatusWhere(status: CampaignStatus, now = new Date()): Prisma.CampaignWhereInput {
  const dated: Prisma.CampaignWhereInput = { status: { in: ["SCHEDULED", "ACTIVE"] } };
  const started: Prisma.CampaignWhereInput = { OR: [{ startsAt: null }, { startsAt: { lte: now } }] };
  switch (status) {
    case "DRAFT":
    case "PAUSED":
      return { status };
    case "SCHEDULED":
      return { ...dated, startsAt: { gt: now } };
    case "ACTIVE":
      return { AND: [dated, started, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] };
    case "COMPLETED":
      return { OR: [{ status: "COMPLETED" }, { AND: [dated, started, { endsAt: { lt: now } }] }] };
  }
}

export interface CampaignData {
  quizId?: string;
  name?: string;
  occasion?: CampaignOccasion;
  occasionLabel?: string | null;
  description?: string | null;
  objectives?: string[];
  imageUrl?: string | null;
  status?: CampaignStatus;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

function optionalText(body: Record<string, unknown>, key: string, max: number, label: string): string | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new QuizError(400, `${label} doit être un texte`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new QuizError(400, `${label} ne doit pas dépasser ${max} caractères`);
  return trimmed || null;
}

function optionalDate(body: Record<string, unknown>, key: string, label: string): Date | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new QuizError(400, `${label} doit être une date ISO`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new QuizError(400, `${label} doit être une date valide`);
  return date;
}

/** Contrôle de forme : tenantId, id et dates techniques du corps sont ignorés. */
export function parseCampaignInput(raw: unknown, creating: boolean): CampaignData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new QuizError(400, "Données de campagne invalides");
  }
  const body = raw as Record<string, unknown>;
  const data: CampaignData = {};

  if (creating || body.quizId !== undefined) {
    if (typeof body.quizId !== "string" || !body.quizId.trim()) throw new QuizError(400, "Le quiz associé est requis");
    data.quizId = body.quizId.trim();
  }

  if (creating || body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) throw new QuizError(400, "Le nom de la campagne est requis");
    if (body.name.trim().length > CAMPAIGN_LIMITS.name) {
      throw new QuizError(400, `Le nom ne doit pas dépasser ${CAMPAIGN_LIMITS.name} caractères`);
    }
    data.name = body.name.trim();
  }

  if (creating || body.occasion !== undefined) {
    if (!CAMPAIGN_OCCASIONS.includes(body.occasion as CampaignOccasion)) throw new QuizError(400, "Occasion invalide");
    data.occasion = body.occasion as CampaignOccasion;
  }

  if (body.status !== undefined) {
    if (!CAMPAIGN_STATUSES.includes(body.status as CampaignStatus)) throw new QuizError(400, "Statut invalide");
    data.status = body.status as CampaignStatus;
  }

  data.occasionLabel = optionalText(body, "occasionLabel", CAMPAIGN_LIMITS.occasionLabel, "Le libellé de l'occasion");
  data.description = optionalText(body, "description", CAMPAIGN_LIMITS.description, "La description");
  data.imageUrl = optionalText(body, "imageUrl", CAMPAIGN_LIMITS.imageUrl, "L'URL de l'image");
  if (data.imageUrl) {
    let url: URL;
    try {
      url = new URL(data.imageUrl);
    } catch {
      throw new QuizError(400, "L'URL de l'image est invalide");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new QuizError(400, "L'URL de l'image doit commencer par http(s)://");
  }

  if (body.objectives !== undefined) {
    if (!Array.isArray(body.objectives) || body.objectives.some((item) => typeof item !== "string")) {
      throw new QuizError(400, "Les objectifs doivent être une liste de textes");
    }
    const objectives = (body.objectives as string[]).map((item) => item.trim()).filter(Boolean);
    if (objectives.length > CAMPAIGN_LIMITS.objectives) {
      throw new QuizError(400, `${CAMPAIGN_LIMITS.objectives} objectifs maximum`);
    }
    if (objectives.some((item) => item.length > CAMPAIGN_LIMITS.objective)) {
      throw new QuizError(400, `Chaque objectif est limité à ${CAMPAIGN_LIMITS.objective} caractères`);
    }
    data.objectives = objectives;
  }

  data.startsAt = optionalDate(body, "startsAt", "La date de début");
  data.endsAt = optionalDate(body, "endsAt", "La date de fin");

  for (const key of Object.keys(data) as (keyof CampaignData)[]) {
    if (data[key] === undefined) delete data[key];
  }
  return data;
}

/** Règles portant sur l'état final (création, ou campagne existante + modifications). */
export function assertCampaignConsistency(
  merged: { occasion: CampaignOccasion; occasionLabel: string | null; status: CampaignStatus; startsAt: Date | null; endsAt: Date | null },
  quizActive: boolean,
) {
  if (merged.occasion === "CUSTOM" && !merged.occasionLabel) {
    throw new QuizError(400, "Le libellé de l'occasion est requis pour une campagne personnalisée");
  }
  if (merged.startsAt && merged.endsAt && merged.endsAt <= merged.startsAt) {
    throw new QuizError(400, "La date de fin doit être postérieure à la date de début");
  }
  if (merged.status === "SCHEDULED" && !merged.startsAt) {
    throw new QuizError(400, "Une campagne programmée nécessite une date de début");
  }
  if ((merged.status === "SCHEDULED" || merged.status === "ACTIVE") && !quizActive) {
    throw new QuizError(400, "Le quiz associé est désactivé : activez-le avant de programmer ou lancer la campagne");
  }
}

export function serializeCampaign(campaign: CampaignWithQuiz, activeProductCount: number, now = new Date()): CampaignDto {
  const { quiz, ...rest } = campaign;
  return {
    ...rest,
    effectiveStatus: effectiveStatus(campaign, now),
    startsAt: campaign.startsAt?.toISOString() ?? null,
    endsAt: campaign.endsAt?.toISOString() ?? null,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
    quiz: {
      id: quiz.id,
      name: quiz.name,
      active: quiz.active,
      questionCount: quiz._count.questions,
      productCount: quiz.useAllProducts ? activeProductCount : quiz._count.products,
    },
  };
}
