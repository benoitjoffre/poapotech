import { Prisma } from "@prisma/client";
import type { QuizEditorDraft, QuizEditorDraftResponse, QuizEditorQuestion } from "@poapo/types";
import { parseQuizTheme } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { AxisValidationError, parseAxes, validateAxes } from "./axes";
import { resolveCatalog, validateCatalogProducts } from "./catalogs";
import { QuizError, resolveQuiz, type ScopedQuiz } from "./quizzes";

const CONFLICT = "Conflit de révision : le brouillon a été modifié ou abandonné ailleurs. Rechargez-le avant de réessayer.";
const NEW_ID = /^draft_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseDraftRevision(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0 || raw >= 2_147_483_647) {
    throw new QuizError(400, "Une révision entière positive ou nulle est requise");
  }
  return raw;
}

function object(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new QuizError(400, `${label} invalide`);
  return raw as Record<string, unknown>;
}

function text(raw: unknown, label: string): string {
  if (typeof raw !== "string") throw new QuizError(400, `${label} doit être un texte`);
  return raw;
}

function nullableText(raw: unknown, label: string): string | null {
  return raw === null ? null : text(raw, label);
}

function bool(raw: unknown, label: string): boolean {
  if (typeof raw !== "boolean") throw new QuizError(400, `${label} doit être un booléen`);
  return raw;
}

function order(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0 || raw > 2_147_483_647) {
    throw new QuizError(400, "Ordre invalide");
  }
  return raw;
}

function list(raw: unknown, label: string): unknown[] {
  if (!Array.isArray(raw)) throw new QuizError(400, `${label} doit être une liste`);
  return raw;
}

export async function publishedContent(quiz: ScopedQuiz, db: Prisma.TransactionClient = prisma): Promise<QuizEditorDraft> {
  const questions = await db.question.findMany({
    where: { tenantId: quiz.tenantId, quizId: quiz.id },
    orderBy: [{ order: "asc" }, { id: "asc" }],
    include: { answers: { orderBy: [{ order: "asc" }, { id: "asc" }] } },
  });
  return {
    schemaVersion: 1,
    ...(quiz.publishedTheme != null && { theme: parseQuizTheme(quiz.publishedTheme) }),
    config: {
      name: quiz.name, catalogId: quiz.catalogId, industry: quiz.industry, axes: parseAxes(quiz.axes),
      quizTitle: quiz.quizTitle, ctaText: quiz.ctaText, active: quiz.active,
      useAllProducts: quiz.useAllProducts, productIds: quiz.products.map((p) => p.productId),
    },
    questions: questions.map((q) => ({
      id: q.id, text: q.text, helpText: q.helpText, type: q.type, imageUrl: q.imageUrl,
      order: q.order, active: q.active, conditionAnswerId: q.conditionAnswerId, abVariant: q.abVariant,
      answers: q.answers.map((a) => ({
        id: a.id, text: a.text, emoji: a.emoji, imageUrl: a.imageUrl, order: a.order, active: a.active,
        impacts: object(a.impacts, "Impacts publiés") as Record<string, number>,
      })),
    })),
  };
}

