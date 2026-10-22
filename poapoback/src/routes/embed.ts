import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncRoute, publicQuizScope, getQuiz } from "../services/quizzes";
import { parseAxes } from "../services/axes";

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

  // Vérification du domaine d'origine si embedDomain est configuré
  const origin = req.headers.origin ?? req.headers.referer ?? "";
  if (tenant.embedDomain && origin) {
    try {
      const originHost = new URL(origin).hostname;
      const allowedHost = new URL(tenant.embedDomain.startsWith("http") ? tenant.embedDomain : `https://${tenant.embedDomain}`).hostname;
      if (originHost !== allowedHost) {
        res.status(403).json({ error: "Domaine non autorisé" });
        return;
      }
    } catch {
      // URL mal formée — on laisse passer en dev
    }
  }

  const quiz = getQuiz(res);
  res.json({
    tenantId: tenant.id,
    quizId: quiz.id,
    industry: quiz.industry,
    axes: parseAxes(quiz.axes),
    primaryColor: tenant.primaryColor ?? "#0d9488",
    logoUrl: tenant.logoUrl,
    quizTitle: quiz.quizTitle,
    ctaText: quiz.ctaText,
    active: quiz.active,
  });
}));

export default router;
