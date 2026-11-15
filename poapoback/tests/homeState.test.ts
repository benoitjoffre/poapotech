import assert from "node:assert/strict";
import { test } from "node:test";
import type { DashboardSummary } from "@poapo/types";
import { createdQuizzes, homeState, homeSteps } from "../../poapoadmin/src/lib/journey";

const summary = (experiences: Partial<DashboardSummary["experiences"][number]>[], over: Partial<DashboardSummary> = {}): DashboardSummary => ({
  shop: { name: "B", email: "b@example.test", active: true }, period: { from: "", to: "", days: 30 },
  totals: { started: 0, completed: 0, productClicks: 0, accessible: experiences.filter((e) => e.accessible).length }, products: 0, catalogs: 1,
  experiences: experiences.map((e, i) => ({ id: `q${i}`, name: `Quiz ${i}`, catalog: { id: "c", name: "C" }, accessible: false, hasDraft: false, draftUpdatedAt: null, correction: null, started: 0, completed: 0, productClicks: 0, ...e })),
  nextAction: { kind: "create", quizId: null }, ...over,
});

test("accueil : nouveau commerçant, quiz par défaut vide, produits sans quiz", () => {
  assert.equal(homeState(summary([])).kind, "new");
  const empty = summary([{ questionCount: 0, correction: "Aucune question active." }]);
  assert.equal(homeState(empty).kind, "new", "le quiz par défaut vide n'est pas un quiz commencé");
  assert.deepEqual(createdQuizzes(empty), []);
  const imported = summary([{ questionCount: 0 }], { products: 20 });
  assert.equal(homeState(imported).kind, "new");
  assert.equal(homeSteps(imported).find((s) => !s.done)!.id, "quiz", "prochaine étape réelle : créer le quiz");
});

test("accueil : brouillon à reprendre, prochaine action réelle", () => {
  const draft = homeState(summary([{ questionCount: 0 }, { questionCount: 5, hasDraft: true, name: "Mon brouillon" }], { products: 3 }));
  assert.equal(draft.kind, "progress");
  assert.equal(draft.quiz?.name, "Mon brouillon");
  assert.match(draft.nextText, /publier/);
  const blocked = homeState(summary([{ questionCount: 5, correction: "Aucun produit actif recommandable." }], { products: 3 }));
  assert.match(blocked.nextText, /À corriger avant de publier : Aucun produit actif recommandable\./);
  const plain = homeState(summary([{ questionCount: 5 }], { products: 3 }));
  assert.equal(plain.kind, "progress");
  assert.match(plain.nextText, /Dernière étape/);
});

test("accueil : quiz publié, usage seulement si des visiteurs ont commencé (jamais une installation supposée)", () => {
  const live = summary([{ questionCount: 5, accessible: true }], { products: 3 });
  const s = homeState(live);
  assert.equal(s.kind, "live");
  assert.equal(s.used, false);
  assert.equal(homeSteps(live).find((x) => x.id === "site")!.done, false, "aucune installation n'est déclarée réussie");
  const used = homeState(summary([{ questionCount: 5, accessible: true }], { products: 3, totals: { started: 4, completed: 2, productClicks: 1, accessible: 1 } }));
  assert.equal(used.used, true);
});
