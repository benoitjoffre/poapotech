import { AuthError } from "./auth0";
import type { RequestHandler, ErrorRequestHandler, Response } from "express";
import { Prisma } from "@prisma/client";
import type { QuizAxis } from "@poapo/types";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { ensureDefaultCatalog } from "./catalogs";

export class QuizError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "QuizError";
  }
}

export const quizInclude = {
  products: { select: { productId: true } },
  catalog: { select: { id: true, name: true } },
} satisfies Prisma.QuizInclude;
export type ScopedQuiz = Prisma.QuizGetPayload<{ include: typeof quizInclude }>;

const DEFAULT_QUIZ_TITLE = "Trouve ton produit idéal";
const DEFAULT_CTA_TEXT = "Découvrir ma sélection";

export function quizDefaults() {
  return { quizTitle: DEFAULT_QUIZ_TITLE, ctaText: DEFAULT_CTA_TEXT };
}

type QuizDb = Prisma.TransactionClient | typeof prisma;

export interface QuizCreateData {
  name: string;
  /** Catalogue du tenant déjà résolu par l'appelant. */
  catalogId: string;
  industry?: string;
  axes?: QuizAxis[];
  quizTitle?: string;
  ctaText?: string;
  active?: boolean;
  useAllProducts?: boolean;
  /** Identifiants déjà validés pour ce catalogue. */
  productIds?: string[];
}

/** Crée un quiz du tenant ; les champs texte doivent être validés par l'appelant. */
export function createQuiz(tenantId: string, input: QuizCreateData, db: QuizDb = prisma) {
  const defaults = quizDefaults();
  return db.quiz.create({
    data: {
      tenantId,
      catalogId: input.catalogId,
      name: input.name.trim(),
      industry: input.industry?.trim() ?? "",
      axes: (input.axes ?? []) as unknown as Prisma.InputJsonValue,
      quizTitle: input.quizTitle?.trim() ?? defaults.quizTitle,
      ctaText: input.ctaText?.trim() ?? defaults.ctaText,
      active: input.active ?? false,
      useAllProducts: input.useAllProducts ?? true,
      products: {
        create: (input.productIds ?? []).map((productId) => ({ productId })),
      },
    },
    include: quizInclude,
  });
}

export async function ensureDefaultQuiz(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new QuizError(404, "Client introuvable");
  const existing = await prisma.quiz.findUnique({ where: { id: `default_${tenantId}` }, include: quizInclude });
  if (existing) return existing;
  const catalog = await ensureDefaultCatalog(tenantId);
  const defaults = quizDefaults();
  return prisma.quiz.upsert({
    where: { id: `default_${tenantId}` },
    update: {},
    create: {
      id: `default_${tenantId}`,
      tenantId,
      catalogId: catalog.id,
      isDefault: true,
      active: false,
      name: "Quiz par défaut",
      industry: tenant.industry,
      quizTitle: tenant.quizTitle || defaults.quizTitle,
      ctaText: tenant.ctaText || defaults.ctaText,
    },
    include: quizInclude,
  });
}

export async function resolveQuiz(tenantId: string, quizId: unknown, publicOnly = false, db: QuizDb = prisma): Promise<ScopedQuiz> {
  if (quizId !== undefined && (typeof quizId !== "string" || !quizId.trim())) {
    throw new QuizError(400, "quizId invalide");
  }

  const quiz = quizId === undefined
    ? await ensureDefaultQuiz(tenantId)
    : await db.quiz.findFirst({ where: { id: quizId as string, tenantId }, include: quizInclude });

  if (!quiz) throw new QuizError(404, "Quiz introuvable");
  if (publicOnly) {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { active: true } });
    if (!tenant?.active || !quiz.active) throw new QuizError(403, "Ce quiz est désactivé");
  }
  return quiz;
}

export function getQuiz(res: Response): ScopedQuiz {
  return res.locals.quiz as ScopedQuiz;
}

export const publicQuizScope: RequestHandler = (req, res, next) => {
  const clientId = req.method === "GET" ? req.query.clientId : req.body?.clientId;
  const quizId = req.method === "GET" ? req.query.quizId : req.body?.quizId;
  if (typeof clientId !== "string" || !clientId.trim()) {
    next(new QuizError(400, "clientId manquant"));
    return;
  }

  resolveQuiz(clientId, quizId, true)
    .then((quiz) => {
      res.locals.quiz = quiz;
      next();
    })
    .catch(next);
};

export const adminQuizScope: RequestHandler = (req: AuthRequest, res, next) => {
  resolveQuiz(req.tenant!.tenantId, req.query.quizId)
    .then((quiz) => {
      res.locals.quiz = quiz;
      next();
    })
    .catch(next);
};

export const quizErrorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof QuizError) {
    res.status(err.status).json({ error: err.message, ...("diagnostic" in err && { diagnostic: err.diagnostic }) });
    return;
  }
  if (err instanceof AuthError) {
    res.status(err.status).json({ error: err.message, ...(err.code && { code: err.code }) });
    return;
  }
  // Clé étrangère composite refusée par PostgreSQL (ex. catalogues mélangés lors d'une écriture concurrente).
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
    res.status(409).json({ error: "Opération refusée : elle associerait des éléments de catalogues différents ou encore utilisés" });
    return;
  }
  console.error("[api]", err);
  res.status(500).json({ error: "Erreur interne du serveur" });
};

export function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
