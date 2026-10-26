import { Router } from "express";
import { verifyToken, SUPER_ADMIN_TENANT_ID, type AuthRequest } from "../middleware/auth";
import { asyncRoute, QuizError } from "../services/quizzes";
import { experiencesOverview } from "../services/experiences";

const router = Router();
router.get("/", verifyToken, asyncRoute(async (req: AuthRequest, res) => {
  if (req.tenant!.tenantId === SUPER_ADMIN_TENANT_ID || req.tenant!.isSuperAdmin ||
      req.tenant!.email.toLowerCase() === process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim()) {
    throw new QuizError(403, "Les expériences sont réservées aux boutiques");
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(await experiencesOverview(req.tenant!.tenantId));
}));
export default router;
