import assert from "node:assert/strict";
import { test } from "node:test";
import type { DashboardSummary } from "@poapo/types";
import { detectSector, type ExpressContext, type ExpressProduct } from "../src/services/expressQuiz";
import { proposeExpressQuiz } from "../src/services/expressQuiz";
import { homeSteps } from "../../poapoadmin/src/lib/journey";

const product = (name: string, description: string, tags: string[] = []): ExpressProduct =>
  ({ id: name, name, brand: null, description, tags, attributes: {}, embeddingReady: false });
const context = (over: Partial<ExpressContext>): ExpressContext =>
  ({ catalogId: "c", catalogName: "Catalogue principal", catalogDescription: null, industry: "", existingAxes: [], products: [], ...over });
// Fiches sans le mot « parfum » : seule l'activité saisie à l'inscription permet de reconnaître le secteur.
const fiches = [product("Aube", "Citron et bergamote, vif."), product("Nuit", "Oud et patchouli."), product("Forêt", "Cèdre et vétiver.")];

test("detectSector : « parfumerie(s) » reconnu comme activité, sans régression", () => {
  for (const industry of ["Parfumerie", "parfumerie", "PARFUMERIES", "Ma parfumerie artisanale", "Parfum", "Parfums"]) {
    assert.equal(detectSector(context({ industry, products: fiches }))?.id, "perfume", industry);
  }
  // Détections existantes préservées.
  assert.equal(detectSector(context({ industry: "Café", products: fiches }))?.id, "coffee");
  assert.equal(detectSector(context({ industry: "Voyage", products: fiches }))?.id, "travel");
  assert.equal(detectSector(context({ products: [product("Eau", "Eau de parfum intense"), product("Musc", "Un musc blanc"), product("Colonia", "Cologne fraîche")] }))?.id, "perfume");
  // Pas de faux positif : autre activité, mot voisin, aucune donnée.
  assert.equal(detectSector(context({ industry: "Boulangerie", products: fiches })), null);
  assert.equal(detectSector(context({ industry: "Parfumeur", products: fiches }))?.id ?? null, null, "« parfumeur » seul n'est pas un motif existant");
  assert.equal(detectSector(context({ products: fiches })), null);
});

test("Express : aucun secteur reconnu ne renvoie plus vers une création manuelle inexistante", () => {
  const proposal = proposeExpressQuiz(context({ products: fiches }));
  assert.equal(proposal.draft, null);
  const text = proposal.analysis.messages.join(" ");
  assert.doesNotMatch(text, /création manuelle|manuel/i);
  assert.match(text, /Choisissez un modèle de départ/);
  // Avec l'activité « Parfumerie », le modèle est reconnu et un brouillon est proposé.
  assert.ok(proposeExpressQuiz(context({ industry: "Parfumerie", products: fiches })).draft);
});

const summary = (experiences: Partial<DashboardSummary["experiences"][number]>[], products = 3): DashboardSummary => ({
  shop: { name: "Boutique", email: "x@example.test", active: true }, period: { from: "", to: "", days: 30 },
  totals: { started: 0, completed: 0, productClicks: 0, accessible: experiences.filter((e) => e.accessible).length }, products, catalogs: 1,
  experiences: experiences.map((e, i) => ({ id: `q${i}`, name: `Quiz ${i}`, catalog: { id: "c", name: "C" }, accessible: false, hasDraft: false, draftUpdatedAt: null, correction: null, started: 0, completed: 0, productClicks: 0, ...e })),
  nextAction: { kind: "create", quizId: null },
});
const done = (s: DashboardSummary) => homeSteps(s).filter((step) => step.done).map((step) => step.id);

test("homeSteps : le quiz par défaut vide n'est pas un quiz créé", () => {
  assert.deepEqual(done(summary([{ questionCount: 0, correction: "Aucune question active." }])), ["products"], "produits ajoutés, quiz par défaut vide");
  assert.deepEqual(done(summary([{ questionCount: 0 }], 0)), []);
  // Un quiz avec des questions, ou avec un brouillon enregistré, compte.
  assert.deepEqual(done(summary([{ questionCount: 5 }])), ["products", "quiz"]);
  assert.deepEqual(done(summary([{ questionCount: 0, hasDraft: true }])), ["products", "quiz"]);
  // Publié : les étapes « Publiez-le » et suivantes restent pilotées par l'accessibilité.
  assert.deepEqual(done(summary([{ questionCount: 4, accessible: true }])), ["products", "quiz", "publish"]);
  // Anciennes réponses sans questionCount : comportement inchangé (le quiz compte).
  assert.deepEqual(done(summary([{}])), ["products", "quiz"]);
  // Le quiz par défaut vide ne détourne pas le bouton « Publier » : il pointe vers la création.
  const steps = homeSteps(summary([{ questionCount: 0 }]));
  assert.equal(steps.find((step) => step.id === "publish")!.to, "/experiences/new");
  // Avec un quiz créé en plus du quiz par défaut vide, le bouton pointe vers le bon quiz.
  const two = homeSteps(summary([{ questionCount: 0 }, { questionCount: 5 }]));
  assert.match(two.find((step) => step.id === "publish")!.to, /\/experiences\/q1\/edit/);
});
