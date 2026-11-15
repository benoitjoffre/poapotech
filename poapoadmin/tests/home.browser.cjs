// Run against the local admin, API and PostgreSQL. Fixtures are isolated and removed.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { resolveStack } = require("./support/isolatedStack.cjs");

const prisma = new PrismaClient();
let api;
let admin;
let stack;
const tenantId = `home-browser-${randomUUID()}`;
const foreignId = `${tenantId}-foreign`;
const output = process.env.POAPO_SCREENSHOT_DIR;
let browser;
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions++; }

async function main() {
  stack = await resolveStack();
  ({ api, admin } = stack);
  await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test`, name: "Boutique de démonstration" } });
  await prisma.tenant.create({ data: { id: foreignId, email: `${foreignId}@example.test`, name: "Boutique étrangère" } });
  const catalog = await prisma.catalog.create({ data: { tenantId, name: "Collection découverte", isDefault: true } });
  const foreignCatalog = await prisma.catalog.create({ data: { tenantId: foreignId, name: "Catalogue secret" } });
  await prisma.product.create({ data: { tenantId, catalogId: catalog.id, name: "Coffret découverte", tags: [], attributes: { intensity: 0.4 } } });
  await prisma.product.create({ data: { tenantId: foreignId, catalogId: foreignCatalog.id, name: "Produit secret", tags: [] } });
  const makeQuiz = (data) => prisma.quiz.create({ data: {
    tenantId, catalogId: catalog.id, quizTitle: "Trouvez votre sélection", ctaText: "Découvrir",
    axes: [{ key: "intensity", label: "Intensité" }], ...data,
  } });
  const live = await makeQuiz({ id: `default_${tenantId}`, name: "Trouver le bon coffret", isDefault: true });
  const draft = await makeQuiz({ name: "Une sélection à préparer", active: false });
  const standalone = await makeQuiz({ name: "Découvrir la collection" });
  for (const quizId of [live.id, draft.id, standalone.id]) await prisma.question.create({ data: {
    tenantId, quizId, text: "Quelle intensité préférez-vous ?",
    answers: { create: [{ text: "Douce", order: 0, impacts: { intensity: -0.2 } }, { text: "Intense", order: 1, impacts: { intensity: 0.2 } }] },
  } });
  await prisma.metric.createMany({ data: [
    { tenantId, quizId: live.id, type: "quiz_start" },
    { tenantId, quizId: live.id, type: "quiz_complete" },
    { tenantId, quizId: live.id, type: "buy_click" },
  ] });
  const token = jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET);
  async function request(route, method = "GET", body) {
    const res = await fetch(api + route, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body && { body: JSON.stringify(body) }) });
    assert.equal(res.status, 200, await res.clone().text());
    return res.json();
  }
  const state = await request(`/api/quizzes/${draft.id}/draft`);
  state.draft.config.quizTitle = "Ma prochaine expérience";
  const savedDraft = await request(`/api/quizzes/${draft.id}/draft`, "PUT", { revision: state.revision, draft: state.draft });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(([value, key]) => { localStorage.setItem("poapo_admin_token", value); localStorage.setItem(key, JSON.stringify({ status: "dismissed" })); }, [token, `poapo_tour_v1:${tenantId}`]);
  const page = await context.newPage();
  const errors = [];
  const calls = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => { if (req.url().includes("/api/")) calls.push(req.url()); });
  const guide = page.locator(".home-guide");
  const ready = () => page.locator(".home-guide, .home-allset").first().waitFor();
  await page.goto(admin + "/");
  await ready();
  const navigation = page.getByRole("navigation", { name: "Navigation principale" });
  check((await navigation.getByRole("link").allTextContents()).join("|") ===
    "Accueil|Mes produits|Mes quiz|Résultats|Paramètres|Centre d'aide", "six merchant destinations in the validated order");
  check(await page.getByRole("heading", { name: "Bonjour Boutique de démonstration" }).count() === 1, "real shop identity");
  // Maquette : le panneau « Votre progression » reste affiché ; l'installation n'est jamais cochée (POAPO ne peut pas la vérifier).
  check(await page.getByTestId("home-banner").innerText().then((t) => /a déjà reçu des réponses/.test(t)) && await guide.locator("li.done").count() === 3 && await guide.locator("li").count() === 4, "live and used: banner, installation never ticked");
  check(await page.getByTestId("home-install-note").count() === 1, "installation cannot be verified: said plainly");
  check(await page.locator(".dashboard-stat dd").allTextContents().then((values) => values.join(",") === "1,1,1"), "real totals");
  check(await page.locator(".home-quiz-row").count() === 3, "every quiz listed once");
  for (const quiz of [live, draft, standalone]) {
    const row = page.locator(".home-quiz-row").filter({ hasText: quiz.name });
    check((await row.getByRole("link", { name: "Modifier" }).getAttribute("href")) === `/experiences/${quiz.id}/edit`, "row edits the right quiz");
    // « Résultats » seulement pour un quiz en ligne ou déjà utilisé.
    if (quiz === draft) check(await row.getByRole("link", { name: "Résultats" }).count() === 0, "no results link for an unpublished draft");
    else check((await row.getByRole("link", { name: "Résultats" }).getAttribute("href")).includes(quiz.id), "row opens the right results");
  }
  check(await page.locator(".home-quiz-row").filter({ hasText: draft.name }).getByText("Brouillon").count() === 1, "unpublished draft labelled in plain words");
  check(!(await page.locator("body").innerText()).includes("Produit secret"), "foreign products not visible");
  check(calls.filter((url) => url.includes("/metrics")).length === 0, "no per-quiz analytics requests");
  check(calls.filter((url) => /\/quizzes\/[^/]+\/draft/.test(url)).length === 0, "no per-quiz draft requests on home");
  check(await page.getByRole("link", { name: "+ Créer un autre quiz" }).getAttribute("href") === "/experiences/new", "creation link");

  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal overflow at ${width}px`);
    for (const label of ["Accueil", "Mes produits", "Mes quiz", "Résultats", "Paramètres"]) {
      const link = navigation.getByRole("link", { name: label, exact: true });
      const box = await link.boundingBox();
      check(await link.isVisible() && box && box.x >= 0 && box.y >= 0 &&
        box.x + box.width <= width && box.y + box.height <= 1000, `navigation ${label} immediately visible at ${width}px`);
    }
    if (output) {
      fs.mkdirSync(output, { recursive: true });
      await page.screenshot({ path: path.join(output, `accueil-${width}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin + "/");
  await ready();
  for (const label of ["Accueil", "Mes produits", "Mes quiz", "Résultats", "Paramètres"]) {
    await page.keyboard.press("Tab");
    check(await page.evaluate(() => document.activeElement?.textContent?.trim()) === label, `keyboard reaches ${label}`);
  }
  await page.locator(".home-quiz-row").filter({ hasText: draft.name }).getByRole("link", { name: "Modifier" }).click();
  await page.getByRole("tab", { name: "Réglages", exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll("input")].some((i) => i.value === "Ma prochaine expérience"));
  check(await page.getByLabel("Nom de l'expérience (visible par vous seul)", { exact: true }).inputValue() === draft.name, "edit keeps the intended quiz and its saved draft");
  await navigation.getByRole("link", { name: "Accueil", exact: true }).click();
  await ready();
  const realSummary = await request("/api/dashboard");
  const mock = (patch) => page.route("**/api/dashboard", (route) => route.fulfill({ status: 200, json: { ...realSummary, ...patch } }));
  const noActivity = { totals: { started: 0, completed: 0, productClicks: 0, accessible: 0 } };

  // Guide : une seule étape active à la fois, avec un seul bouton principal.
  await mock({ experiences: [], products: 0, catalogs: 0, ...noActivity, nextAction: { kind: "create", quizId: null } });
  await page.goto(admin + "/");
  await guide.waitFor();
  // Refonte : l'accueil présente trois étapes ; l'installation (4ᵉ étape du suivi) s'ajoute une fois le quiz publié.
  check(await guide.locator("li").count() === 3, "three steps before publication");
  check(await guide.locator("li.current").count() === 1 && await guide.locator(".btn-primary").count() === 1, "one active step, one primary button");
  check((await guide.locator("li").first().getAttribute("aria-current")) === "step", "current step announced");
  check((await guide.getByRole("link", { name: "Ajouter mes produits" }).getAttribute("href")) === "/catalog", "step 1 leads to products");
  check(await page.locator(".dashboard-stat").count() === 0 && await page.locator(".home-quiz-row").count() === 0, "no empty statistics before the first quiz is live");
  await page.unroute("**/api/dashboard");

  await mock({ experiences: [], products: 3, ...noActivity, nextAction: { kind: "create", quizId: null } });
  await page.goto(admin + "/");
  await guide.waitFor();
  check(await guide.locator("li.done").count() === 1, "step 1 ticked");
  check((await guide.getByRole("link", { name: "Créer mon quiz" }).getAttribute("href")) === "/experiences/new", "step 2 leads to creation");
  await page.unroute("**/api/dashboard");

  const unpublished = { ...realSummary.experiences[0], accessible: false, hasDraft: true };
  await mock({ experiences: [unpublished], products: 3, ...noActivity });
  await page.goto(admin + "/");
  await guide.waitFor();
  check(await guide.locator("li.done").count() === 2, "steps 1 and 2 ticked");
  check((await guide.getByRole("link", { name: "Publier mon quiz" }).getAttribute("href")).includes("section=publication"), "step 3 opens the publication tab");
  await page.unroute("**/api/dashboard");

  const published = { ...realSummary.experiences[0], accessible: true };
  await mock({ experiences: [published], products: 3, totals: { started: 0, completed: 0, productClicks: 0, accessible: 1 } });
  await page.goto(admin + "/");
  await guide.waitFor();
  check(await guide.locator("li.done").count() === 3 && await guide.locator("li").count() === 4, "steps 1 to 3 ticked, installation step added after publication");
  check((await guide.getByRole("link", { name: "Voir le code d'installation" }).getAttribute("href")).includes("section=publication"), "step 4 gives access to link and code");
  await page.unroute("**/api/dashboard");

  // Barre de parcours : présente sur les autres pages tant que le quiz n'est pas utilisé.
  const bar = page.getByRole("navigation", { name: "Votre parcours" });
  await page.goto(admin + "/catalog");
  await page.locator(".admin-main").waitFor();
  check(await bar.count() === 0, "no journey bar once the quiz is live and used");
  await mock({ experiences: [], products: 0, catalogs: 0, ...noActivity, nextAction: { kind: "create", quizId: null } });
  await page.goto(admin + "/quizzes");
  await bar.waitFor();
  check(await bar.locator("li").count() === 4 && await bar.getByText("Étape 1 sur 4").count() === 1, "journey bar shows the step count");
  check((await bar.getByRole("link", { name: "Ajouter mes produits" }).getAttribute("href")) === "/catalog", "journey bar leads to the next step");
  await page.goto(admin + "/catalog");
  await bar.waitFor();
  check(await bar.getByRole("link", { name: "Ajouter mes produits" }).count() === 0, "no redundant button on the step's own page");
  await page.goto(admin + "/");
  await guide.waitFor();
  check(await bar.count() === 0, "home shows the full guide instead of the bar");
  await page.unroute("**/api/dashboard");
  await mock({ experiences: [], products: 3, ...noActivity, nextAction: { kind: "create", quizId: null } });
  await page.goto(admin + "/settings");
  await bar.waitFor();
  check(await bar.locator("li.done").count() === 1 && (await bar.locator("li.done a").getAttribute("href")) === "/catalog", "done steps stay reachable");
  await page.unroute("**/api/dashboard");

  let releaseSummary;
  const pendingSummary = new Promise((resolve) => { releaseSummary = resolve; });
  await page.route("**/api/dashboard", async (route) => { await pendingSummary; await route.fulfill({ status: 200, json: realSummary }); });
  await page.goto(admin + "/");
  await page.getByRole("status").filter({ hasText: "Chargement" }).waitFor();
  check(await page.locator(".dashboard-stat").count() === 0, "loading does not fabricate statistics");
  releaseSummary();
  await ready();
  await page.unroute("**/api/dashboard");
  await page.route("**/api/dashboard", (route) => route.fulfill({ status: 500, json: { error: "Accueil temporairement indisponible" } }));
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "Accueil temporairement indisponible" }).waitFor();
  check(await page.getByRole("button", { name: "Réessayer" }).isVisible(), "explicit recoverable error");
  await page.unroute("**/api/dashboard");
  await page.getByRole("button", { name: "Réessayer" }).click();
  await ready();
  check(await prisma.quizEditorDraft.count({ where: { tenantId } }) === 1, "home did not modify drafts");
  const unchangedDraft = await request(`/api/quizzes/${draft.id}/draft`);
  assert.deepEqual(unchangedDraft.draft, savedDraft.draft, "draft content preserved");
  check(unchangedDraft.revision === savedDraft.revision, "draft revision preserved");
  check(await prisma.metric.count({ where: { tenantId } }) === 3, "home did not modify metrics");
  check(errors.length === 0, errors.join("\n"));
  await context.close();

  const superToken = jwt.sign({ tenantId, email: `${tenantId}@example.test`, isSuperAdmin: true }, process.env.JWT_SECRET);
  const superContext = await browser.newContext();
  await superContext.addInitScript((value) => localStorage.setItem("poapo_admin_token", value), superToken);
  const superPage = await superContext.newPage();
  await superPage.goto(admin + "/");
  await superPage.getByRole("heading", { name: "Administration des tenants" }).waitFor();
  check(new URL(superPage.url()).pathname === "/admin/tenants", "superadmin routed separately");
  check(await superPage.getByRole("navigation", { name: "Navigation principale" }).getByRole("link").count() === 1, "separate superadmin navigation");
  await superPage.setViewportSize({ width: 320, height: 1000 });
  check(await superPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "superadmin mobile navigation does not overflow");
  await superContext.close();
  const anonymous = await browser.newPage();
  await anonymous.goto(admin + "/catalog");
  await anonymous.getByRole("button", { name: "Recevoir le lien de connexion" }).waitFor();
  check(new URL(anonymous.url()).pathname === "/login", "anonymous visitor redirected");
  console.log(`PASS: ${assertions} browser assertions; screenshots: ${output || "not requested"}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  stack?.stop();
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignId] } } });
  await prisma.$disconnect();
});
