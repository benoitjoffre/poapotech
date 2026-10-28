import { Router } from "express";
import { prisma } from "../lib/prisma";
import { verifyToken, type AuthRequest } from "../middleware/auth";
import { subscriptionOverview } from "../services/entitlements";
import { asyncRoute, QuizError } from "../services/quizzes";

// Lecture seule : un commerçant ne peut pas modifier son plan (voir PUT /api/admin/tenants/:id/subscription).
const router = Router();

router.get("/", verifyToken, asyncRoute(async (req: AuthRequest, res) => {
  const tenantId = req.tenant!.tenantId;
  if (!(await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }))) throw new QuizError(404, "Boutique introuvable");
  res.json(await subscriptionOverview(tenantId));
}));

export default router;
