import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { verifyToken, AuthRequest } from "../middleware/auth";

const router = Router();

/**
 * DELETE /api/metrics/cleanup
 * 
 * Nettoie les métriques selon les critères fournis.
 * Nécessite authentification super-admin.
 * 
 * Body:
 * - daysOld?: number — Nettoyer les métriques de plus de X jours (ex: 30)
 * - tenantId?: string — Nettoyer les métriques d'un tenant spécifique
 * - all?: boolean — Nettoyer TOUTES les métriques (doit être true)
 * 
 * Réponse:
 * {
 *   "deleted": number,
 *   "reason": string
 * }
 */
router.post("/cleanup", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    // Vérifier que l'utilisateur est super-admin
    if (req.tenant?.tenantId !== "super-admin") {
      return res.status(403).json({ error: "Accès refusé. Super-admin requis." });
    }

    const { daysOld, tenantId, all } = req.body;

    // Validation : au moins un paramètre requis
    if (!daysOld && !tenantId && !all) {
      return res.status(400).json({
        error: "Paramètre requis : daysOld, tenantId, ou all=true",
        example: { daysOld: 30 },
      });
    }

    // Sécurité : all doit être explicitement true
    if (all && all !== true) {
      return res.status(400).json({ error: "all doit être true pour confirmer" });
    }

    let deleted = 0;
    let reason = "";

    if (all) {
      // Supprimer TOUTES les métriques
      const result = await prisma.metric.deleteMany({});
      deleted = result.count;
      reason = "Toutes les métriques supprimées";
    } else if (tenantId) {
      // Supprimer les métriques d'un tenant spécifique
      const result = await prisma.metric.deleteMany({
        where: { tenantId },
      });
      deleted = result.count;
      reason = `Métriques du tenant ${tenantId} supprimées`;
    } else if (daysOld) {
      // Supprimer les métriques plus anciennes que X jours
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await prisma.metric.deleteMany({
        where: {
          createdAt: {
            lt: cutoffDate,
          },
        },
      });
      deleted = result.count;
      reason = `Métriques antérieures à ${cutoffDate.toISOString()} supprimées`;
    }

    res.json({
      message: "Nettoyage effectué",
      deleted,
      reason,
    });
  } catch (error) {
    console.error("[metrics.cleanup]", error);
    res.status(500).json({ error: "Erreur lors du nettoyage des métriques" });
  }
});

/**
 * GET /api/metrics/count
 * 
 * Affiche le nombre total de métriques.
 * Nécessite authentification.
 */
router.get("/count", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.metric.count();
    const countByTenant = await prisma.metric.groupBy({
      by: ["tenantId"],
      _count: true,
    });

    res.json({
      total: count,
      byTenant: countByTenant.map((item) => ({
        tenantId: item.tenantId,
        count: item._count,
      })),
    });
  } catch (error) {
    console.error("[metrics.count]", error);
    res.status(500).json({ error: "Erreur lors du comptage des métriques" });
  }
});

export default router;
