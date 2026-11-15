// « Modifications en cours » ne doit apparaître que s'il existe réellement des changements non publiés (modification puis retour à l'identique).
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { startIsolatedStack } = require("./support/isolatedStack.cjs");

const prisma = new PrismaClient();
const tenantId = `draftui-${randomUUID()}`;
let browser, stack, count = 0;
const eq = (a, b, m) => { count++; assert.deepEqual(a, b, m); };

async function main() {
  stack = await startIsolatedStack();
  await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test` } });
  await prisma.subscription.create({ data: { tenantId, plan: "BUSINESS", source: "LEGACY" } });
  const catalog = await prisma.catalog.create({ data: { tenantId, name: "Cafés", isDefault: true } });
  const product = await prisma.product.create({ data: { tenantId, catalogId: catalog.id, name: "Doux", tags: [], attributes: { pace: 0.2 } } });
  const quiz = await prisma.quiz.create({ data: { tenantId, catalogId: catalog.id, name: "Quiz publié", quizTitle: "Titre publié", ctaText: "Voir", active: true,
    axes: [{ key: "pace", label: "Intensité" }], useAllProducts: false, products: { create: { productId: product.id } } } });
  await prisma.question.create({ data: { tenantId, quizId: quiz.id, text: "Doux ?", order: 0,
    answers: { create: [{ text: "Oui", order: 0, impacts: { pace: -0.2 } }, { text: "Non", order: 1, impacts: { pace: 0.2 } }] } } });
  const token = jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET);
  const api = async (p) => (await fetch(stack.api + p, { headers: { Authorization: `Bearer ${token}` } })).json();
  const hasChanges = async () => (await api(`/api/quizzes/${quiz.id}/draft`)).hasChanges;

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addInitScript(([v, key]) => { localStorage.setItem("poapo_admin_token", v); localStorage.setItem(key, JSON.stringify({ status: "dismissed" })); }, [token, `poapo_tour_v1:${tenantId}`]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const title = () => page.getByLabel("Titre affiché aux visiteurs");
  const card = () => page.locator(".qz-card", { hasText: "Quiz publié" });
  const waitSaved = async (expected) => { for (let i = 0; i < 30 && (await hasChanges()) !== expected; i++) await page.waitForTimeout(300); };

  // 1. Publié, sans brouillon.
  await page.goto(`${stack.admin}/quizzes`);
  await card().waitFor({ timeout: 90_000 }); // première compilation Vite de la pile isolée
  eq(await card().getByText("Modifications en cours").count(), 0, "aucun brouillon : pas d'indicateur");

  // 2. Titre modifié, attendre l'enregistrement automatique.
  await page.goto(`${stack.admin}/experiences/${quiz.id}/edit?section=configuration`);
  await title().waitFor({ timeout: 90_000 }); // chargement initial de l'éditeur (compilation à froid)
  await title().fill("Titre modifié");
  await waitSaved(true);
  eq(await hasChanges(), true, "brouillon avec une vraie modification");
  await page.getByText("Modifications enregistrées automatiquement").first().waitFor();
  await page.goto(`${stack.admin}/quizzes`);
  await card().waitFor();
  eq(await card().getByText("Modifications en cours").count(), 1, "indicateur affiché pour une vraie modification");
  eq(await card().getByText("En ligne", { exact: true }).count(), 1, "statut principal inchangé");

  // 3. Titre remis exactement à la valeur publiée, attendre le nouvel enregistrement.
  await page.goto(`${stack.admin}/experiences/${quiz.id}/edit?section=configuration`);
  await title().waitFor();
  await title().fill("Titre publié");
  await waitSaved(false);
  const row = await prisma.quizEditorDraft.findUnique({ where: { quizId: quiz.id } });
  eq([row?.content != null, row?.revision >= 2], [true, true], "le brouillon n'est pas supprimé, seul l'indicateur change");
  await page.getByText("Tout est à jour").first().waitFor();
  eq(await page.getByText("Modifications enregistrées automatiquement").count(), 0, "éditeur : plus de modification enregistrée");
  await page.goto(`${stack.admin}/quizzes`);
  await card().waitFor();
  eq(await card().getByText("Modifications en cours").count(), 0, "Mes quiz : l'indicateur a disparu");
  eq(await card().getByRole("link", { name: /^Modifier/ }).count(), 1, "action principale : Modifier");
  eq(errors, [], "aucune erreur de page");
  console.log(`PASS: ${count} assertions (indicateur de brouillon)`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (stack) stack.stop();
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});
