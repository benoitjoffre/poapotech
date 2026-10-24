import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleQuizQuestions } from "@poapo/types";

test("parcours partagé : activation, variantes et branches transitives sans réponses fantômes", () => {
  const q = (id: string, conditionAnswerId: string | null = null, abVariant: string | null = null) => ({
    id, active: true, conditionAnswerId, abVariant, answers: [{ id: `a-${id}`, active: true }],
  });
  const questions = [q("root"), q("child", "a-root"), q("grandchild", "a-child"),
    q("A", null, "A"), q("B", null, "B"), { ...q("off"), active: false },
    q("unreachable", "a-off")];
  assert.deepEqual(visibleQuizQuestions(questions, new Set(["a-root", "a-child", "a-off"]), "A").map((q) => q.id),
    ["root", "child", "grandchild", "A"]);
  assert.deepEqual(visibleQuizQuestions(questions, new Set(["a-child"]), "B").map((q) => q.id), ["root", "B"]);
  questions[0].answers[0].active = false;
  assert.deepEqual(visibleQuizQuestions(questions, new Set(["a-root", "a-child"]), "A").map((q) => q.id), ["root", "A"]);
});

test("un cycle de conditions ne se déverrouille pas lui-même", () => {
  const questions = ["x", "y"].map((id, index) => ({
    id, active: true, abVariant: null, conditionAnswerId: index ? "a-x" : "a-y",
    answers: [{ id: `a-${id}`, active: true }],
  }));
  assert.deepEqual(visibleQuizQuestions(questions, new Set(["a-x", "a-y"]), null), []);
});
