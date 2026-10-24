interface FlowQuestion {
  id: string;
  active: boolean;
  abVariant: string | null;
  conditionAnswerId: string | null;
  answers: { id: string; active: boolean }[];
}

/** Only selected answers belonging to reachable questions can unlock a branch. */
export function visibleQuizQuestions<T extends FlowQuestion>(
  questions: T[], selectedAnswerIds: Set<string>, variant: string | null,
): T[] {
  const eligible = questions.filter((q) => q.active && (!q.abVariant || q.abVariant === variant));
  const reachable = new Set(eligible.filter((q) => !q.conditionAnswerId).map((q) => q.id));
  let changed = true;
  while (changed) {
    changed = false;
    const answers = new Set(eligible.filter((q) => reachable.has(q.id))
      .flatMap((q) => q.answers.filter((a) => a.active && selectedAnswerIds.has(a.id)).map((a) => a.id)));
    for (const q of eligible) {
      if (!reachable.has(q.id) && q.conditionAnswerId && answers.has(q.conditionAnswerId)) {
        reachable.add(q.id);
        changed = true;
      }
    }
  }
  return eligible.filter((q) => reachable.has(q.id));
}
