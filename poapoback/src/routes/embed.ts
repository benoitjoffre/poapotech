import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncRoute, publicQuizScope, getQuiz } from "../services/quizzes";
import { isEmbedParentAllowed } from "../services/embedDomain";
import { parseAxes } from "../services/axes";
import { parseQuizTheme, resolveQuizTheme } from "@poapo/types";

const router = Router();

// GET /api/embed/config?clientId=
// Endpoint public — utilisé par le widget pour charger la config tenant
router.get("/config", publicQuizScope, asyncRoute(async (req: Request, res: Response) => {
  const { clientId } = req.query as { clientId?: string };
  if (!clientId) {
    res.status(400).json({ error: "clientId manquant" });
    return;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      industry: true,
      active: true,
      primaryColor: true,
      logoUrl: true,
      quizTitle: true,
      ctaText: true,
      embedDomain: true,
    },
  });

  if (!tenant) {
    res.status(404).json({ error: "Client introuvable" });
    return;
  }

  if (!tenant.active) {
    res.status(403).json({ error: "Ce compte est désactivé" });
    return;
  }

  // Site intégrateur déclaré par le widget (pas l'en-tête Origin, qui est celui de l'iframe). Voir services/embedDomain.ts.
  const parentOrigin = typeof req.query.parentOrigin === "string" ? req.query.parentOrigin : undefined;
  if (!isEmbedParentAllowed(tenant.embedDomain, parentOrigin)) {
    res.status(403).json({ error: "Domaine non autorisé" });
    return;
  }

  const quiz = getQuiz(res);
  const theme = parseQuizTheme(quiz.publishedTheme);
  const effective = resolveQuizTheme(tenant, theme);
  res.json({
    tenantId: tenant.id,
    tenantName: tenant.name,
    quizId: quiz.id,
    industry: quiz.industry,
    axes: parseAxes(quiz.axes),
    primaryColor: effective.primaryColor,
    logoUrl: effective.logoUrl,
    ...(theme && { theme }),
    quizTitle: quiz.quizTitle,
    ctaText: quiz.ctaText,
    active: quiz.active,
  });
}));

export default router;
