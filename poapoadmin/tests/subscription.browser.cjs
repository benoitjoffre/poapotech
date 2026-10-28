// Recette abonnements : onboarding Auth0 → STARTER, page « Mon abonnement », attribution PRO par le super-admin (UI),
// expiration, widget avec quota disponible / épuisé, retry avec la même clé d'idempotence, affichage mobile.
// Fournisseur Auth0 simulé (support/mockAuth0.cjs), pile isolée, service Python local requis pour compléter un quiz (aucun OpenAI).
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
const users = {
  alice: { sub: `auth0|sa-${run}`, email: `sub-alice-${run}@example.test`, verified: true },
  root: { sub: `auth0|sr-${run}`, email: `sub-root-${run}@example.test`, verified: true },
};
const prisma = new PrismaClient();
let idp, stack, browser, steps = 0, tenantId;
const ok = (c, m) => { assert.ok(c, m); steps++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });

async function signIn(page, who, signup = false) {
  await page.goto(stack.admin + "/login");
  await page.getByRole("button", { name: signup ? "Créer mon compte" : "Se connecter" }).click();
  await page.locator(`#as-${who}`).click();
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const counter = async () => (await prisma.usageCounter.findFirst({ where: { tenantId } }))?.recommendations ?? 0;

async function playWidget(page, { expectResult }) {
  await page.goto(`${stack.widget}/?clientId=${tenantId}&quizId=${quizId}`);
  await page.locator("button.submit").first().click();
  await page.locator("label.option", { hasText: "Calme" }).first().click();
  await page.locator("label.option", { hasText: "Intense" }).first().click();
  await page.locator("button.submit[type=submit]").click();
  if (expectResult) await page.locator(".result").waitFor({ timeout: 20000 });
}
let quizId;

(async () => {
  idp = await startMockAuth0({ port: 5170, audience, users });
  Object.assign(process.env, {
    AUTH0_ISSUER: idp.issuer, AUTH0_AUDIENCE: audience, SUPER_ADMIN_EMAIL: users.root.email,
    VITE_AUTH0_DOMAIN: "http://localhost:5170", VITE_AUTH0_CLIENT_ID: "poapo-spa-test", VITE_AUTH0_AUDIENCE: audience,
  });
  stack = await startIsolatedStack();
  browser = await chromium.launch({ headless: true });
  const errors = [];

  // 1. Inscription + onboarding → STARTER automatique.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  let aliceToken = null;
  page.on("request", (r) => { const h = r.headers()["authorization"]; if (h && r.url().includes("/api/")) aliceToken = h.replace("Bearer ", ""); });
  await signIn(page, "alice", true);
  await page.waitForURL("**/onboarding");
  await page.getByLabel("Nom de la boutique").fill("Boutique Abo");
  await page.getByLabel("Secteur d'activité").fill("Café de spécialité");
  await page.getByRole("button", { name: "Créer ma boutique" }).click();
  await page.getByRole("dialog", { name: "Bienvenue sur POAPO !" }).waitFor();
  await page.getByRole("button", { name: "Passer la visite" }).click();
  tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { email: users.alice.email } })).id;
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { tenantId } });
  ok(sub.plan === "STARTER" && sub.status === "ACTIVE" && sub.source === "SIGNUP" && !sub.endsAt && !sub.stripeCustomerId, "abonnement STARTER créé à l'inscription");

  // 2. Page « Mon abonnement » (accès depuis les paramètres).
  await page.goto(stack.admin + "/settings");
  await page.getByRole("link", { name: "Voir mon abonnement", exact: true }).click();
  await page.getByRole("heading", { name: "Formule Starter" }).waitFor();
  ok((await page.getByTestId("quota-catalogs").innerText()).includes("/ 1"), "quota catalogues 1");
  ok((await page.getByTestId("quota-publishedExperiences").innerText()).includes("0") , "0 expérience publiée");
  ok((await page.getByTestId("quota-recommendationsPerMonth").innerText()).includes("/ 100"), "quota recommandations 100");
  ok((await page.getByTestId("feature-campaigns").innerText()).includes("non inclus"), "campagnes non incluses en STARTER");
  ok(await page.getByText("Offert pendant le pilote").count() === 0, "pas de mention pilote en STARTER");
  await page.getByRole("button", { name: "Découvrir les formules" }).click();
  const plans = page.getByTestId("plans");
  await plans.waitFor();
  const plansText = await plans.innerText();
  ok(/Starter/.test(plansText) && /Pro/.test(plansText) && /Business/.test(plansText) && !/[€$]|\bEUR\b/.test(plansText), "comparatif des formules sans prix");
  ok(await page.getByText(/paiement|carte bancaire/i).count() === 0, "aucun tunnel de paiement");
  const side = page.getByTestId("sidebar-plan");
  ok((await side.innerText()).includes("Formule Starter") && (await page.getByTestId("sidebar-plan-recommendationsPerMonth").innerText()).replace(/\s/g, " ").includes("0 / 100"), "menu : formule et quotas toujours visibles");
  await shot(page, "01-starter-desktop");

  // 3. Mobile.
  const mobile = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signIn(mobile, "alice");
  await mobile.waitForURL(stack.admin + "/");
  await mobile.getByRole("button", { name: "Passer la visite" }).click({ timeout: 8000 }).catch(() => {}); // visite guidée propre à chaque navigateur
  await mobile.goto(stack.admin + "/settings/subscription");
  await mobile.getByRole("heading", { name: "Formule Starter" }).waitFor();
  await mobile.getByRole("button", { name: "Découvrir les formules" }).click();
  await mobile.getByTestId("plans").waitFor();
  ok(await noHorizontalScroll(mobile), "mobile : pas de défilement horizontal");
  await shot(mobile, "02-starter-mobile");

  // 4. Un commerçant ne peut pas modifier son plan.
  ok(!!aliceToken, "jeton marchand capturé");
  for (const [method, url] of [["PUT", `/api/admin/tenants/${tenantId}/subscription`], ["PUT", "/api/subscription"], ["POST", "/api/subscription"]]) {
    const r = await fetch(stack.api + url, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${aliceToken}` }, body: JSON.stringify({ plan: "BUSINESS" }) });
    ok([403, 404].includes(r.status), `${method} ${url} refusé (${r.status})`);
  }
  ok((await prisma.subscription.findUniqueOrThrow({ where: { tenantId } })).plan === "STARTER", "plan inchangé");

  // 5. Widget : expérience active, quota disponible.
  const catalog = await prisma.catalog.findFirstOrThrow({ where: { tenantId } });
  await prisma.product.createMany({ data: [
    { tenantId, catalogId: catalog.id, name: "Calme", tags: [], attributes: { pace: 0.2 } },
    { tenantId, catalogId: catalog.id, name: "Intense", tags: [], attributes: { pace: 0.8 } },
  ] });
  const quiz = await prisma.quiz.create({ data: { tenantId, catalogId: catalog.id, name: "Quiz abo", quizTitle: "Mon quiz", ctaText: "Voir",
    axes: [{ key: "pace", label: "Rythme" }], active: true } });
  quizId = quiz.id;
  for (const [order, text] of ["Q1 ?", "Q2 ?"].entries()) {
    await prisma.question.create({ data: { tenantId, quizId, text, order, answers: { create: [
      { text: `Calme ${order}`, impacts: { pace: -0.2 }, order: 0 }, { text: `Intense ${order}`, impacts: { pace: 0.2 }, order: 1 } ] } } });
  }
  const w1 = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await playWidget(w1, { expectResult: true });
  ok(await counter() === 1 && await prisma.quizSession.count({ where: { tenantId } }) === 1, "quota disponible : recommandation servie et comptée");
  await shot(w1, "03-widget-quota-ok-mobile");
  ok(await noHorizontalScroll(w1), "widget mobile sans défilement horizontal");
  await page.goto(stack.admin + "/settings/subscription");
  await page.getByRole("heading", { name: "Formule Starter" }).waitFor();
  ok((await page.getByTestId("quota-recommendationsPerMonth").innerText()).replace(/\s/g, " ").includes("1 / 100"), "consommation affichée 1 / 100");
  ok((await page.getByTestId("quota-publishedExperiences").innerText()).includes("1 / 1") && (await page.getByTestId("quota-publishedExperiences").innerText()).includes("limite atteinte"), "expérience publiée 1 / 1, limite signalée");
  ok((await page.getByTestId("sidebar-plan-recommendationsPerMonth").innerText()).replace(/\s/g, " ").includes("1 / 100"), "menu : consommation mise à jour");

  // 6. Retry avec la même clé : la 1re réponse est perdue côté navigateur après traitement serveur.
  const bodies = [];
  const w2 = await browser.newPage({ viewport: { width: 375, height: 800 } });
  let first = true;
  await w2.route("**/api/quiz/submit", async (route) => {
    bodies.push(JSON.parse(route.request().postData()));
    if (first) { first = false; await route.fetch(); await route.abort("failed"); return; }
    await route.continue();
  });
  await playWidget(w2, { expectResult: false });
  await w2.getByRole("alert").or(w2.locator(".error, .form-error")).first().waitFor({ timeout: 15000 });
  await w2.locator("button.submit[type=submit]").click(); // retry
  await w2.locator(".result").waitFor({ timeout: 20000 });
  ok(bodies.length === 2 && bodies[0].idempotencyKey && bodies[0].idempotencyKey === bodies[1].idempotencyKey, "retry avec la même clé d'idempotence");
  ok(await counter() === 2 && await prisma.quizSession.count({ where: { tenantId } }) === 2, "le retry n'a consommé qu'une unité");

  // 7. Quota épuisé : message clair, aucune session ni consommation.
  await prisma.usageCounter.updateMany({ where: { tenantId }, data: { recommendations: 100 } });
  const sessions = await prisma.quizSession.count({ where: { tenantId } });
  const w3 = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await playWidget(w3, { expectResult: false });
  await w3.getByText(/momentanément indisponible/).waitFor({ timeout: 15000 });
  const text = await w3.locator("body").innerText();
  ok(!/quota|STARTER|plan|limite|403|429|Erreur/i.test(text.replace(/momentanément indisponible/g, "")), "message utilisateur non technique");
  ok(await counter() === 100 && await prisma.quizSession.count({ where: { tenantId } }) === sessions, "quota épuisé : rien n'est consommé ni créé");
  await shot(w3, "04-widget-quota-epuise-mobile");

  // 8. Super-admin : attribution PRO via l'interface, avec échéance, et historique.
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await rctx.newPage();
  admin.on("pageerror", (e) => errors.push(e.message));
  await signIn(admin, "root");
  await admin.waitForURL("**/admin/tenants");
  await admin.getByPlaceholder(/Rechercher/i).fill(users.alice.email).catch(() => {});
  const row = admin.getByRole("row", { name: new RegExp(users.alice.email) });
  await row.waitFor({ timeout: 15000 });
  await row.getByRole("button", { name: "Abonnement" }).click();
  const panel = admin.getByTestId("tenant-subscription");
  await panel.waitFor();
  ok((await panel.getByTestId("tenant-plan").innerText()) === "Starter", "super-admin voit le plan STARTER");
  await panel.getByLabel("Plan à attribuer").selectOption("PRO");
  const tomorrow = new Date(Date.now() + 864e5 * 2).toISOString().slice(0, 10);
  await panel.getByLabel("Date d'expiration").fill(tomorrow);
  await panel.getByRole("button", { name: "Attribuer" }).click();
  await admin.getByTestId("tenant-plan").filter({ hasText: "Pro" }).waitFor();
  ok((await admin.getByTestId("tenant-history").innerText()).includes("STARTER → PRO"), "historique mis à jour");
  await shot(admin, "05-admin-attribution-pro");
  const proSub = await prisma.subscription.findUniqueOrThrow({ where: { tenantId } });
  ok(proSub.plan === "PRO" && proSub.source === "PROMO" && !!proSub.endsAt, "PRO offert avec échéance en base");

  // Le fournisseur simulé garde un seul utilisateur « courant » : le commerçant se reconnecte après le super-admin.
  page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "alice");
  await page.waitForURL(stack.admin + "/");
  await page.getByRole("button", { name: "Passer la visite" }).click({ timeout: 8000 }).catch(() => {});
  await page.goto(stack.admin + "/settings/subscription");
  await page.getByRole("heading", { name: /Formule/ }).waitFor({ timeout: 10000 }).catch(async () => { console.log("BODY:", (await page.locator("body").innerText()).slice(0, 400), page.url()); });
  if (process.env.DBG) console.log("HEADING:", await page.getByRole("heading", { name: /Formule/ }).innerText());
  await page.getByRole("heading", { name: "Formule Pro" }).waitFor();
  ok(await page.getByText("Offert pendant le pilote").count() === 1, "mention « Offert pendant le pilote »");
  ok((await page.getByTestId("quota-catalogs").innerText()).includes("/ 5") && (await page.getByTestId("feature-campaigns").innerText()).includes("✓"), "quotas et fonctionnalités PRO");
  await shot(page, "06-pro-offert");
  // Nouveau quota disponible : le widget fonctionne à nouveau (100/5000).
  await playWidget(await browser.newPage({ viewport: { width: 375, height: 800 } }), { expectResult: true });
  ok(await counter() === 101, "PRO : le widget sert à nouveau après l'attribution");

  // 9. Expiration de la promotion : retour STARTER, données conservées.
  await prisma.subscription.update({ where: { tenantId }, data: { endsAt: new Date(Date.now() - 1000) } });
  const dataBefore = { quizzes: await prisma.quiz.count({ where: { tenantId } }), products: await prisma.product.count({ where: { tenantId } }), sessions: await prisma.quizSession.count({ where: { tenantId } }) };
  await page.goto(stack.admin + "/settings/subscription");
  await page.getByRole("heading", { name: "Formule Starter" }).waitFor();
  ok(await page.getByText(/Accès offert expiré/).count() >= 1 && await page.getByText("Offert pendant le pilote").count() === 0, "promotion expirée signalée");
  ok(await prisma.quiz.count({ where: { tenantId } }) === dataBefore.quizzes && await prisma.product.count({ where: { tenantId } }) === dataBefore.products && await prisma.quizSession.count({ where: { tenantId } }) === dataBefore.sessions, "aucune donnée supprimée");
  await shot(page, "07-promo-expiree");
  ok(errors.length === 0, "aucune erreur JS : " + errors.join(" | "));
  console.log(`subscription browser recipe OK (${steps} checks) — captures : ${shots}`);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await prisma.user.deleteMany({ where: { auth0Sub: { in: Object.values(users).map((u) => u.sub) } } }).catch(() => {});
  await prisma.tenant.deleteMany({ where: { email: { in: Object.values(users).map((u) => u.email) } } }).catch(() => {});
  await browser?.close(); stack?.stop(); idp?.stop(); await prisma.$disconnect(); setTimeout(() => process.exit(), 200);
});
