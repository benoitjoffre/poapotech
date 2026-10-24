import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { QuizEditorDraftResponse, QuizPublicationDiagnostic } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { parseDraftRevision, publishedContent } from "./quizEditorDrafts";
import { diagnoseQuiz } from "./quizPublicationDiagnostic";
import { quizInclude, QuizError } from "./quizzes";

export class PublicationValidationError extends QuizError {
  constructor(public diagnostic: QuizPublicationDiagnostic) {
    super(422, "Le quiz contient des erreurs bloquantes");
  }
}

export async function lockQuiz(db: Prisma.TransactionClient, tenantId: string, quizId: unknown) {
  if (typeof quizId !== "string" || !quizId.trim()) throw new QuizError(400, "quizId invalide");
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Quiz" WHERE id = ${quizId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  if (!rows.length) throw new QuizError(404, "Quiz introuvable");
  return db.quiz.findFirstOrThrow({ where: { id: quizId, tenantId }, include: quizInclude });
}

function conflict(): never {
  throw new QuizError(409, "Conflit de révision : rechargez le brouillon et vérifiez-le à nouveau.");
}

async function savedDiagnostic(db: Prisma.TransactionClient, tenantId: string, quizId: string, revision: number) {
  const quiz = await lockQuiz(db, tenantId, quizId);
  const row = await db.quizEditorDraft.findFirst({ where: { tenantId, quizId } });
  if ((row?.revision ?? 0) !== revision) conflict();
  const { diagnostic, draft } = await diagnoseQuiz(quiz, row?.content ?? await publishedContent(quiz, db), db);
  diagnostic.revision = revision;
  diagnostic.hasChanges = row?.content != null;
  return { diagnostic, draft, quiz, row };
}

export async function checkQuizPublication(tenantId: string, quizId: unknown, rawRevision: unknown) {
  if (typeof quizId !== "string" || !quizId.trim()) throw new QuizError(400, "quizId invalide");
  const revision = parseDraftRevision(rawRevision);
  return prisma.$transaction(async (db) => (await savedDiagnostic(db, tenantId, quizId, revision)).diagnostic);
}

export async function publishQuizDraft(tenantId: string, quizId: unknown, rawRevision: unknown, confirmation: unknown) {
  if (typeof quizId !== "string" || !quizId.trim()) throw new QuizError(400, "quizId invalide");
  const revision = parseDraftRevision(rawRevision);
  try {
    // Read associations after acquiring the lock, including commits we waited for.
    // The quiz lock serializes publication/association changes; the draft CAS covers save/discard.
    return await prisma.$transaction(async (db): Promise<QuizEditorDraftResponse> => {
      const { diagnostic, draft, quiz, row } = await savedDiagnostic(db, tenantId, quizId, revision);
      if (!diagnostic.valid || !draft) throw new PublicationValidationError(diagnostic);
      if (!row?.content) throw new QuizError(409, "Aucune modification préparatoire à publier");
      if (diagnostic.campaigns.length > 1) {
        const expected = diagnostic.campaigns.map((c) => c.id).sort();
        if (!Array.isArray(confirmation) || confirmation.length !== expected.length ||
            [...confirmation].sort().some((id, index) => id !== expected[index])) {
          throw new QuizError(409, "Confirmez explicitement toutes les campagnes partageant ce quiz après une nouvelle vérification");
        }
      }
      // Acquiring the draft row by CAS also serializes with save/discard, which use this same revision.
      const changed = await db.quizEditorDraft.updateMany({
        where: { tenantId, quizId, revision },
        data: { revision: { increment: 1 }, content: Prisma.DbNull },
      });
      if (changed.count !== 1) conflict();
      const original = await publishedContent(quiz, db);
      const questionIds = new Set(original.questions.map((q) => q.id));
      const answerIds = new Set(original.questions.flatMap((q) => q.answers.map((a) => a.id)));
      const qMap = new Map(draft.questions.map((q) => [q.id, questionIds.has(q.id) ? q.id : randomUUID()]));
      const aMap = new Map(draft.questions.flatMap((q) => q.answers.map((a) => [a.id, answerIds.has(a.id) ? a.id : randomUUID()] as const)));
      // Refuse corrupt cross-quiz dependencies instead of letting ON DELETE SET NULL modify another quiz.
      const external = await db.question.count({
        where: { quizId: { not: quizId }, conditionAnswerId: { in: [...answerIds] } },
      });
      if (external) throw new QuizError(409, "Une condition d'un autre quiz référence ce contenu ; publication refusée");
      await db.question.updateMany({ where: { tenantId, quizId }, data: { conditionAnswerId: null } });
      await db.answer.deleteMany({
        where: { question: { tenantId, quizId }, id: { notIn: [...aMap.values()] } },
      });
      await db.question.deleteMany({ where: { tenantId, quizId, id: { notIn: [...qMap.values()] } } });
      for (const q of draft.questions) {
        const id = qMap.get(q.id)!;
        const data = { text: q.text, helpText: q.helpText, type: q.type, imageUrl: q.imageUrl,
          order: q.order, active: q.active, abVariant: q.abVariant, conditionAnswerId: null };
        if (questionIds.has(id)) await db.question.update({ where: { id }, data });
        else await db.question.create({ data: { id, tenantId, quizId, ...data } });
        for (const a of q.answers) {
          const answerId = aMap.get(a.id)!;
          const answerData = { text: a.text, emoji: a.emoji, imageUrl: a.imageUrl, order: a.order,
            active: a.active, impacts: a.impacts };
          if (answerIds.has(answerId)) await db.answer.update({ where: { id: answerId }, data: answerData });
          else await db.answer.create({ data: { id: answerId, questionId: id, ...answerData } });
        }
      }
      for (const q of draft.questions) if (q.conditionAnswerId) {
        await db.question.update({ where: { id: qMap.get(q.id)! }, data: { conditionAnswerId: aMap.get(q.conditionAnswerId)! } });
      }
      // Remove old product FKs before switching catalogue, then recreate the validated selection.
      await db.quizProduct.deleteMany({ where: { quizId } });
      const { productIds, ...config } = draft.config;
      const updated = await db.quiz.update({
        where: { id: quizId },
        data: { ...config, axes: config.axes as unknown as Prisma.InputJsonValue,
          publishedTheme: draft.theme == null ? Prisma.DbNull : JSON.parse(JSON.stringify(draft.theme)) },
        include: quizInclude,
      });
      if (productIds.length) await db.quizProduct.createMany({
        data: productIds.map((productId) => ({ quizId, productId, catalogId: config.catalogId })),
      });
      const acknowledged = await db.quiz.findUniqueOrThrow({ where: { id: quizId }, include: quizInclude });
      const content = await publishedContent(acknowledged, db);
      const saved = await db.quizEditorDraft.findUniqueOrThrow({ where: { quizId } });
      return { quizId: updated.id, revision: revision + 1, hasChanges: false, updatedAt: saved.updatedAt.toISOString(), draft: content };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20_000 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === "P2034" || err.code === "P2002" ||
          (err.code === "P2010" && (err.meta?.code === "40001" || err.meta?.code === "40P01")))) conflict();
    throw err;
  }
}