export async function readQuizEditorDraft(tenantId: string, quizId: unknown): Promise<QuizEditorDraftResponse> {
  return prisma.$transaction(async (db) => {
    const quiz = await resolveQuiz(tenantId, quizId, false, db);
    const row = await db.quizEditorDraft.findFirst({ where: { tenantId, quizId: quiz.id } });
    return {
      quizId: quiz.id,
      revision: row?.revision ?? 0,
      hasChanges: row?.content != null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      draft: row?.content != null ? row.content as unknown as QuizEditorDraft : await publishedContent(quiz, db),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function validateContent(quiz: ScopedQuiz, raw: unknown, db: Prisma.TransactionClient = prisma): Promise<QuizEditorDraft> {
  const body = object(raw, "Brouillon");
  if (body.schemaVersion !== 1) throw new QuizError(400, "Version de brouillon non prise en charge");
  let theme;
  try {
    theme = body.theme === undefined ? undefined : parseQuizTheme(body.theme);
  } catch (err) {
    if (err instanceof Error) throw new QuizError(400, err.message);
    throw err;
  }
  const source = await publishedContent(quiz, db);
  const config = object(body.config, "Configuration");
  let axes;
  try {
    axes = validateAxes(config.axes);
  } catch (err) {
    if (err instanceof AxisValidationError) throw new QuizError(400, err.message);
    throw err;
  }
  const axisKeys = new Set(axes.map((axis) => axis.key));
  if (source.config.axes.some((axis) => !axisKeys.has(axis.key))) {
    throw new QuizError(400, "Les clés des axes publiés doivent être conservées dans cette étape");
  }
  const catalogId = text(config.catalogId, "Catalogue");
  if (!catalogId) throw new QuizError(400, "Catalogue requis");
  await resolveCatalog(quiz.tenantId, catalogId, db);
  const productIds = list(config.productIds, "Produits").map((id) => text(id, "Identifiant produit"));
  if (productIds.some((id) => !id) || new Set(productIds).size !== productIds.length) {
    throw new QuizError(400, "Identifiants produits invalides ou dupliqués");
  }
  await validateCatalogProducts(quiz.tenantId, catalogId, productIds, db);
  const industry = text(config.industry, "Activité");
  if (industry.trim().length > 80) throw new QuizError(400, "L'activité est limitée à 80 caractères");
  const sourceQuestions = new Map(source.questions.map((q) => [q.id, q]));
  const sourceAnswers = new Map(source.questions.flatMap((q) => q.answers.map((a) => [a.id, { questionId: q.id, answer: a }] as const)));
  const seen = new Set<string>();
  const identify = (rawId: unknown, permitted: boolean) => {
    const id = text(rawId, "Identifiant");
    if ((!permitted && !NEW_ID.test(id)) || seen.has(id)) throw new QuizError(400, "Identifiant étranger, invalide ou dupliqué");
    seen.add(id);
    return id;
  };
  const questions = list(body.questions, "Questions").map((rawQuestion): QuizEditorQuestion => {
    const q = object(rawQuestion, "Question");
    const id = identify(q.id, typeof q.id === "string" && sourceQuestions.has(q.id));
    if (q.type !== "single" && q.type !== "multi" && q.type !== "scale") throw new QuizError(400, "Type de question invalide");
    return {
      id, text: text(q.text, "Question"), helpText: nullableText(q.helpText, "Aide"),
      imageUrl: nullableText(q.imageUrl, "Image"), type: q.type, order: order(q.order),
      active: bool(q.active, "Activation"), abVariant: nullableText(q.abVariant, "Variante"),
      conditionAnswerId: nullableText(q.conditionAnswerId, "Condition"),
      answers: list(q.answers, "Réponses").map((rawAnswer) => {
        const a = object(rawAnswer, "Réponse");
        const original = typeof a.id === "string" ? sourceAnswers.get(a.id) : undefined;
        const answerId = identify(a.id, original?.questionId === id);
        const impacts = object(a.impacts, "Impacts");
        const validated: Record<string, number> = {};
        for (const [key, value] of Object.entries(impacts)) {
          // Preserve dormant legacy impacts without allowing new references to unknown axes.
          const unchangedLegacy = original?.answer.impacts[key] === value;
          if (typeof value !== "number" || !Number.isFinite(value) ||
              ((!axisKeys.has(key) || Math.abs(value) > 1) && !unchangedLegacy)) {
            throw new QuizError(400, `Impact invalide sur l'axe ${key}`);
          }
          validated[key] = value;
        }
        return {
          id: answerId, text: text(a.text, "Réponse"), emoji: nullableText(a.emoji, "Emoji"),
          imageUrl: nullableText(a.imageUrl, "Image"), active: bool(a.active, "Activation"),
          order: order(a.order), impacts: validated,
        };
      }),
    };
  });
  const answerOwners = new Map(questions.flatMap((q) => q.answers.map((a) => [a.id, q.id] as const)));
  const newIds = [...seen].filter((id) => !sourceQuestions.has(id) && !sourceAnswers.has(id));
  if (newIds.length) {
    const [existingQuestions, existingAnswers] = await Promise.all([
      db.question.findMany({ where: { id: { in: newIds } }, select: { id: true } }),
      db.answer.findMany({ where: { id: { in: newIds } }, select: { id: true } }),
    ]);
    if (existingQuestions.some((q) => newIds.includes(q.id)) || existingAnswers.some((a) => newIds.includes(a.id))) {
      throw new QuizError(400, "Un nouvel identifiant est déjà utilisé dans un quiz");
    }
  }
  for (const q of questions) {
    if (q.conditionAnswerId && (!answerOwners.has(q.conditionAnswerId) || answerOwners.get(q.conditionAnswerId) === q.id)) {
      throw new QuizError(400, "La condition doit référencer une réponse d'une autre question du brouillon");
    }
  }
  return {
    schemaVersion: 1,
    ...(theme !== undefined && { theme }),
    config: {
      name: text(config.name, "Nom"), catalogId, industry, axes,
      quizTitle: text(config.quizTitle, "Titre"), ctaText: text(config.ctaText, "CTA"),
      active: bool(config.active, "Activation"), useAllProducts: bool(config.useAllProducts, "Sélection"),
      productIds,
    },
    questions,
  };
}

async function writeContent(tenantId: string, quizId: string, revision: number, content: Prisma.InputJsonValue | typeof Prisma.DbNull) {
  const updatedAt = new Date();
  if (revision === 0) {
    try {
      await prisma.quizEditorDraft.create({ data: { tenantId, quizId, revision: 1, content, updatedAt } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new QuizError(409, CONFLICT);
      throw err;
    }
  } else {
    const updated = await prisma.quizEditorDraft.updateMany({
      where: { tenantId, quizId, revision },
      data: { content, revision: { increment: 1 }, updatedAt },
    });
    if (updated.count !== 1) throw new QuizError(409, CONFLICT);
  }
  return updatedAt.toISOString();
}

export async function saveQuizEditorDraft(tenantId: string, quizId: unknown, rawRevision: unknown, raw: unknown) {
  const quiz = await resolveQuiz(tenantId, quizId);
  const revision = parseDraftRevision(rawRevision);
  const draft = await validateContent(quiz, raw);
  const content = JSON.parse(JSON.stringify(draft)) as Prisma.InputJsonValue;
  const updatedAt = await writeContent(tenantId, quiz.id, revision, content);
  // Return the acknowledged document/revision, never a later concurrent writer's document.
  return { quizId: quiz.id, revision: revision + 1, hasChanges: true, updatedAt, draft } satisfies QuizEditorDraftResponse;
}

export async function discardQuizEditorDraft(tenantId: string, quizId: unknown, rawRevision: unknown) {
  const quiz = await resolveQuiz(tenantId, quizId);
  const revision = parseDraftRevision(rawRevision);
  const draft = await publishedContent(quiz);
  const updatedAt = await writeContent(tenantId, quiz.id, revision, Prisma.DbNull);
  return { quizId: quiz.id, revision: revision + 1, hasChanges: false, updatedAt, draft } satisfies QuizEditorDraftResponse;
}
