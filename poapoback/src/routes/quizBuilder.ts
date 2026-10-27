import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import csvParser from "csv-parser";
import { detectCsvSeparator } from "../services/csv";
import { Readable } from "node:stream";
import { prisma } from "../lib/prisma";
import { verifyToken, type AuthRequest } from "../middleware/auth";
import { adminQuizScope, getQuiz, asyncRoute, QuizError } from "../services/quizzes";
import { parseScoringImpacts } from "../services/questions";
import { parseDraftRevision, readQuizEditorDraft, saveQuizEditorDraft } from "../services/quizEditorDrafts";
import type { QuizEditorQuestion } from "@poapo/types";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, done) => {
    if (["text/csv", "application/vnd.ms-excel", "text/plain"].includes(file.mimetype) ||
        file.originalname.toLowerCase().endsWith(".csv")) done(null, true);
    else done(new QuizError(400, "Seuls les fichiers CSV sont acceptés"));
  },
});
router.use(verifyToken, adminQuizScope);

function parseBool(raw: string | undefined, fallback = true): boolean {
  if (!raw?.trim()) return fallback;
  return ["true", "1", "yes", "oui", "y"].includes(raw.trim().toLowerCase());
}

function parseCSVBuffer(buffer: Buffer): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];
    Readable.from([buffer]).pipe(csvParser({ separator: detectCsvSeparator(buffer) }))
      .on("data", (row: Record<string, string>) => rows.push(row))
      .on("end", () => resolve(rows)).on("error", reject);
  });
}

router.get("/questions", asyncRoute(async (req: AuthRequest, res) => {
  res.json(await prisma.question.findMany({
    where: { tenantId: req.tenant!.tenantId, quizId: getQuiz(res).id },
    orderBy: { order: "asc" },
    include: { answers: { orderBy: { order: "asc" } } },
  }));
}));

// CSV remains available, but can only append to the revision explicitly opened by the editor.
router.post("/questions/import-csv", upload.single("file"), asyncRoute(async (req: AuthRequest, res) => {
  if (!req.file) throw new QuizError(400, "Fichier CSV requis");
  const rawRevision = req.body?.revision;
  if (typeof rawRevision !== "string" || !/^(0|[1-9]\d*)$/.test(rawRevision)) {
    throw new QuizError(400, "Révision du brouillon requise pour importer un CSV");
  }
  const revision = parseDraftRevision(Number(rawRevision));
  const tenantId = req.tenant!.tenantId;
  const quizId = getQuiz(res).id;
  const current = await readQuizEditorDraft(tenantId, quizId);
  if (current.revision !== revision) throw new QuizError(409, "Conflit de révision : rechargez le brouillon avant l'import");
  const rows = await parseCSVBuffer(req.file.buffer);
  const groups = new Map<string, QuizEditorQuestion>();
  let skippedRows = 0;
  let createdAnswers = 0;
  const nextOrder = Math.max(-1, ...current.draft.questions.map((q) => q.order)) + 1;
  for (const row of rows) {
    const text = String(row.question ?? "").trim();
    const answerText = String(row.answer ?? "").trim();
    if (!text || !answerText) { skippedRows++; continue; }
    const type = row.type?.trim().toLowerCase();
    const questionType = type === "multi" || type === "scale" ? type : "single";
    const helpText = row.helpText?.trim() || null;
    const abVariant = row.abVariant?.trim() || null;
    const key = JSON.stringify([text, questionType, helpText, abVariant]);
    let question = groups.get(key);
    if (!question) {
      question = {
        id: `draft_${randomUUID()}`, text, helpText, abVariant, type: questionType,
        active: parseBool(row.questionActive), imageUrl: null, conditionAnswerId: null,
        order: nextOrder + groups.size, answers: [],
      };
      groups.set(key, question);
    }
    question.answers.push({
      id: `draft_${randomUUID()}`, text: answerText, emoji: row.emoji?.trim() || null,
      active: parseBool(row.answerActive), imageUrl: null, order: question.answers.length,
      impacts: parseScoringImpacts(Object.fromEntries(Object.entries(row).map(([key, value]) => [
        key.startsWith("impact_") ? key.slice(7) : key, value.trim().replace(",", "."),
      ])), current.draft.config.axes),
    });
    createdAnswers++;
  }
  if (!groups.size) throw new QuizError(400, "Aucune ligne valide (colonnes requises : question, answer)");
  current.draft.questions.push(...groups.values());
  const saved = await saveQuizEditorDraft(tenantId, quizId, revision, current.draft);
  res.json({ ...saved, createdQuestions: groups.size, createdAnswers, skippedRows, totalRows: rows.length });
}));

router.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    res.status(409).json({ error: "Le contenu du quiz se modifie uniquement via son brouillon avec une révision" });
    return;
  }
  next();
});

export default router;
