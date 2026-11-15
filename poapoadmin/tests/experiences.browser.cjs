// Run against the local admin, API and PostgreSQL. Fixtures are isolated and removed.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");

const prisma = new PrismaClient();
const { startIsolatedStack } = require("./support/isolatedStack.cjs");
let admin;
let stack;
const tenantId = `xp-browser-${randomUUID()}`;
const emptyId = `${tenantId}-empty`;
const foreignId = `${tenantId}-foreign`;
const output = process.env.POAPO_SCREENSHOT_DIR;
let browser;
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions++; }
const tokenFor = (id) => jwt.sign({ tenantId: id, email: `${id}@example.test` }, process.env.JWT_SECRET);

async function main() {
  stack = await startIsolatedStack();
  admin = stack.admin;
  for (const id of [tenantId, emptyId, foreignId]) {
    await prisma.tenant.create({ data: { id, email: `${id}@example.test`, name: id } });
    await prisma.subscription.create({ data: { tenantId: id, plan: "BUSINESS", source: "LEGACY" } }); // fixtures : hors quotas
  }
  const main = await prisma.catalog.create({ data: { tenantId, name: "Catalogue principal", isDefault: true } });
  const soins = await prisma.catalog.create({ data: { tenantId, name: "Catalogue Soins" } });
  const foreignCatalog = await prisma.catalog.create({ data: { tenantId: foreignId, name: "Catalogue secret" } });
  await prisma.product.create({ data: { tenantId, catalogId: main.id, name: "Produit A", tags: [] } });
  await prisma.product.create({ data: { tenantId, catalogId: soins.id, name: "Produit B", tags: [] } });
  const make = (data) => prisma.quiz.create({ data: { tenantId, catalogId: main.id, ctaText: "Voir", ...data } });
  const shared = await make({ name: "Quel est votre style de voyage ?", quizTitle: "Trouvez votre destination" });
  const standalone = await make({ name: "Ma routine beauté", quizTitle: "Votre routine", catalogId: soins.id });
  const inactive = await make({ name: "Votre style mode", quizTitle: "Votre style", active: false });
  const long = await make({ name: "Une expérience au nom exagérément long pour vérifier que la mise en page ne déborde jamais sur mobile", quizTitle: "Titre affiché aux visiteurs tout aussi long que le nom interne de cette expérience de test" });
  await prisma.quiz.create({ data: { tenantId: foreignId, catalogId: foreignCatalog.id, name: "Quiz secret étranger", quizTitle: "Secret", ctaText: "Voir" } });
  for (const quizId of [shared.id, standalone.id, inactive.id]) await prisma.question.create({ data: {
    tenantId, quizId, text: "Question ?", answers: { create: [{ text: "Oui", order: 0, impacts: {} }] } } });
  await prisma.quiz.update({ where: { id: shared.id }, data: { occasion: "CHRISTMAS", startsAt: new Date("2026-12-01T00:00:00Z"), endsAt: new Date("2026-12-24T23:00:00Z") } });
  await prisma.quizEditorDraft.create({ data: { tenantId, quizId: shared.id, content: { config: { name: shared.name } } } });
  await prisma.metric.createMany({ data: [
    { tenantId, quizId: shared.id, type: "quiz_start" }, { tenantId, quizId: shared.id, type: "quiz_start" },
    { tenantId, quizId: shared.id, type: "quiz_complete" }, { tenantId, quizId: shared.id, type: "buy_click" },
  ] });

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(([value, key]) => { localStorage.setItem("poapo_admin_token", value); localStorage.setItem(key, JSON.stringify({ status: "dismissed" })); }, [tokenFor(tenantId), `poapo_tour_v1:${tenantId}`]);
  const page = await context.newPage();
  const errors = [];
  const calls = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => { if (req.url().includes("/api/")) calls.push(req.url()); });
  const cards = page.locator(".qz-card");
  const names = () => cards.locator(".qz-name").allTextContents();
  const tab = (name) => page.getByRole("button", { name: new RegExp(`^${name}`) });

  await page.goto(admin + "/quizzes");
  await page.getByRole("heading", { name: "Mes quiz", level: 1 }).waitFor();
  await cards.first().waitFor();
  check(await cards.count() === 5, "every quiz listed (4 fixtures + legacy default quiz)");
  check(!(await page.locator("body").innerText()).includes("Quiz secret étranger"), "foreign quiz not visible");
  check(await page.getByRole("link", { name: /Créer un quiz/ }).getAttribute("href") === "/experiences/new", "creation uses the existing Express route");
  check(await page.locator(".xp-details, .xp-layout, .dashboard-stat").count() === 0, "no side panel nor KPI cards");
  check(await page.getByRole("button", { name: /^Toutes|Avec brouillon|Sans brouillon|Désactivées|Accessibles/ }).count() === 0, "old filter groups removed");
  check(calls.filter((url) => url.includes("/api/experiences")).length <= 2, "one synthesis request, no N+1");

  const sharedCard = cards.filter({ hasText: shared.name });
  check(await sharedCard.getByText("En ligne", { exact: true }).count() === 1 && await sharedCard.getByText("Modifications en cours").count() === 1, "online quiz with draft stays « En ligne » + discreet note");
  check(await sharedCard.getByText("À terminer").count() === 0, "online quiz with draft not shown as to finish");
  check(await sharedCard.getByText("1 question", { exact: true }).count() === 1, "question count");
  check(await sharedCard.getByText(/2 commencés · 1 terminé · 1 clic produit/).count() === 1, "real statistics");
  check((await sharedCard.getByRole("link", { name: /^Modifier/ }).getAttribute("href")) === `/experiences/${shared.id}/edit`, "primary action edits through the unified editor");
  check((await sharedCard.getByRole("link", { name: /^Résultats/ }).getAttribute("href")).startsWith(`/analytics?quizId=${shared.id}`), "results link");
  const standaloneCard = cards.filter({ hasText: standalone.name });
  check(await standaloneCard.locator(".qz-note", { hasText: /commencé/ }).count() === 0, "no fictional figures without data");
  const inactiveCard = cards.filter({ hasText: inactive.name });
  check(await inactiveCard.getByText("Hors ligne", { exact: true }).count() === 1 && await inactiveCard.getByText("Quiz désactivé").count() === 1 && await inactiveCard.getByRole("link", { name: /^Modifier/ }).count() === 1, "published but disabled quiz: Hors ligne, cause shown, Modifier");
  const defaultCard = cards.filter({ hasText: "Quiz par défaut" });
  check(await defaultCard.getByText("À terminer").count() === 1 && await defaultCard.getByText("Aucune question active").count() === 1, "empty default quiz");
  check(await cards.filter({ hasText: long.name }).getByText("Aucune question active").count() === 1, "online quiz without active question");

  // Menu « … ».
  const more = sharedCard.getByRole("button", { name: /Autres actions/ });
  check(await more.getAttribute("aria-expanded") === "false", "menu closed by default");
  await more.click();
  const menu = sharedCard.getByRole("menu");
  check(await menu.isVisible() && await more.getAttribute("aria-expanded") === "true", "menu opens");
  check(await menu.getByRole("menuitem").allTextContents().then((v) => v.join("|") === "Prévisualiser (nouvel onglet)|Modifier|Reprendre le brouillon|Voir les résultats|Intégration et paramètres"), "menu items are real actions only");
  check((await menu.getByRole("menuitem", { name: "Prévisualiser (nouvel onglet)" }).getAttribute("href")).includes(`quizId=${shared.id}`), "preview opens the public quiz");
  check((await menu.getByRole("menuitem", { name: "Intégration et paramètres" }).getAttribute("href")) === `/experiences/${shared.id}/edit`, "integration link");
  await page.keyboard.press("ArrowDown");
  check(await page.evaluate(() => document.activeElement?.textContent) === "Modifier", "arrow keys move in the menu");
  await page.keyboard.press("Escape");
  check(await menu.count() === 0 && await more.evaluate((el) => document.activeElement === el), "Escape closes the menu and restores focus");
  await more.click();
  await page.locator("h1").click();
  check(await menu.count() === 0, "outside click closes the menu");
  await inactiveCard.getByRole("button", { name: /Autres actions/ }).click();
  check(await inactiveCard.getByRole("menuitem", { name: /Prévisualiser/ }).count() === 0, "no preview action for a quiz that is not public");
  await page.keyboard.press("Escape");

  // Search and filters.
  const search = page.getByRole("searchbox", { name: "Rechercher un quiz" });
  await search.fill("ROUTINE");
  check((await names()).join("|") === standalone.name, "search ignores case");
  await search.fill("zzz");
  check(await page.getByText("Aucun quiz ne correspond à votre recherche.").count() === 1, "empty filtered state");
  await page.getByRole("button", { name: "Effacer les filtres" }).click();
  check(await cards.count() === 5, "clearing restores the list");
  check(await tab("Tous").textContent() === "Tous (5)" && await tab("En ligne").textContent() === "En ligne (3)" && await tab("À terminer").textContent() === "À terminer (2)", "tab counts");
  await tab("En ligne").click();
  check((await names()).sort().join("|") === [shared.name, standalone.name, long.name].sort().join("|"), "online filter");
  check(await tab("En ligne").getAttribute("aria-pressed") === "true", "pressed state exposed");
  await tab("À terminer").click();
  check((await names()).sort().join("|") === [inactive.name, "Quiz par défaut"].sort().join("|"), "to-finish filter keeps inactive quizzes");
  await tab("Tous").click();
  await page.getByText("Options", { exact: true }).click();
  await page.getByLabel("Trier par").selectOption("name");
  const sorted = await names();
  check(sorted.join("|") === [...sorted].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" })).join("|"), "sorted by name");
  await page.getByLabel("Trier par").selectOption("recent");
  await page.getByLabel("Catalogue", { exact: true }).selectOption(soins.id);
  await page.waitForURL(/catalogId=/);
  await cards.nth(1).waitFor({ state: "detached" });
  check((await names()).join("|") === standalone.name, "catalogue filter");
  await page.getByLabel("Catalogue", { exact: true }).selectOption("");
  await cards.nth(4).waitFor();

  // Keyboard reaches the primary action and the menu trigger.
  await page.goto(admin + "/quizzes");
  await cards.first().waitFor();
  await search.focus();
  let reached = false;
  for (let i = 0; i < 12 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => document.activeElement?.classList.contains("qz-more"));
  }
  check(reached, "keyboard reaches the « … » trigger");
  await page.keyboard.press("Enter");
  check(await page.getByRole("menu").count() === 1, "keyboard opens the menu");
  await page.keyboard.press("Escape");

  // Responsive and screenshots.
  await page.goto(admin + "/quizzes");
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await cards.first().waitFor();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal overflow at ${width}px`);
    const small = await page.evaluate(() => [...document.querySelectorAll(".qz-card a, .qz-card button")].filter((el) => { const r = el.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).length);
    check(small === 0, `touch targets >= 44px at ${width}px`);
    const box = await sharedCard.getByRole("link", { name: /^Modifier/ }).boundingBox();
    check(box && box.x >= 0 && box.x + box.width <= width, `primary action inside the viewport at ${width}px`);
    if (output) { fs.mkdirSync(output, { recursive: true }); await page.screenshot({ path: path.join(output, `quiz-list-${width}.png`), fullPage: true }); }
  }
  await page.setViewportSize({ width: 375, height: 1000 });
  await sharedCard.getByRole("button", { name: /Autres actions/ }).click();
  const mb = await sharedCard.getByRole("menu").boundingBox();
  check(mb.x >= 0 && mb.x + mb.width <= 375, "menu stays inside the mobile viewport");
  if (output) await page.screenshot({ path: path.join(output, "quiz-list-375-menu.png"), fullPage: true });

  // Navigation and legacy links.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin + "/quizzes");
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  check(await nav.getByRole("link", { name: "Mes quiz", exact: true }).getAttribute("aria-current") === "page", "navigation highlights Mes quiz");
  for (const route of [`/analytics?quizId=${shared.id}`]) {
    await page.goto(admin + route);
    await page.waitForLoadState("networkidle");
    check(new URL(page.url()).pathname === route.split("?")[0], `legacy link ${route}`);
  }
  await page.goto(admin + `/quizzes/${shared.id}`);
  await page.waitForURL(`**/experiences/${shared.id}/edit`);

  // Error, retry and loading states.
  await page.route("**/api/experiences", (route) => route.fulfill({ status: 500, json: { error: "Synthèse indisponible" } }));
  await page.goto(admin + "/quizzes");
  await page.getByRole("alert").filter({ hasText: "Synthèse indisponible" }).waitFor();
  await page.unroute("**/api/experiences");
  await page.getByRole("button", { name: "Réessayer" }).click();
  await cards.first().waitFor();
  check(await cards.count() === 5, "retry recovers");

  check(await prisma.quiz.count({ where: { tenantId } }) === 5 && await prisma.quizEditorDraft.count({ where: { tenantId } }) === 1 &&
    await prisma.metric.count({ where: { tenantId } }) === 4, "page is read-only");
  check(errors.length === 0, errors.join("\n"));
  await context.close();

  // Provision the legacy default quiz once, so development StrictMode does not race two first-time requests.
  await fetch(`${stack.api}/api/auth/me`, { headers: { Authorization: `Bearer ${tokenFor(emptyId)}` } });
  const empty = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await empty.addInitScript(([value, key]) => { localStorage.setItem("poapo_admin_token", value); localStorage.setItem(key, JSON.stringify({ status: "dismissed" })); }, [tokenFor(emptyId), `poapo_tour_v1:${emptyId}`]);
  const emptyPage = await empty.newPage();
  // Any merchant page load provisions the legacy default quiz, so the empty state is exercised with an empty synthesis.
  await emptyPage.route("**/api/experiences", (route) => route.fulfill({ status: 200, json: {
    shopActive: true, period: { from: new Date().toISOString(), to: new Date().toISOString(), days: 30 }, experiences: [] } }));
  await emptyPage.goto(admin + "/quizzes");
  await emptyPage.getByRole("heading", { name: "Vous n'avez pas encore de quiz" }).waitFor();
  check(await emptyPage.getByRole("link", { name: "Créer mon premier quiz" }).getAttribute("href") === "/experiences/new", "empty tenant invites creation without campaign");
  check(await emptyPage.locator(".dashboard-stat").count() === 0, "no fictional figures for an empty tenant");
  if (output) await emptyPage.screenshot({ path: path.join(output, "experiences-vide.png"), fullPage: true });
  await empty.close();
  console.log(`PASS: ${assertions} browser assertions; screenshots: ${output || "not requested"}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (stack) stack.stop();
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, emptyId, foreignId] } } });
  await prisma.$disconnect();
});
