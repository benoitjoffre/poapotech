import { Router } from "express";
import type { ExpressProposal } from "@poapo/types";
import { verifyToken } from "../middleware/auth";
import type { AuthRequest } from "../middleware/auth";
import {
  loadExpressContext,
  parseExpressOptions,
  previewExpressDraft,
  proposeExpressQuiz,
  saveExpressDraft,
  validateExpressDraft,
} from "../services/expressQuiz";
import { asyncRoute, QuizError } from "../services/quizzes";

const router = Router();
router.use(verifyToken);

function body(req: AuthRequest): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw new QuizError(400, "Corps de requête invalide");
  return req.body as Record<string, unknown>;
}

// POST /analyze — analyse le catalogue et propose un brouillon ; aucune écriture
router.post("/analyze", asyncRoute(async (req: AuthRequest, res) => {
  const input = body(req);
  const context = await loadExpressContext(req.tenant!.tenantId, input.catalogId);
  const proposal: ExpressProposal = proposeExpressQuiz(context, parseExpressOptions(input));
  res.setHeader("Cache-Control", "no-store");
  res.json(proposal);
}));

// POST /validate — revalide un brouillon modifié ; aucune écriture
router.post("/validate", asyncRoute(async (req: AuthRequest, res) => {
  const input = body(req);
  const context = await loadExpressContext(req.tenant!.tenantId, input.catalogId);
  res.json(validateExpressDraft(input.draft, context).validation);
}));

// POST /preview — recommandations réelles pour des réponses choisies ; aucune écriture
router.post("/preview", asyncRoute(async (req: AuthRequest, res) => {
  res.json(await previewExpressDraft(req.tenant!.tenantId, body(req)));
}));

// POST /save — enregistre une expérience inactive (jamais publiée)
router.post("/save", asyncRoute(async (req: AuthRequest, res) => {
  res.status(201).json(await saveExpressDraft(req.tenant!.tenantId, body(req)));
}));

export default router;
