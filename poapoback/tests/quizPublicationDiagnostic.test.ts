import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuizEditorDraft } from "@poapo/types";
import { inspectQuizStructure } from "../src/services/quizPublicationDiagnostic";

function draft(): QuizEditorDraft {
  return {
    schemaVersion: 1,
    config: { name: "Historique", catalogId: "catalog", industry: "", quizTitle: "Titre", ctaText: "Voir",
      active: true, useAllProducts: true, productIds: [], axes: [{ key: "pace", label: "Rythme" }] },
    questions: ["root", "child"].map((id, index) => ({
      id, text: id, helpText: null, imageUrl: null, type: index ? "multi" : "single",
      active: true, order: index, conditionAnswerId: index ? "a-root" : null, abVariant: null,
      answers: [{ id: `a-${id}`, text: "Réponse", emoji: null, imageUrl: null, active: true, order: 0, impacts: { pace: 0.1 } }],
    })),
  };
}
test("diagnostic : quiz historique sans limites du générateur et variantes jouables", () => {
  const d = draft();
  for (let index = 2; index < 30; index++) {
    const q = structuredClone(d.questions[0]);
    q.id = `q-${index}`; q.order = index; q.answers[0].id = `a-${index}`;
    d.questions.push(q);
  }
  for (let index = 1; index <= 8; index++) {
    d.questions[0].answers.push({ ...d.questions[0].answers[0], id: `extra-${index}`, order: index });
  }
  assert.deepEqual(inspectQuizStructure(d).errors, []);
  d.questions[1].abVariant = "A";
  const b = structuredClone(d.questions[1]);
  b.id = "variant-b"; b.order = 30; b.abVariant = "B"; b.answers[0].id = "b-answer";
  d.questions.push(b);
  assert.deepEqual(inspectQuizStructure(d).errors, []);
});
test("diagnostic : parcours vide, absence de réponse, textes et impacts invalides", () => {
  const d = draft();
  d.questions.forEach((q) => { q.active = false; });
  assert.ok(inspectQuizStructure(d).errors.some((e) => e.code === "NO_PLAYABLE_PATH"));
  d.questions[0].active = true;
  d.questions[0].answers[0].active = false;
  assert.ok(inspectQuizStructure(d).errors.some((e) => e.code === "NO_ACTIVE_ANSWER"));
  d.questions[0].text = "";
  d.questions[0].answers[0].text = "";
  d.questions[0].answers[0].impacts = { foreign: 0.2, pace: 2 };
  const codes = inspectQuizStructure(d).errors.map((e) => e.code);
  for (const code of ["INVALID_QUESTION", "INVALID_ANSWER", "INVALID_IMPACT"]) assert.ok(codes.includes(code));
});
test("diagnostic : cycles, conditions vers le futur, variantes incompatibles et activation", () => {
  const d = draft();
  d.questions[0].conditionAnswerId = "a-child";
  assert.ok(inspectQuizStructure(d).errors.some((e) => e.code === "CYCLIC_CONDITION"));
  assert.ok(inspectQuizStructure(d).errors.some((e) => e.code === "INCOHERENT_CONDITION"));
  d.questions[0].conditionAnswerId = null;
  d.questions[0].abVariant = "A";
  d.questions[1].abVariant = "B";
  assert.ok(inspectQuizStructure(d).errors.some((e) => e.code === "UNREACHABLE_CONDITION"));
  d.questions[0].abVariant = null;
  d.questions[0].answers[0].active = false;
  assert.ok(inspectQuizStructure(d).errors.some((e) => e.code === "INCOHERENT_CONDITION"));
});
test("diagnostic : réponses sans impact et absence d'axes ne sont pas bloquantes", () => {
  const d = draft();
  d.config.axes = [];
  for (const q of d.questions) for (const a of q.answers) a.impacts = {};
  const result = inspectQuizStructure(d);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.filter((e) => e.code === "NO_IMPACT").length, 2);
});
