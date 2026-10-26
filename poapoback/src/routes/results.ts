import { Router } from "express";
import { verifyToken, SUPER_ADMIN_TENANT_ID, type AuthRequest } from "../middleware/auth";
import { asyncRoute, QuizError } from "../services/quizzes";
import { parseResultsFilters, resultsSummary } from "../services/results";
import { experienceDetail } from "../services/resultsDetail";

const router = Router();

function merchantTenant(req: AuthRequest): string {
  const tenant = req.tenant!;
  if (tenant.tenantId === SUPER_ADMIN_TENANT_ID || tenant.isSuperAdmin ||
      tenant.email.toLowerCase() === process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim()) {
    throw new QuizError(403, "Les résultats sont réservés aux boutiques");
  }
  return tenant.tenantId;
}

// GET /api/results/summary?from&to&quizId&catalogId
router.get("/summary", verifyToken, asyncRoute(async (req: AuthRequest, res) => {
  const tenantId = merchantTenant(req);
  res.setHeader("Cache-Control", "no-store");
  res.json(await resultsSummary(tenantId, parseResultsFilters(req.query)));
}));

// GET /api/results/experiences/:quizId?from&to
router.get("/experiences/:quizId", verifyToken, asyncRoute(async (req: AuthRequest, res) => {
  const tenantId = merchantTenant(req);
  res.setHeader("Cache-Control", "no-store");
  res.json(await experienceDetail(tenantId, String(req.params.quizId), parseResultsFilters(req.query)));
}));

export default router;
