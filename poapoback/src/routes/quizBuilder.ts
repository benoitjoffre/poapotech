import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { verifyToken, AuthRequest } from "../middleware/auth";
import multer from "multer";
import csvParser from "csv-parser";
import { Readable } from "stream";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isCSV =
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.mimetype === "text/plain" ||
      file.originalname.toLowerCase().endsWith(".csv");
    if (isCSV) cb(null, true);
    else cb(new Error("Seuls les fichiers CSV sont acceptes") as unknown as null, false);
  },
});

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

function parseBool(raw: unknown, fallback = true): boolean {
  if (raw === undefined || raw === null) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) return fallback;
  return ["true", "1", "yes", "oui", "y"].includes(normalized);
}

function parseQuestionType(raw: unknown): "single" | "multi" | "scale" {
  const type = String(raw ?? "").trim().toLowerCase();
  if (type === "multi" || type === "scale") return type;
  return "single";
}

function parseCSVBuffer(buffer: Buffer): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];
    Readable.from([buffer])
      .pipe(csvParser())
      .on("data", (row: Record<string, string>) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

async function resolveTenantId(req: AuthRequest, preferredTenantEmail?: string): Promise<string> {
  const tokenTenantId = req.tenant!.tenantId;
  const tenantFromToken = await prisma.tenant.findUnique({ where: { id: tokenTenantId }, select: { id: true } });
  if (tenantFromToken) return tenantFromToken.id;

  const email = (preferredTenantEmail ?? req.tenant!.email).toLowerCase().trim();
  const tenantByEmail = await prisma.tenant.findUnique({ where: { email }, select: { id: true } });
  if (!tenantByEmail) {
    throw new Error(`Aucun tenant trouve pour ${email}`);
  }
  return tenantByEmail.id;
}

// POST /api/quiz/builder/questions/import-csv
// Colonnes attendues: question, answer
// Colonnes optionnelles: helpText, type, questionActive, abVariant, emoji, freshness, intensity, sweetness, answerActive
router.post("/questions/import-csv", upload.single("file"), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "Fichier CSV requis" });
    return;
  }

  try {
    const tenantEmail = typeof req.body?.tenantEmail === "string" ? req.body.tenantEmail : undefined;
    const tenantId = await resolveTenantId(req, tenantEmail);
    const rows = await parseCSVBuffer(req.file.buffer);

    if (rows.length === 0) {
      res.status(400).json({ error: "CSV vide" });
      return;
    }

    type Group = {
      question: string;
      helpText: string | null;
      type: "single" | "multi" | "scale";
      active: boolean;
      abVariant: string | null;
      answers: Record<string, string>[];
    };

    const groups = new Map<string, Group>();
    let skippedRows = 0;

    for (const row of rows) {
      const question = String(row.question ?? "").trim();
      const answer = String(row.answer ?? "").trim();
      if (!question || !answer) {
        skippedRows++;
        continue;
      }

      const helpText = String(row.helpText ?? "").trim();
      const type = parseQuestionType(row.type);
      const active = parseBool(row.questionActive, true);
      const abVariant = String(row.abVariant ?? "").trim();
      const key = `${question}||${type}||${helpText}||${abVariant}`;

      if (!groups.has(key)) {
        groups.set(key, {
          question,
          helpText: helpText || null,
          type,
          active,
          abVariant: abVariant || null,
          answers: [],
        });
      }
      groups.get(key)!.answers.push(row);
    }

    if (groups.size === 0) {
      res.status(400).json({ error: "Aucune ligne valide (colonnes requises: question, answer)" });
      return;
    }

    const maxOrder = await prisma.question.aggregate({ where: { tenantId }, _max: { order: true } });
    let nextOrder = (maxOrder._max.order ?? -1) + 1;

    let createdQuestions = 0;
    let createdAnswers = 0;

    await prisma.$transaction(async (tx) => {
      for (const group of groups.values()) {
        const createdQuestion = await tx.question.create({
          data: {
            tenantId,
            text: group.question,
            helpText: group.helpText,
            type: group.type,
            active: group.active,
            abVariant: group.abVariant,
            order: nextOrder++,
          },
        });
        createdQuestions++;

        let answerOrder = 0;
        for (const answerRow of group.answers) {
          const text = String(answerRow.answer ?? "").trim();
          if (!text) continue;

          await tx.answer.create({
            data: {
              questionId: createdQuestion.id,
              text,
              emoji: String(answerRow.emoji ?? "").trim() || null,
              active: parseBool(answerRow.answerActive, true),
              order: answerOrder++,
              impacts: {
                freshness: clamp(Number(String(answerRow.freshness ?? "0").replace(",", "."))),
                intensity: clamp(Number(String(answerRow.intensity ?? "0").replace(",", "."))),
                sweetness: clamp(Number(String(answerRow.sweetness ?? "0").replace(",", "."))),
              },
            },
          });
          createdAnswers++;
        }
      }
    });

    res.json({
      createdQuestions,
      createdAnswers,
      skippedRows,
      tenantId,
      totalRows: rows.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur import CSV";
    res.status(400).json({ error: message });
  }
});

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
