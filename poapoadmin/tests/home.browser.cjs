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
  const campaign = await prisma.campaign.create({ data: { tenantId, quizId: live.id, name: "Occasion une", occasion: "PERMANENT", objectives: [] } });
  await prisma.campaign.create({ data: { tenantId, quizId: live.id, name: "Occasion deux", occasion: "SPRING", objectives: [], status: "PAUSED" } });
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
  await page.goto(admin + "/");
  await page.getByRole("heading", { name: "Votre prochaine action" }).waitFor();
  const navigation = page.getByRole("navigation", { name: "Navigation principale" });
  check((await navigation.getByRole("link").allTextContents()).join("|") ===
    "Accueil|Mes produits|Mes expériences|Campagnes|Résultats|Paramètres|Centre d'aide", "seven merchant destinations in the validated order");
  check(await navigation.getByRole("link", { name: "Campagnes", exact: true }).getAttribute("href") === "/campaigns",
    "campaign navigation retains the existing studio route");
  check(await page.getByText("Boutique de démonstration", { exact: true }).count() === 1, "real shop identity");
  check(await page.locator(".experience-card").count() === 3, "standalone and shared quizzes included once");
  check(await page.locator(".dashboard-stat dd").allTextContents().then((values) => values.join(",") === "1,1,1,2"), "real totals without campaign duplication");
  check(await page.locator(".home-next").getByText(draft.name, { exact: true }).count() === 1, "saved draft has priority");
  const continueLink = page.locator(".home-next").getByRole("link", { name: "Continuer", exact: true });
  check((await continueLink.getAttribute("href")).includes(encodeURIComponent(draft.id)), "explicit quiz identity");
  check((await continueLink.getAttribute("href")).includes(encodeURIComponent(catalog.id)), "explicit catalogue identity");
  check(!(await page.locator("body").innerText()).includes("Produit secret"), "foreign products not visible");
  check(calls.filter((url) => url.includes("/metrics")).length === 0, "no per-quiz analytics requests");
  check(calls.filter((url) => /\/quizzes\/[^/]+\/draft/.test(url)).length === 0, "no per-quiz draft requests on home");
  check(await page.locator(".home-create-card").getAttribute("href") === "/experiences/new", "creation tile opens the existing creation flow");
  check(await page.locator(".dashboard-resource").count() === 4, "reusable resource cards rendered");
  for (const [quiz, label] of [[live, "Voir les résultats"], [draft, "Continuer l'édition"], [standalone, "Voir les résultats"]]) {
    const card = page.locator(".experience-card").filter({ has: page.getByRole("link", { name: `${label} : ${quiz.name}`, exact: true }) });
    check(await card.locator(".btn-primary").count() === 1, "one primary action per experience");
    check((await card.locator(".btn-primary").getAttribute("href")).includes(quiz.id), "reusable card keeps the quiz context");
  }
  check(await page.getByRole("progressbar").count() === 0, "no fictional progress indicator");
  check(await page.getByRole("link", { name: /vidéo/i }).count() === 0, "no fictional video link");

  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal overflow at ${width}px`);
    for (const label of ["Accueil", "Mes produits", "Mes expériences", "Campagnes", "Résultats", "Paramètres"]) {
      const link = page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: label, exact: true });
      const box = await link.boundingBox();
      check(await link.isVisible() && box && box.x >= 0 && box.y >= 0 &&
        box.x + box.width <= width && box.y + box.height <= 1000, `navigation ${label} immediately visible at ${width}px`);
    }
    if (width <= 768) {
      const next = await page.locator(".home-next").boundingBox();
      const activity = await page.locator("#home-activity-title").boundingBox();
      check(next.y < activity.y, `next action precedes activity on mobile at ${width}px`);
    }
    check(await continueLink.isVisible(), `continue available at ${width}px`);
    const title = await page.locator("#home-title").boundingBox();
    check(title.width <= 440 && title.height > 50, `hero title retains the mockup multiline hierarchy at ${width}px`);
    if (width === 1440) {
      const hero = await page.locator(".home-hero").boundingBox();
      const next = await page.locator(".home-next").boundingBox();
      const activity = await page.locator(".home-activity").boundingBox();
      const resources = await page.locator(".home-resources").boundingBox();
      const cards = await page.locator(".experience-card, .home-create-card").evaluateAll((items) =>
        items.map((item) => ({ y: item.getBoundingClientRect().y, width: item.getBoundingClientRect().width })));
      check(Math.abs(hero.y - next.y) < 1 && next.x > hero.x + hero.width, "mockup desktop hero and next action share the top row");
      check(resources.x > activity.x + activity.width, "mockup resources stay in the right column");
      check(cards.every((card) => Math.abs(card.y - cards[0].y) < 1 && card.width >= 150), "mockup three experience cards and creation tile share one row");
      check(activity.y > hero.y + hero.height && activity.y < 500, "compact hero keeps activity above the desktop fold");
      check(await page.locator(".home-hero-visual").isVisible(), "decorative quiz illustration present on desktop");
    }
    if (output) {
      fs.mkdirSync(output, { recursive: true });
      await page.screenshot({ path: path.join(output, `accueil-${width}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin + "/");
  await page.getByRole("heading", { name: "Votre prochaine action" }).waitFor();
  for (const label of ["Accueil", "Mes produits", "Mes expériences", "Campagnes", "Résultats", "Paramètres"]) {
    await page.keyboard.press("Tab");
    check(await page.evaluate(() => document.activeElement?.textContent?.trim()) === label, `keyboard reaches ${label}`);
  }
  await continueLink.click();
  await page.getByRole("heading", { name: "Configurer le brouillon du quiz" }).waitFor();
  check(await page.getByLabel("Titre public", { exact: true }).inputValue() === "Ma prochaine expérience", "continue reopens the persisted draft");
  check(await page.getByLabel("Nom interne", { exact: true }).inputValue() === draft.name, "continue keeps the intended quiz");
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Accueil", exact: true }).click();
  await page.getByRole("heading", { name: "Votre prochaine action" }).waitFor();
  await page.getByRole("link", { name: "Créer une expérience", exact: true }).click();
  await page.getByRole("heading", { name: "Créer une expérience", exact: true }).waitFor();
  check(page.url().includes("/experiences/new"), "creation uses available route");
  for (const route of [`/quizzes/${draft.id}`, `/quiz-builder?quizId=${live.id}`, `/campaigns/${campaign.id}`, "/catalogs"]) {
    await page.goto(admin + route);
    await page.waitForLoadState("networkidle");
    check(new URL(page.url()).pathname === route.split("?")[0], `legacy deep link ${route}`);
    check(!await page.getByText("Route introuvable", { exact: true }).count(), "existing page retained");
  }
  const realSummary = await request("/api/dashboard");
  let releaseSummary;
  const pendingSummary = new Promise((resolve) => { releaseSummary = resolve; });
  await page.route("**/api/dashboard", async (route) => {
    await pendingSummary;
    await route.fulfill({ status: 200, json: realSummary });
  });
  await page.goto(admin + "/");
  await page.getByRole("status").filter({ hasText: "Chargement de votre activité" }).waitFor();
  check(await page.locator(".dashboard-stat").count() === 0, "loading does not fabricate statistics");
  releaseSummary();
  await page.getByRole("heading", { name: "Votre prochaine action" }).waitFor();
  await page.unroute("**/api/dashboard");
  await page.route("**/api/dashboard", (route) => route.fulfill({ status: 200, json: {
    ...realSummary, experiences: [], products: 0, catalogs: 0,
    totals: { started: 0, completed: 0, productClicks: 0, accessible: 0 }, nextAction: { kind: "create", quizId: null },
  } }));
  await page.goto(admin + "/");
  await page.getByRole("link", { name: "Créer ma première expérience", exact: true }).waitFor();
  check(await page.getByText(/Aucune activité enregistrée/).count() === 1, "empty activity explanation");
  await page.unroute("**/api/dashboard");
  await page.route("**/api/dashboard", (route) => route.fulfill({ status: 500, json: { error: "Accueil temporairement indisponible" } }));
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "Accueil temporairement indisponible" }).waitFor();
  check(await page.getByRole("button", { name: "Réessayer" }).isVisible(), "explicit recoverable error");
  await page.unroute("**/api/dashboard");
  await page.getByRole("button", { name: "Réessayer" }).click();
  await page.getByRole("heading", { name: "Votre prochaine action" }).waitFor();
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
