// Quota « Quiz en ligne » (Starter : 1) : la publication qui activerait un second quiz est refusée avec un message clair.
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { startIsolatedStack } = require("./support/isolatedStack.cjs");

const prisma = new PrismaClient();
const tenantId = `quota-ui-${randomUUID()}`;
let browser, stack, count = 0;
const ok = (v, m) => { count++; assert.ok(v, m); };

async function main() {
  stack = await startIsolatedStack();
  await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test` } }); // sans abonnement : formule Starter par défaut
  const catalog = await prisma.catalog.create({ data: { tenantId, name: "Cafés", isDefault: true } });
  const product = await prisma.product.create({ data: { tenantId, catalogId: catalog.id, name: "Doux", tags: [], attributes: { pace: 0.2 } } });
  const mk = async (name, active) => {
    const quiz = await prisma.quiz.create({ data: { tenantId, catalogId: catalog.id, name, quizTitle: `${name} titre`, ctaText: "Voir", active,
      axes: [{ key: "pace", label: "Intensité" }], useAllProducts: false, products: { create: { productId: product.id } } } });
    await prisma.question.create({ data: { tenantId, quizId: quiz.id, text: "Doux ?", order: 0,
      answers: { create: [{ text: "Oui", order: 0, impacts: { pace: -0.2 } }, { text: "Non", order: 1, impacts: { pace: 0.2 } }] } } });
    return quiz;
  };
  await mk("En ligne", true);
  const second = await mk("Second quiz", false);

  const token = jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addInitScript(([v, key]) => { localStorage.setItem("poapo_admin_token", v); localStorage.setItem(key, JSON.stringify({ status: "dismissed" })); }, [token, `poapo_tour_v1:${tenantId}`]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${stack.admin}/experiences/${second.id}/edit?section=publication`);
  await page.getByRole("heading", { name: "Publier mon expérience" }).waitFor();
  await page.getByRole("button", { name: "Publier et rendre accessible" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "limite de quiz en ligne" });
  await alert.waitFor();
  const text = await alert.innerText();
  ok(/Désactivez un autre quiz ou changez de formule/.test(text) && /enregistrées dans le brouillon/.test(text), "message de quota explicite");
  ok(!/Réessayez/.test(text) && !/expériences publiées/.test(text), "pas d'invitation à réessayer ni de vocabulaire obsolète");
  ok(await alert.getByRole("link", { name: "Voir mon abonnement" }).getAttribute("href") === "/settings/subscription", "lien vers l'abonnement");
  ok(!(await prisma.quiz.findUnique({ where: { id: second.id } })).active, "aucune activation persistée");
  ok((await prisma.quizEditorDraft.findUnique({ where: { quizId: second.id } }))?.content != null, "brouillon conservé");

  await alert.getByRole("link", { name: "Voir mon abonnement" }).click();
  const quota = page.getByTestId("quota-publishedExperiences");
  await quota.waitFor();
  const quotaText = (await quota.innerText()).replace(/\s+/g, " ");
  ok(/Quiz en ligne/.test(quotaText) && /1 \/ 1/.test(quotaText) && /limite atteinte/.test(quotaText), `page Abonnement : ${quotaText}`);
  ok((await page.getByTestId("sidebar-plan-publishedExperiences").innerText()).replace(/\s+/g, " ").includes("Quiz en ligne 1 / 1"), "menu : Quiz en ligne 1 / 1");

  await page.goto(`${stack.admin}/quizzes`);
  const second_card = page.locator(".qz-card", { hasText: "Second quiz" });
  await second_card.waitFor();
  ok(await second_card.getByText("Hors ligne", { exact: true }).count() === 1 && await second_card.getByText("Quiz désactivé").count() === 1, "statut : publié mais désactivé");
  ok(await second_card.getByText("Modifications en cours").count() === 1 && await second_card.getByRole("link", { name: /^Reprendre le brouillon/ }).count() === 1, "brouillon signalé en secondaire, reprise proposée");
  ok(errors.length === 0, errors.join("\n"));
  console.log(`PASS: ${count} browser assertions (quota Starter)`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (stack) stack.stop();
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});
