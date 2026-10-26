import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuizPublicationIssue } from "@poapo/types";
import { publicAvailability } from "../../poapoadmin/src/lib/experiences";
import { issueTarget } from "../../poapoadmin/src/lib/publicationIssues";

test("accessibilité publique : boutique ET quiz actifs, sans lien avec les campagnes", () => {
  assert.deepEqual(publicAvailability({ shopActive: true, quizActive: true }), { accessible: true, label: "Accessible au public", reason: null });
  assert.equal(publicAvailability({ shopActive: true, quizActive: false }).reason, "Quiz désactivé");
  assert.equal(publicAvailability({ shopActive: false, quizActive: true }).reason, "Boutique désactivée");
  assert.equal(publicAvailability({ shopActive: false, quizActive: false }).accessible, false);
});

const issue = (code: string, section: QuizPublicationIssue["section"], message = "", extra: Partial<QuizPublicationIssue> = {}): QuizPublicationIssue =>
  ({ code, section, message, ...extra }) as QuizPublicationIssue;
const config = { name: "Quiz", quizTitle: "", ctaText: "", axes: [{ label: "Acidité" }, { label: "Corps" }] };

test("les diagnostics sont localisés dans la bonne section et le bon champ", () => {
  assert.deepEqual(issueTarget(issue("INVALID_CONFIG", "configuration"), config), { section: "configuration", elementId: "quiz-title" });
  assert.deepEqual(issueTarget(issue("NO_PRODUCTS", "configuration"), config), { section: "products", elementId: "quiz-use-all-products" });
  assert.equal(issueTarget(issue("MISSING_ATTRIBUTES", "configuration", "Attribut d'axe « Corps » manquant"), config)?.section, "products");
  assert.deepEqual(issueTarget(issue("WEAK_AXIS", "configuration", "L'axe « Corps » est peu discriminant."), config), { section: "configuration", elementId: "axis-label-1" });
  assert.deepEqual(issueTarget(issue("NO_AXES", "configuration"), config), { section: "configuration", elementId: "quiz-add-axis" });
  assert.deepEqual(issueTarget(issue("LOW_CONTRAST", "appearance"), config), { section: "appearance", elementId: "quiz-theme-primaryColor" });
  assert.deepEqual(issueTarget(issue("INVALID_QUESTION", "questions", "", { questionId: "q1" }), config), { section: "questions", elementId: "editor-question-q1" });
  assert.deepEqual(issueTarget(issue("INVALID_DOCUMENT", "configuration", "Catalogue introuvable"), config), { section: "configuration", elementId: "quiz-catalog" });
});

test("un avertissement de partage n'a pas de cible", () => {
  assert.equal(issueTarget(issue("SHARED_QUIZ", "publication"), config), null);
});
