import assert from "node:assert/strict";
import { test } from "node:test";
import { addExampleAxis, axisExamples, parseStep, resumeStep, stepComplete, WIZARD_STEPS } from "../../poapoadmin/src/lib/experienceWizard";

const base = { catalogId: "cat", recommendableProducts: 3, axisCount: 2, playableQuestions: 1 };

test("assistant : cinq étapes dans l'ordre attendu", () => {
  assert.deepEqual(WIZARD_STEPS.map((s) => s.label), ["Mes produits", "Mes préférences", "Mes questions", "Personnaliser et tester", "Vérifier et publier"]);
});

test("assistant : reprise sur la première étape incomplète", () => {
  assert.equal(resumeStep({ ...base, catalogId: "" }), 1);
  assert.equal(resumeStep({ ...base, recommendableProducts: 0 }), 1);
  assert.equal(resumeStep({ ...base, recommendableProducts: null }), 1);
  assert.equal(resumeStep({ ...base, axisCount: 0 }), 2);
  assert.equal(resumeStep({ ...base, playableQuestions: 0 }), 3);
  assert.equal(resumeStep(base), 4);
  assert.equal(stepComplete("publication", base), false);
});

test("assistant : parseStep refuse les valeurs hors bornes", () => {
  assert.equal(parseStep("3"), 3);
  for (const v of [null, "0", "6", "x", "1.5"]) assert.equal(parseStep(v), null);
});

test("assistant : exemples d'axes sans valeur numérique inventée, selon le secteur", () => {
  assert.equal(axisExamples("Parfumerie")[0].label, "Intensité");
  assert.equal(axisExamples("")[0].label, "Budget");
  for (const e of axisExamples("Voyage")) assert.deepEqual(Object.keys(e).sort(), ["highLabel", "label", "lowLabel"]);
});

test("assistant : ajout d'un exemple conserve clés uniques et refuse les doublons", () => {
  const ex = axisExamples("")[0];
  const first = addExampleAxis([], ex)!;
  assert.equal(first.label, "Budget");
  assert.equal(addExampleAxis([first as never], ex), null);
  const clash = addExampleAxis([{ key: first.key, label: "Autre", lowLabel: "a", highLabel: "b" } as never], ex)!;
  assert.notEqual(clash.key, first.key);
});
