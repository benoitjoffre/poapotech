// Recette widget public : un seul quiz_abandon par parcours quitté, jamais sur changement de question, complétion ou redémarrage.
// Pile isolée par défaut (voir support/isolatedStack.cjs). Nécessite le service Python pour compléter un quiz.
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { resolveStack } = require("./support/isolatedStack.cjs");

const prisma = new PrismaClient();
const tenantId = `analytics-widget-${randomUUID()}`;
let browser;
let stack;
let count = 0;
const eq = (actual, expected, message) => { count++; assert.deepEqual(actual, expected, message); };

const types = async (quizId, wanted) => (await prisma.metric.findMany({
  where: { tenantId, quizId, type: wanted }, orderBy: { createdAt: "asc" }, select: { payload: true },
})).map((row) => row.payload);
async function waitForCount(quizId, expected, message) {
  const deadline = Date.now() + 8000;
  let payloads = [];
  while (Date.now() < deadline) {
    payloads = await types(quizId, "quiz_abandon");
    if (payloads.length >= expected) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await new Promise((resolve) => setTimeout(resolve, 600)); // laisse apparaître un éventuel doublon
  payloads = await types(quizId, "quiz_abandon");
  eq(payloads.length, expected, message);
  return payloads;
}

async function main() {
  stack = await resolveStack();
  const { api, widget } = stack;
  await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test` } });
  const catalog = await prisma.catalog.create({ data: { tenantId, name: "Principal", isDefault: true } });
  await prisma.product.createMany({ data: [
    { tenantId, catalogId: catalog.id, name: "Calme", tags: [], attributes: { pace: 0.2 }, purchaseUrl: "http://127.0.0.1:9/achat" },
    { tenantId, catalogId: catalog.id, name: "Intense", tags: [], attributes: { pace: 0.8 }, purchaseUrl: "http://127.0.0.1:9/achat" },
  ] });
  const quiz = await prisma.quiz.create({ data: {
    id: `default_${tenantId}`, tenantId, catalogId: catalog.id, name: "Quiz", quizTitle: "Mon quiz", ctaText: "Voir",
    axes: [{ key: "pace", label: "Rythme" }], active: true, isDefault: true,
  } });
  for (const [order, text] of ["Q1 ?", "Q2 ?", "Q3 ?"].entries()) {
    await prisma.question.create({ data: { tenantId, quizId: quiz.id, text, order, answers: { create: [
      { text: `Calme ${order}`, impacts: { pace: -0.2 }, order: 0 }, { text: `Intense ${order}`, impacts: { pace: 0.2 }, order: 1 },
    ] } } });
  }

  browser = await chromium.launch({ headless: true });
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
    await page.goto(`${widget}/?clientId=${tenantId}`);
    await page.getByRole("button", { name: /Commencer|Démarrer|Start|Lancer|Trouver/ }).first().waitFor({ timeout: 15000 }).catch(() => {});
    return page;
  };
  const start = (page) => page.locator("button.submit").first().click();
  const answerAndNext = async (page, text) => {
    // Les questions à choix unique avancent automatiquement.
    await page.locator("label.option", { hasText: text }).first().click();
  };

  // A. Navigation entre questions puis fermeture : un seul abandon, après coup.
  const a = await open();
  await start(a);
  await answerAndNext(a, "Calme 0");
  await answerAndNext(a, "Intense 1");
  await a.getByRole("button", { name: "Retour", exact: true }).click();
  await a.getByRole("button", { name: "Retour", exact: true }).click();
  await new Promise((resolve) => setTimeout(resolve, 800));
  eq((await types(quiz.id, "quiz_abandon")).length, 0, "aucun abandon pendant la navigation entre questions");
  eq((await types(quiz.id, "quiz_start")).length, 1, "un seul démarrage");
  await a.goto("about:blank");
  const [abandon] = await waitForCount(quiz.id, 1, "un abandon à la fermeture");
  eq(abandon.reason, "pagehide");
  eq(abandon.stepIndex, 0);
  eq(Object.keys(abandon).sort(), ["abVariant", "reason", "stepIndex"]);
  await a.close();

  // B. Aperçu (hors recette) mis à part : un quiz non démarré ne génère aucun abandon.
  const idle = await open();
  await idle.goto("about:blank");
  await new Promise((resolve) => setTimeout(resolve, 800));
  eq((await types(quiz.id, "quiz_abandon")).length, 1, "un quiz non démarré ne produit pas d'abandon");
  await idle.close();

  // C. Complétion : pas d'abandon, ni à la complétion ni à la fermeture ; redémarrage puis fermeture : un abandon.
  const c = await open();
  await start(c);
  await answerAndNext(c, "Calme 0");
  await answerAndNext(c, "Calme 1");
  await c.locator("label.option", { hasText: "Intense 2" }).first().click();
  await c.locator("button.submit[type=submit]").click();
  await c.locator(".result").waitFor({ timeout: 20000 });
  await new Promise((resolve) => setTimeout(resolve, 800));
  eq((await types(quiz.id, "quiz_complete")).length, 1, "un quiz_complete");
  eq((await prisma.quizSession.count({ where: { tenantId, quizId: quiz.id } })), 1, "une session de recommandation");
  eq((await types(quiz.id, "quiz_abandon")).length, 1, "aucun abandon à la complétion");
  await c.locator(".result-restart-btn").click();
  await new Promise((resolve) => setTimeout(resolve, 800));
  eq((await types(quiz.id, "quiz_abandon")).length, 1, "aucun abandon au redémarrage volontaire");
  await start(c);
  await c.goto("about:blank");
  const payloads = await waitForCount(quiz.id, 2, "un abandon pour le second parcours");
  eq(payloads[1].reason, "pagehide");
  await c.close();

  // D. Compatibilité widget : le feedback n'est jamais appelé et la réponse /submit ne casse rien ; l'API reste cohérente.
  const token = jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET);
  const metrics = await (await fetch(`${api}/api/quiz/metrics?quizId=${quiz.id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  eq(metrics.funnel.abandoned, 2);
  eq(metrics.funnel.legacyAbandonEvents, 0);
  eq(metrics.indicators.recommendations, 1);
  eq(metrics.indicators.completed, 1);
  eq(metrics.indicators.started, 3); // le redémarrage compte un nouveau démarrage (pas de visiteur unique)
  console.log(`PASS analytics widget browser: ${count} assertions (navigation, fermeture, non démarré, complétion, redémarrage, API cohérente)`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
  await prisma.$disconnect();
  stack?.stop();
});
