import type { RequestHandler, ErrorRequestHandler, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";

export class QuizError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const quizInclude = { products: { select: { productId: true } } } satisfies Prisma.QuizInclude;
export type ScopedQuiz = Prisma.QuizGetPayload<{ include: typeof quizInclude }>;

export function quizDefaults(industry: string) {
  const titles: Record<string, string> = {
    perfume: "Trouve ton parfum idéal", coffee: "Trouve ton café idéal",
    fashion: "Trouve ton article de mode idéal", food: "Trouve ton produit alimentaire idéal",
    custom: "Trouve ton produit idéal",
  };
  return { quizTitle: titles[industry] ?? titles.custom, ctaText: industry === "perfume" ? "Commencer le quiz" : "Découvrir ma sélection" };
}

export async function ensureDefaultQuiz(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new QuizError(404, "Client introuvable");
  const defaults = quizDefaults(tenant.industry);
  return prisma.quiz.upsert({
    where: { id: `default_${tenantId}` },
    update: {},
    create: {
      id: `default_${tenantId}`, tenantId, isDefault: true, name: "Quiz par défaut",
      industry: tenant.industry,
      quizTitle: !tenant.quizTitle || (tenant.industry !== "perfume" && tenant.quizTitle === "Trouve ton parfum idéal")
        ? defaults.quizTitle : tenant.quizTitle,
      ctaText: !tenant.ctaText || (tenant.industry !== "perfume" && ["Voir ce parfum", "Commencer le quiz"].includes(tenant.ctaText))
        ? defaults.ctaText : tenant.ctaText,
    },
    include: quizInclude,
  });
}

export async function resolveQuiz(tenantId: string, quizId: unknown, publicOnly = false): Promise<ScopedQuiz> {
  if (quizId !== undefined && (typeof quizId !== "string" || !quizId.trim())) {
    throw new QuizError(400, "quizId invalide");
  }
  const quiz = quizId === undefined
    ? await ensureDefaultQuiz(tenantId)
    : await prisma.quiz.findFirst({ where: { id: quizId as string, tenantId }, include: quizInclude });
  if (!quiz) throw new QuizError(404, "Quiz introuvable");
  if (publicOnly) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { active: true } });
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
  resolveQuiz(clientId, quizId, true).then((quiz) => { res.locals.quiz = quiz; next(); }).catch(next);
};

export const adminQuizScope: RequestHandler = (req: AuthRequest, res, next) => {
  resolveQuiz(req.tenant!.tenantId, req.query.quizId)
    .then((quiz) => { res.locals.quiz = quiz; next(); }).catch(next);
};

export const quizErrorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof QuizError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("[api]", err);
  res.status(500).json({ error: "Erreur interne du serveur" });
};

export function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };
}
