import type { QuizEditorDraft, QuizPreviewSnapshot, SessionAnswer } from "@poapo/types";
import { visibleQuizQuestions } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { resolveQuiz, QuizError } from "./quizzes";
import { validateContent } from "./quizEditorDrafts";
import { recommendQuiz } from "./quizRecommendations";

export async function prepareQuizPreview(tenantId: string, quizId: unknown, raw: unknown): Promise<QuizPreviewSnapshot> {
  const quiz = await resolveQuiz(tenantId, quizId);
  const draft = await validateContent(quiz, raw);
  const active = draft.questions.filter((q) => q.active);
  if (!active.length || active.some((q) => !q.text.trim() ||
      !q.answers.some((a) => a.active) || q.answers.some((a) => a.active && !a.text.trim()))) {
    throw new QuizError(422, "Complétez les questions actives et leurs réponses avant de lancer l'aperçu");
  }
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId }, select: { name: true, primaryColor: true, logoUrl: true },
  });
  return { quizId: quiz.id, draft, branding: tenant };
}

function previewAnswers(draft: QuizEditorDraft, raw: unknown, variant: unknown): SessionAnswer[] {
  const variants = new Set(draft.questions.filter((q) => q.active).map((q) => q.abVariant).filter(Boolean));
  if (variants.size ? typeof variant !== "string" || !variants.has(variant) : variant != null) {
    throw new QuizError(400, "Variante d'aperçu invalide");
  }
  if (!Array.isArray(raw) || !raw.length || raw.some((a) =>
    !a || typeof a.questionId !== "string" || typeof a.answerId !== "string")) {
    throw new QuizError(400, "Réponses d'aperçu invalides");
  }
  const answers: SessionAnswer[] = raw;
  if (new Set(answers.map((a) => a.answerId)).size !== answers.length) {
    throw new QuizError(400, "Réponses d'aperçu dupliquées");
  }
  const visible = visibleQuizQuestions(draft.questions, new Set(answers.map((a) => a.answerId)), typeof variant === "string" ? variant : null);
  if (!visible.length || answers.some((a) => !visible.some((q) =>
    q.id === a.questionId && q.answers.some((option) => option.active && option.id === a.answerId))) ||
    visible.some((q) => {
      const count = answers.filter((a) => a.questionId === q.id).length;
      return q.type === "multi" ? count < 1 : count !== 1;
    })) {
    throw new QuizError(400, "Répondez à toutes les questions visibles avec des réponses actives de ce parcours");
  }
  return answers;
}

export async function recommendQuizPreview(tenantId: string, quizId: unknown, raw: unknown, rawAnswers: unknown, variant: unknown) {
  const snapshot = await prepareQuizPreview(tenantId, quizId, raw);
  const answers = previewAnswers(snapshot.draft, rawAnswers, variant);
  const selected = new Set(answers.map((a) => a.answerId));
  const draftAnswers = snapshot.draft.questions.flatMap((q) => q.answers).filter((a) => selected.has(a.id));
  // Preserve the public query's scoring order for existing answers (clamping is order-sensitive).
  const existing = await prisma.answer.findMany({
    where: { id: { in: [...selected] }, active: true, question: { tenantId, quizId: snapshot.quizId, active: true } },
    include: { question: { select: { type: true } } },
  });
  const byId = new Map(draftAnswers.map((a) => [a.id, a]));
  const existingIds = new Set(existing.map((a) => a.id));
  const ordered = [...existing.flatMap((a) => byId.has(a.id) ? [byId.get(a.id)!] : []),
    ...draftAnswers.filter((a) => !existingIds.has(a.id))];
  const config = snapshot.draft.config;
  const result = await recommendQuiz({
    tenantId, catalogId: config.catalogId, industry: config.industry, axes: config.axes,
    productIds: config.useAllProducts ? undefined : config.productIds,
    impacts: ordered.map((a) => a.impacts),
  });
  return { ...result, quizId: snapshot.quizId, industry: config.industry };
}
