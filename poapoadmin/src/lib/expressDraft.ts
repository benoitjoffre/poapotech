import type { ExpressDraft, ExpressQuestion } from "@poapo/types";

/**
 * Modifications du brouillon express qui préservent la cohérence des impacts :
 * jamais d'impact vers un critère supprimé, jamais de question sans effet distinct.
 */

function signature(impacts: Record<string, number>): string {
  return JSON.stringify(Object.entries(impacts).filter(([, v]) => v !== 0).sort(([a], [b]) => a.localeCompare(b)));
}

export function hasDistinctEffects(question: ExpressQuestion): boolean {
  return new Set(question.answers.map((answer) => signature(answer.impacts))).size >= 2;
}

function strip(question: ExpressQuestion, keep: Set<string>): ExpressQuestion {
  return {
    ...question,
    answers: question.answers.map((answer) => ({
      ...answer,
      impacts: Object.fromEntries(Object.entries(answer.impacts).filter(([key]) => keep.has(key))),
    })),
  };
}

/** Supprime un critère, ses impacts, et les questions qui n'auraient plus d'effet. Renvoie aussi le nombre de questions retirées. */
export function removeAxis(draft: ExpressDraft, key: string): { draft: ExpressDraft; removedQuestions: number } {
  const axes = draft.axes.filter((axis) => axis.key !== key);
  const keep = new Set(axes.map((axis) => axis.key));
  const questions = draft.questions.map((question) => strip(question, keep)).filter(hasDistinctEffects);
  return { draft: { ...draft, axes, questions }, removedQuestions: draft.questions.length - questions.length };
}

export function renameAxis(draft: ExpressDraft, key: string, label: string): ExpressDraft {
  return { ...draft, axes: draft.axes.map((axis) => axis.key === key ? { ...axis, label } : axis) };
}

/** Remplace une question par une suggestion en ne gardant que les impacts sur les critères actuels ; null si elle devient sans effet. */
export function replaceQuestion(draft: ExpressDraft, index: number, suggestion: ExpressQuestion): ExpressDraft | null {
  const keep = new Set(draft.axes.map((axis) => axis.key));
  const stripped = strip(suggestion, keep);
  const answers = stripped.answers.filter((answer) => Object.keys(answer.impacts).length > 0);
  const next = { ...stripped, answers };
  if (answers.length < 2 || !hasDistinctEffects(next)) return null;
  return { ...draft, questions: draft.questions.map((question, i) => i === index ? next : question) };
}

/** Nouvelle réponse : elle pousse légèrement le premier critère déjà influencé par la question, pour ne jamais être sans effet. */
export function addAnswer(draft: ExpressDraft, index: number): ExpressDraft {
  const question = draft.questions[index];
  const key = question.answers.flatMap((answer) => Object.keys(answer.impacts))[0] ?? draft.axes[0]?.key;
  const impacts = key ? { [key]: 0.1 } : {};
  return {
    ...draft,
    questions: draft.questions.map((item, i) => i === index
      ? { ...item, answers: [...item.answers, { text: "Nouvelle réponse", emoji: null, impacts }] }
      : item),
  };
}

export function removeAnswer(draft: ExpressDraft, qi: number, ai: number): ExpressDraft {
  return {
    ...draft,
    questions: draft.questions.map((question, i) => i === qi ? { ...question, answers: question.answers.filter((_, j) => j !== ai) } : question),
  };
}

export function updateQuestion(draft: ExpressDraft, qi: number, patch: Partial<ExpressQuestion>): ExpressDraft {
  return { ...draft, questions: draft.questions.map((question, i) => i === qi ? { ...question, ...patch } : question) };
}

export function updateAnswer(draft: ExpressDraft, qi: number, ai: number, patch: Partial<ExpressQuestion["answers"][number]>): ExpressDraft {
  return updateQuestion(draft, qi, { answers: draft.questions[qi].answers.map((answer, j) => j === ai ? { ...answer, ...patch } : answer) });
}

/** Valeur numérique saisie : bornée à ±1, 0 retire l'impact. */
export function setImpact(draft: ExpressDraft, qi: number, ai: number, key: string, value: number): ExpressDraft {
  const bounded = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  const impacts = { ...draft.questions[qi].answers[ai].impacts };
  if (bounded === 0) delete impacts[key];
  else impacts[key] = Math.round(bounded * 100) / 100;
  return updateAnswer(draft, qi, ai, { impacts });
}
