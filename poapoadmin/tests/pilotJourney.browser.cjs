// Parcours pilote complet : inscription → catalogue → création express → test des recommandations → publication → widget → résultats → abonnement.
// Auth0 simulé (support/mockAuth0.cjs), pile isolée, service Python local (aucun OpenAI). Compte STARTER, sans aucune attribution de plan.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { startMockAuth0 } = require("./support/mockAuth0.cjs");
const { startIsolatedStack } = require("./support/isolatedStack.cjs");

const run = randomUUID().slice(0, 8);
const audience = "https://api.poapo.test";
const shots = process.env.POAPO_SHOTS_DIR || path.resolve(__dirname, "screenshots");
fs.mkdirSync(shots, { recursive: true });
const users = { zoe: { sub: `auth0|jz-${run}`, email: `journey-${run}@example.test`, verified: true } };
const prisma = new PrismaClient();
let idp, stack, browser, steps = 0;
const ok = (c, m) => { assert.ok(c, m); steps++; };
const shot = (page, name) => page.screenshot({ path: path.join(shots, `j-${name}.png`), fullPage: true });

(async () => {
  idp = await startMockAuth0({ port: 5170, audience, users });
  Object.assign(process.env, {
    AUTH0_ISSUER: idp.issuer, AUTH0_AUDIENCE: audience,
    VITE_AUTH0_DOMAIN: "http://localhost:5170", VITE_AUTH0_CLIENT_ID: "poapo-spa-test", VITE_AUTH0_AUDIENCE: audience,
  });
  stack = await startIsolatedStack();
  browser = await chromium.launch({ headless: true });
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const apiCalls = [];
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) apiCalls.push(`${r.status()} ${r.url().replace(stack.api, "")}`); });

  // 1. Inscription + boutique (STARTER).
  await page.goto(stack.admin + "/login");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.locator("#as-zoe").click();
  await page.waitForURL("**/onboarding");
  await page.getByLabel("Nom de la boutique").fill("Maison Voyage");
  await page.getByLabel("Secteur d'activité").fill("Voyage");
  await page.getByRole("button", { name: "Créer ma boutique" }).click();
  await page.getByRole("button", { name: "Passer la visite" }).click();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { email: users.zoe.email } });
  ok((await prisma.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id } })).plan === "STARTER", "STARTER à l'inscription");

  // 2. Catalogue : catalogue par défaut présent, produits caractérisés (import CSV déjà couvert par auth0.browser.cjs).
  await page.goto(stack.admin + "/catalogs");
  await page.getByText("Catalogue principal").first().waitFor();
  const catalog = await prisma.catalog.findFirstOrThrow({ where: { tenantId: tenant.id } });
  const rows = [["Week-end nature", 0.2, 0.3], ["Citytrip culturel", 0.5, 0.5], ["Safari aventure", 0.9, 0.9], ["Cure thermale", 0.1, 0.6], ["Road trip", 0.8, 0.4], ["Séjour ski", 0.7, 0.8]];
  await prisma.product.createMany({ data: rows.map(([name, rythme, budget]) => ({ tenantId: tenant.id, catalogId: catalog.id, name, tags: [], price: 100 + budget * 1000,
    attributes: { rythme, budget }, purchaseUrl: "http://127.0.0.1:9/achat" })) });
  await page.goto(stack.admin + "/catalog");
  await page.getByText("Safari aventure").first().waitFor();
  ok(true, "catalogue de 6 produits");
  // Enrichissement IA : verrouillé en STARTER (message clair, aucun appel IA).
  await page.goto(`${stack.admin}/enrichment?catalogId=${catalog.id}`);
  await page.getByTestId("enrichment-locked").waitFor();
  ok(true, "enrichissement IA réservé à PRO/BUSINESS, message clair");
  await shot(page, "01-enrichissement-verrouille");

  // 3. Création express (autorisée en STARTER).
  await page.goto(stack.admin + "/experiences/new/express");
  await page.getByRole("button", { name: /Analyser mon catalogue/ }).click();
  for (let i = 0; i < 6 && !(await page.getByRole("heading", { name: /Enregistrer en brouillon/ }).isVisible()); i++) {
    await page.getByRole("heading", { name: /^[2-5]\./ }).first().waitFor({ timeout: 30000 });
    if (await page.getByRole("heading", { name: /Prévisualisation/ }).isVisible()) {
      // 4. Test des recommandations (vrai moteur, service local).
      for (const fs_ of await page.locator("fieldset").all()) await fs_.locator("input[type=radio]").first().check();
      await page.getByRole("button", { name: "Voir les recommandations" }).click();
      await page.locator("[role=status] ol li").first().waitFor({ timeout: 30000 });
      ok(true, "recommandations de test affichées");
      await shot(page, "02-express-apercu");
    }
    await page.locator(".xw-footer .btn-primary").click();
  }
  await page.getByRole("heading", { name: /Enregistrer en brouillon/ }).waitFor();
  const ack = page.getByLabel(/Je comprends que les données/);
  if (await ack.count()) await ack.check();
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await page.waitForURL(/\/experiences\/(?!new)[^/]+\/(edit|setup)/, { timeout: 30000 });
  const quiz = await prisma.quiz.findFirstOrThrow({ where: { tenantId: tenant.id, NOT: { id: { startsWith: "default_" } } }, orderBy: { createdAt: "desc" } });
  ok(quiz.active === false, "expérience créée inactive");
  await page.getByText("Chargement de l'éditeur").waitFor({ state: "detached", timeout: 30000 });
  await shot(page, "03-editeur");

  // 5. Publication : vérification puis mise en ligne (STARTER : 1 expérience publiée autorisée).
  await page.goto(`${stack.admin}/experiences/${quiz.id}/setup?step=5`);
  await page.getByRole("heading", { name: "Vérifier et publier" }).waitFor({ timeout: 30000 });
  const publish = page.getByRole("button", { name: "Publier et rendre accessible" });
  await publish.waitFor();
  await shot(page, "04-publication");
  await publish.click();
  await page.getByRole("heading", { name: "Expérience publiée" }).waitFor({ timeout: 30000 });
  ok((await prisma.quiz.findUniqueOrThrow({ where: { id: quiz.id } })).active === true, "expérience active après publication");
  await shot(page, "05-publiee");

  // 6. Widget public (mobile) : parcours complet jusqu'à la recommandation.
  const w = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await w.goto(`${stack.widget}/?clientId=${tenant.id}&quizId=${quiz.id}`);
  await w.locator("button.submit").first().click();
  const questions = await prisma.question.count({ where: { quizId: quiz.id, active: true } });
  for (let i = 0; i < questions; i++) {
    const options = w.locator("label.option");
    await options.first().waitFor();
    await options.first().click();
  }
  if (await w.locator("button.submit[type=submit]").isVisible().catch(() => false)) await w.locator("button.submit[type=submit]").click();
  await w.locator(".result").waitFor({ timeout: 30000 });
  ok(await prisma.quizSession.count({ where: { tenantId: tenant.id, quizId: quiz.id } }) === 1, "session de recommandation créée");
  ok((await prisma.usageCounter.findFirstOrThrow({ where: { tenantId: tenant.id } })).recommendations === 1, "1 recommandation comptée");
  await shot(w, "06-widget-resultat");

  // 7. Résultats (analytics essentiels, STARTER) puis 8. Abonnement.
  await page.goto(stack.admin + "/analytics");
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.waitForLoadState("networkidle");
  await shot(page, "07-resultats");
  const basePage = await page.locator("body").innerText();
  ok(!/Erreur|non inclus|réservé aux/i.test(basePage), "résultats essentiels sans erreur ni blocage en STARTER");
  await page.goto(stack.admin + "/settings/subscription");
  await page.getByRole("heading", { name: "Formule Starter" }).waitFor();
  const text = await page.getByTestId("quota-recommendationsPerMonth").innerText();
  ok(text.replace(/\s/g, " ").includes("1 / 100"), "abonnement : 1 / 100 recommandations");
  ok((await page.getByTestId("quota-publishedExperiences").innerText()).includes("1 / 1"), "abonnement : 1 / 1 expérience publiée");
  await shot(page, "08-abonnement");
  const unexpected = apiCalls.filter((c) => !c.includes("/enrichment/context"));
  ok(unexpected.length === 0, "aucune réponse d'erreur API inattendue : " + unexpected.join(" | "));
  ok(errors.length === 0, "aucune erreur JS : " + errors.join(" | "));
  console.log(`pilot journey OK (${steps} checks)`);
  await browser.close();
  return;
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await prisma.user.deleteMany({ where: { auth0Sub: { in: Object.values(users).map((u) => u.sub) } } }).catch(() => {});
  await prisma.tenant.deleteMany({ where: { email: { in: Object.values(users).map((u) => u.email) } } }).catch(() => {});
  await browser?.close().catch(() => {}); stack?.stop(); idp?.stop(); await prisma.$disconnect(); setTimeout(() => process.exit(), 200);
});
