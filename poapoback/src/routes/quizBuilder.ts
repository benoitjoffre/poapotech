import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { verifyToken, AuthRequest } from "../middleware/auth";

const router = Router();

// Toutes les routes sont protégées
router.use(verifyToken);

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseScoringImpacts(raw: unknown): { freshness: number; intensity: number; sweetness: number } {
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    return {
      freshness: clamp(Number(obj.freshness ?? 0)),
      intensity: clamp(Number(obj.intensity ?? 0)),
      sweetness: clamp(Number(obj.sweetness ?? 0)),
    };
  }
  return { freshness: 0, intensity: 0, sweetness: 0 };
}

function clamp(v: number, min = -1, max = 1): number {
  if (isNaN(v)) return 0;
  return Math.max(min, Math.min(max, v));
}

// ─── Questions ──────────────────────────────────────────────────────────────

// GET /api/quiz/builder/questions — liste complète (actives + inactives)
router.get("/questions", async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;

  const questions = await prisma.question.findMany({
    where: { tenantId },
    orderBy: { order: "asc" },
    include: {
      answers: {
        orderBy: { order: "asc" },
      },
    },
  });

  res.json(questions);
});

// POST /api/quiz/builder/questions — créer une question
router.post("/questions", async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const { text, helpText, type, imageUrl, conditionAnswerId, abVariant } = req.body as {
    text?: string;
    helpText?: string;
    type?: string;
    imageUrl?: string;
    conditionAnswerId?: string | null;
    abVariant?: string | null;
  };

  if (!text?.trim()) {
    res.status(400).json({ error: "Le texte de la question est requis" });
    return;
  }

  const validTypes = ["single", "multi", "scale"];
  const questionType = validTypes.includes(type ?? "") ? (type as "single" | "multi" | "scale") : "single";

  // Calculer le prochain ordre
  const maxOrder = await prisma.question.aggregate({
    where: { tenantId },
    _max: { order: true },
  });

  // Valider conditionAnswerId si fourni
  if (conditionAnswerId) {
    const answer = await prisma.answer.findUnique({ where: { id: conditionAnswerId } });
    if (!answer) {
      res.status(400).json({ error: "conditionAnswerId invalide" });
      return;
    }
  }

  const question = await prisma.question.create({
    data: {
      tenantId,
      text: text.trim(),
      helpText: helpText?.trim() ?? null,
      type: questionType,
      imageUrl: imageUrl?.trim() ?? null,
      conditionAnswerId: conditionAnswerId ?? null,
      abVariant: abVariant?.trim() ?? null,
      order: (maxOrder._max.order ?? 0) + 1,
    },
    include: { answers: { orderBy: { order: "asc" } } },
  });

  res.status(201).json(question);
});

// PUT /api/quiz/builder/questions/:id — modifier une question
router.put("/questions/:id", async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const { id } = req.params;

  const existing = await prisma.question.findFirst({ where: { id, tenantId } });
  if (!existing) {
    res.status(404).json({ error: "Question introuvable" });
    return;
  }

  const { text, helpText, type, imageUrl, active, conditionAnswerId, abVariant } = req.body as {
    text?: string;
    helpText?: string | null;
    type?: string;
    imageUrl?: string | null;
    active?: boolean;
    conditionAnswerId?: string | null;
    abVariant?: string | null;
  };

  const validTypes = ["single", "multi", "scale"];

  // Valider conditionAnswerId si fourni
  if (conditionAnswerId) {
    const answer = await prisma.answer.findUnique({ where: { id: conditionAnswerId } });
    if (!answer) {
      res.status(400).json({ error: "conditionAnswerId invalide" });
      return;
    }
  }

  const updated = await prisma.question.update({
    where: { id },
    data: {
      ...(text?.trim() ? { text: text.trim() } : {}),
      ...(helpText !== undefined ? { helpText: helpText?.trim() ?? null } : {}),
      ...(type && validTypes.includes(type) ? { type: type as "single" | "multi" | "scale" } : {}),
      ...(imageUrl !== undefined ? { imageUrl: imageUrl?.trim() ?? null } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(conditionAnswerId !== undefined ? { conditionAnswerId: conditionAnswerId ?? null } : {}),
      ...(abVariant !== undefined ? { abVariant: abVariant?.trim() ?? null } : {}),
    },
    include: { answers: { orderBy: { order: "asc" } } },
  });

  res.json(updated);
});

