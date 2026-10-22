import type { Prisma } from "@prisma/client";
import { parseAxes } from "./axes";

/** Borne des impacts saisis manuellement (builder, import CSV, brouillon modifié). */
export const MANUAL_IMPACT_LIMIT = 1;

function clamp(v: number, min = -MANUAL_IMPACT_LIMIT, max = MANUAL_IMPACT_LIMIT): number {
  if (isNaN(v)) return 0;
  return Math.max(min, Math.min(max, v));
}

/** Ne conserve que les impacts portant sur un axe du quiz, bornés entre -1 et 1. */
export function parseScoringImpacts(raw: unknown, quizAxes: unknown): Record<string, number> {
  if (typeof raw === "object" && raw !== null) {
    const axisKeys = new Set(parseAxes(quizAxes).map((axis) => axis.key));
    const obj = raw as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([key, value]) => axisKeys.has(key) && value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) !== 0)
        .map(([key, value]) => [key, clamp(Number(value))]),
    );
  }
  return {};
}

export interface NewAnswer {
  text: string;
  emoji?: string | null;
  active?: boolean;
  /** Impacts déjà filtrés sur les axes du quiz. */
  impacts: Record<string, number>;
}

export interface NewQuestion {
  text: string;
  helpText?: string | null;
  type: "single" | "multi" | "scale";
  active?: boolean;
  abVariant?: string | null;
  answers: NewAnswer[];
}

/**
 * Crée des questions et leurs réponses dans une transaction existante, à partir de l'ordre donné.
 * Les réponses au texte vide sont ignorées sans consommer de rang.
 */
export async function createQuestionsWithAnswers(
  tx: Prisma.TransactionClient,
  scope: { tenantId: string; quizId: string; startOrder: number },
  questions: NewQuestion[],
) {
  let nextOrder = scope.startOrder;
  let createdQuestions = 0;
  let createdAnswers = 0;

  for (const question of questions) {
    const createdQuestion = await tx.question.create({
      data: {
        tenantId: scope.tenantId,
        quizId: scope.quizId,
        text: question.text,
        helpText: question.helpText ?? null,
        type: question.type,
        active: question.active ?? true,
        abVariant: question.abVariant ?? null,
        order: nextOrder++,
      },
    });
    createdQuestions++;

    let answerOrder = 0;
    for (const answer of question.answers) {
      const text = answer.text.trim();
      if (!text) continue;
      await tx.answer.create({
        data: {
          questionId: createdQuestion.id,
          text,
          emoji: answer.emoji?.trim() || null,
          active: answer.active ?? true,
          order: answerOrder++,
          impacts: answer.impacts,
        },
      });
      createdAnswers++;
    }
  }

  return { createdQuestions, createdAnswers };
}
