import type { Question } from "@poapo/types";
import { visibleQuizQuestions } from "@poapo/types";

const AB_STORAGE_KEY = "poapo_ab_variant";

export function pickAbVariant(questions: Question[], quizId: string): string | null {
  const variants = [...new Set(questions.map((question) => question.abVariant).filter(Boolean))] as string[];
  if (variants.length === 0) {
    return null;
  }

  const storageKey = `${AB_STORAGE_KEY}:${quizId}`;
  let storedVariant = sessionStorage.getItem(storageKey);
  if (!storedVariant || !variants.includes(storedVariant)) {
    storedVariant = variants[Math.floor(Math.random() * variants.length)];
    sessionStorage.setItem(storageKey, storedVariant);
  }

  return storedVariant;
}

export function filterVisibleQuestions(
  questions: Question[],
  selectedAnswerIds: Set<string>,
  abVariant: string | null,
): Question[] {
  return visibleQuizQuestions(questions, selectedAnswerIds, abVariant);
}