// DELETE /api/quiz/builder/questions/:id
router.delete("/questions/:id", async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const { id } = req.params;

  const existing = await prisma.question.findFirst({ where: { id, tenantId } });
  if (!existing) {
    res.status(404).json({ error: "Question introuvable" });
    return;
  }

  await prisma.question.delete({ where: { id } });
  res.json({ ok: true });
});

// PUT /api/quiz/builder/questions/reorder — réordonner toutes les questions
router.put("/questions/reorder", async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const { order } = req.body as { order?: { id: string; order: number }[] };

  if (!Array.isArray(order)) {
    res.status(400).json({ error: "order[] requis" });
    return;
  }

  // Vérifier que toutes les questions appartiennent au tenant
  const ids = order.map((o) => o.id);
  const owned = await prisma.question.findMany({
    where: { id: { in: ids }, tenantId },
    select: { id: true },
  });
  if (owned.length !== ids.length) {
    res.status(403).json({ error: "Accès refusé pour certaines questions" });
    return;
  }

  await prisma.$transaction(order.map(({ id, order: ord }) => prisma.question.update({ where: { id }, data: { order: ord } })));

  res.json({ ok: true });
});

// ─── Answers ─────────────────────────────────────────────────────────────────

// POST /api/quiz/builder/questions/:questionId/answers
router.post("/questions/:questionId/answers", async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const { questionId } = req.params;

  const question = await prisma.question.findFirst({ where: { id: questionId, tenantId } });
  if (!question) {
    res.status(404).json({ error: "Question introuvable" });
    return;
  }

  const { text, emoji, imageUrl, impacts } = req.body as {
    text?: string;
    emoji?: string | null;
    imageUrl?: string | null;
    impacts?: { freshness?: number; intensity?: number; sweetness?: number };
  };

  if (!text?.trim()) {
    res.status(400).json({ error: "Le texte de la réponse est requis" });
    return;
  }

  const maxOrder = await prisma.answer.aggregate({
    where: { questionId },
    _max: { order: true },
  });

  const answer = await prisma.answer.create({
    data: {
      questionId,
      text: text.trim(),
      emoji: emoji?.trim() ?? null,
      imageUrl: imageUrl?.trim() ?? null,
      impacts: parseScoringImpacts(impacts ?? {}),
      order: (maxOrder._max.order ?? 0) + 1,
    },
  });

  res.status(201).json(answer);
});

// PUT /api/quiz/builder/answers/reorder-all (primary)
// PUT /api/quiz/builder/answers/reorder (legacy alias)
router.put(["/answers/reorder-all", "/answers/reorder"], async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const { order } = req.body as { order?: { id: string; order: number }[] };

  if (!Array.isArray(order)) {
    res.status(400).json({ error: "order[] requis" });
    return;
  }

  const ids = order.map((o) => o.id);
  const owned = await prisma.answer.findMany({
    where: { id: { in: ids }, question: { tenantId } },
    select: { id: true },
  });
  if (owned.length !== ids.length) {
    res.status(403).json({ error: "Accès refusé pour certaines réponses" });
    return;
  }

  await prisma.$transaction(order.map(({ id, order: ord }) => prisma.answer.update({ where: { id }, data: { order: ord } })));

  res.json({ ok: true });
});

// PUT /api/quiz/builder/answers/:id
router.put("/answers/:id", async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const { id } = req.params;

  // Vérifier appartenance via join question→tenant
  const existing = await prisma.answer.findFirst({
    where: { id, question: { tenantId } },
  });
  if (!existing) {
    res.status(404).json({ error: "Réponse introuvable" });
    return;
  }

  const { text, emoji, imageUrl, active, impacts } = req.body as {
    text?: string;
    emoji?: string | null;
    imageUrl?: string | null;
    active?: boolean;
    impacts?: { freshness?: number; intensity?: number; sweetness?: number };
  };

  const updated = await prisma.answer.update({
    where: { id },
    data: {
      ...(text?.trim() ? { text: text.trim() } : {}),
      ...(emoji !== undefined ? { emoji: emoji?.trim() ?? null } : {}),
      ...(imageUrl !== undefined ? { imageUrl: imageUrl?.trim() ?? null } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(impacts !== undefined ? { impacts: parseScoringImpacts(impacts) } : {}),
    },
  });

  res.json(updated);
});

// DELETE /api/quiz/builder/answers/:id
router.delete("/answers/:id", async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const { id } = req.params;

  const existing = await prisma.answer.findFirst({
    where: { id, question: { tenantId } },
  });
  if (!existing) {
    res.status(404).json({ error: "Réponse introuvable" });
    return;
  }

  await prisma.answer.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
