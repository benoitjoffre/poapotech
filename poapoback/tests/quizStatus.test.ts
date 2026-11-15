import test from "node:test";
import assert from "node:assert/strict";
import { quizStatus, matchesQuizFilter, primaryActionLabel } from "../../poapoadmin/src/lib/experiences";

// Une version publiée = des questions actives en ligne ; `accessible` = quiz actif ET boutique active.
const quiz = (over: Partial<{ accessible: boolean; active: boolean; hasDraft: boolean; questionCount: number }> = {}) =>
  ({ accessible: false, active: false, hasDraft: false, questionCount: 5, ...over });
const view = (q: ReturnType<typeof quiz>, shopActive = true) => {
  const s = quizStatus(q, shopActive);
  return { label: s.label, note: s.note, reason: s.reason, action: primaryActionLabel(q, s) };
};

test("jamais publié, quiz par défaut vide", () => {
  assert.deepEqual(view(quiz({ questionCount: 0 })), { label: "À terminer", note: null, reason: null, action: "Continuer" });
});

test("jamais publié avec brouillon en cours : reprise du brouillon", () => {
  assert.deepEqual(view(quiz({ questionCount: 0, hasDraft: true })), { label: "À terminer", note: null, reason: null, action: "Reprendre le brouillon" });
});

test("publié et accessible", () => {
  assert.deepEqual(view(quiz({ accessible: true, active: true })), { label: "En ligne", note: null, reason: null, action: "Modifier" });
});

test("publié et accessible avec brouillon : reste « En ligne », mention secondaire", () => {
  const v = view(quiz({ accessible: true, active: true, hasDraft: true }));
  assert.deepEqual([v.label, v.note, v.action], ["En ligne", "Modifications en cours", "Modifier"]);
});

test("publié mais désactivé", () => {
  assert.deepEqual(view(quiz()), { label: "Hors ligne", note: null, reason: "Quiz désactivé", action: "Modifier" });
});

test("publié, désactivé et brouillon : un seul statut principal + modifications en cours", () => {
  assert.deepEqual(view(quiz({ hasDraft: true })), { label: "Hors ligne", note: "Modifications en cours", reason: "Quiz désactivé", action: "Reprendre le brouillon" });
});

test("boutique désactivée : un quiz actif publié est hors ligne à cause de la boutique, pas du quiz", () => {
  assert.deepEqual(view(quiz({ active: true }), false), { label: "Hors ligne", note: null, reason: "Boutique désactivée", action: "Modifier" });
});

test("boutique désactivée : un quiz jamais publié reste « À terminer »", () => {
  assert.equal(view(quiz({ questionCount: 0, active: false }), false).label, "À terminer");
});

test("quiz accessible sans question active (donnée héritée) : reste visible comme en ligne, jamais masqué", () => {
  assert.equal(view(quiz({ accessible: true, active: true, questionCount: 0 })).label, "En ligne");
});

test("filtres : en ligne n'inclut jamais un quiz fermé ou à terminer", () => {
  const cases = [quiz({ accessible: true, active: true }), quiz({ accessible: true, active: true, hasDraft: true }), quiz(), quiz({ hasDraft: true }), quiz({ questionCount: 0 })];
  const online = cases.filter((c) => matchesQuizFilter(quizStatus(c), "online"));
  assert.equal(online.length, 2);
  assert.ok(online.every((c) => c.accessible));
  assert.equal(cases.filter((c) => matchesQuizFilter(quizStatus(c), "to-finish")).length, 3);
  assert.equal(cases.filter((c) => matchesQuizFilter(quizStatus(c), "all")).length, 5);
});
