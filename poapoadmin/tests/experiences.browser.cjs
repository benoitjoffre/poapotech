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
const admin = process.env.POAPO_ADMIN_URL || "http://localhost:5174";
const tenantId = `xp-browser-${randomUUID()}`;
const emptyId = `${tenantId}-empty`;
const foreignId = `${tenantId}-foreign`;
const output = process.env.POAPO_SCREENSHOT_DIR;
let browser;
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions++; }
const tokenFor = (id) => jwt.sign({ tenantId: id, email: `${id}@example.test` }, process.env.JWT_SECRET);

async function main() {
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
  const long = await make({ name: "Une expérience au nom exagérément long pour vérifier que la mise en page ne déborde jamais sur mobile", quizTitle: "Titre public tout aussi long que le nom interne de cette expérience de test" });
  await prisma.quiz.create({ data: { tenantId: foreignId, catalogId: foreignCatalog.id, name: "Quiz secret étranger", quizTitle: "Secret", ctaText: "Voir" } });
  for (const quizId of [shared.id, standalone.id]) await prisma.question.create({ data: {
    tenantId, quizId, text: "Question ?", answers: { create: [{ text: "Oui", order: 0, impacts: {} }] } } });
  const campaigns = [];
  for (const [name, status] of [["Vacances d'été", "ACTIVE"], ["City break automne", "PAUSED"], ["Noël 2026", "SCHEDULED"]]) {
    campaigns.push(await prisma.campaign.create({ data: { tenantId, quizId: shared.id, name, occasion: "PERMANENT", objectives: [], status,
      startsAt: status === "SCHEDULED" ? new Date(Date.now() + 40 * 86_400_000) : null } }));
  }
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
  const cards = page.locator(".xp-card");
  const names = () => cards.locator("h3").allTextContents().then((items) => items.map((value) => value.replace(/ — afficher les détails$/, "")));

  await page.goto(admin + "/quizzes");
  await page.getByRole("heading", { name: "Mes expériences", level: 1 }).waitFor();
  await cards.first().waitFor();
  check(await cards.count() === 5, "every quiz listed (4 fixtures + legacy default quiz), including those without campaign");
  check(!(await page.locator("body").innerText()).includes("Quiz secret étranger"), "foreign quiz not visible");
  check(await page.getByRole("link", { name: /Créer une expérience/ }).getAttribute("href") === "/experiences/new", "creation uses the existing quiz creation route");
  check(calls.filter((url) => /\/(metrics|draft)|\/api\/campaigns/.test(url)).length === 0, "no per-quiz or per-campaign requests (no N+1)");
  check(calls.filter((url) => url.includes("/api/experiences")).length <= 2, "one synthesis request (two under development StrictMode), not one per quiz");
  check(await page.locator(".dashboard-stat dd").allTextContents().then((values) => values.join(",") === "5,3,2,1"), "real totals, shared quiz counted once");

  const sharedCard = cards.filter({ hasText: shared.name });
  check(await sharedCard.getByText("3 campagnes").count() === 1, "campaign count");
  check(await sharedCard.getByText("Brouillon enregistré").count() === 1, "saved draft state");
  check(await sharedCard.getByText("Accessible au public").count() === 1, "public availability");
  check(await sharedCard.getByText("Catalogue principal").count() === 1 && await sharedCard.getByText("1 question", { exact: true }).count() === 1, "catalogue and question count");
  const resume = sharedCard.getByRole("link", { name: /Reprendre le brouillon/ });
  check((await resume.getAttribute("href")) === `/experiences/${shared.id}/edit`, "draft resumes through the unified quiz-scoped editor");
  check((await sharedCard.getByRole("link", { name: /Voir les résultats/ }).getAttribute("href")).startsWith(`/analytics?quizId=${shared.id}`), "results link");
  check((await sharedCard.getByRole("link", { name: /Intégration/ }).getAttribute("href")).startsWith(`/quizzes/${shared.id}`), "integration link");
  check((await sharedCard.getByRole("link", { name: /Prévisualiser/ }).getAttribute("href")).includes(`quizId=${shared.id}`), "preview opens the public quiz");
  check(await sharedCard.getByText("Commencés").count() === 1 && await sharedCard.locator(".xp-stats dd").allTextContents().then((v) => v.join(",") === "2,1,1"), "real statistics");
  const standaloneCard = cards.filter({ hasText: standalone.name });
  check(await standaloneCard.getByText("Aucune campagne").count() === 1, "quiz without campaign");
  check(await standaloneCard.getByText(/Pas encore de données/).count() === 1, "no-data state without fictional figures");
  check(await standaloneCard.getByText("Catalogue Soins").count() === 1, "second catalogue");
  const inactiveCard = cards.filter({ hasText: inactive.name });
  check(await inactiveCard.getByText("Désactivée pour le public").count() === 1 && await inactiveCard.getByText("Aperçu indisponible").count() === 1, "inactive quiz");
  check(!/\bPublié\b|\bvente/i.test(await page.locator(".xp-list").innerText()) && !(await page.locator(".xp-badge").allTextContents()).some((text) => /^(Active|Actif|Publié)$/.test(text)), "no published/active synonym nor sales wording");

  // Filters, search and sort.
  await page.getByLabel("Rechercher par nom").fill("ROUTINE");
  check((await names()).join("|") === standalone.name, "search ignores case");
  await page.getByLabel("Rechercher par nom").fill("zzz");
  check(await page.getByText("Aucune expérience ne correspond à ces critères.").count() === 1, "empty filtered state");
  await page.getByRole("button", { name: "Réinitialiser les filtres" }).click();
  check(await cards.count() === 5, "reset restores the list");
  await page.getByRole("button", { name: /^Désactivées/ }).click();
  check((await names()).sort().join("|") === [inactive.name, "Quiz par défaut"].sort().join("|"), "inactive filter");
  await page.getByRole("button", { name: /^Toutes/ }).click();
  await page.getByRole("button", { name: /^Avec brouillon/ }).click();
  check((await names()).join("|") === shared.name, "draft filter");
  await page.getByRole("button", { name: /^Tous les états/ }).click();
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

  // Details panel on desktop.
  const panel = page.locator(".xp-details");
  await cards.filter({ hasText: shared.name }).getByRole("button", { name: /afficher les détails/ }).click();
  await panel.getByRole("heading", { level: 2, name: shared.name, exact: true }).waitFor();
  check(true, "selected experience details");
  check(await panel.locator(".xp-campaigns li").count() === 3, "associated campaigns listed");
  check(await panel.getByText("Programmée").count() === 1 && await panel.getByText("En pause").count() === 1, "campaign states");
  check(await panel.getByText(/Cette expérience est partagée/).count() === 1, "shared quiz warning");
  check(await panel.getByRole("link", { name: /Éditeur historique via la campagne Vacances/ }).getAttribute("href") === `/campaigns/${campaigns[0].id}/quiz-editor`, "legacy campaign editor route is still linked");
  check(new URL(page.url()).searchParams.get("experience") === shared.id, "selection stored in the URL");
  await cards.filter({ hasText: standalone.name }).getByRole("button", { name: /afficher les détails/ }).click();
  await panel.getByRole("heading", { level: 2, name: standalone.name, exact: true }).waitFor();
  check(await panel.getByText(/Aucune campagne : l'expérience existe sans campagne/).count() === 1, "no-campaign detail states the absence of campaigns");
  check(await panel.getByRole("link", { name: "Éditer" }).getAttribute("href") !== null, "edit action available without campaign");

  // Keyboard.
  await page.goto(admin + "/quizzes");
  await cards.first().waitFor();
  await page.getByLabel("Rechercher par nom").focus();
  let reached = false;
  for (let i = 0; i < 25 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => document.activeElement?.classList.contains("xp-select"));
  }
  check(reached, "keyboard reaches an experience selector");
  await page.keyboard.press("Enter");
  await page.locator(".xp-card.selected").waitFor();
  check(await page.locator(".xp-card.selected").count() === 1 && await page.locator(".xp-select[aria-pressed=true]").count() === 1, "keyboard selection");

  // Responsive and screenshots.
  await page.goto(admin + "/quizzes");
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await cards.first().waitFor();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal overflow at ${width}px`);
    const edit = cards.first().getByRole("link", { name: /Éditer|Reprendre/ });
    const box = await edit.boundingBox();
    check(box && box.x >= 0 && box.x + box.width <= width, `primary action inside the viewport at ${width}px`);
    if (output) { fs.mkdirSync(output, { recursive: true }); await page.screenshot({ path: path.join(output, `experiences-${width}.png`), fullPage: true }); }
    if (width <= 768) {
      await cards.first().getByRole("button", { name: /afficher les détails/ }).click();
      await page.locator(".xp-list").waitFor({ state: "hidden" });
      check(await panel.isVisible() && !(await page.locator(".xp-list").isVisible()), `details view replaces the list at ${width}px`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `details without overflow at ${width}px`);
      if (output) await page.screenshot({ path: path.join(output, `experiences-details-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: "← Retour à la liste" }).click();
      await page.locator(".xp-list").waitFor();
      check(await page.locator(".xp-list").isVisible(), `back to the list at ${width}px`);
    } else if (width === 1440) {
      check(await panel.isVisible() && await page.locator(".xp-list").isVisible(), "desktop shows list and details side by side");
      const a = await page.locator(".xp-list").boundingBox(); const b = await panel.boundingBox();
      check(b.x >= a.x + a.width, "details panel sits on the right");
    }
  }

  // Navigation and legacy links.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin + "/quizzes");
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  check(await nav.getByRole("link", { name: "Mes expériences", exact: true }).getAttribute("aria-current") === "page", "navigation highlights Mes expériences");
  for (const route of [`/quizzes/${shared.id}`, `/quizzes/new`, `/quiz-builder?quizId=${shared.id}`, `/campaigns/${campaigns[0].id}`, `/analytics?quizId=${shared.id}`, "/campaigns"]) {
    await page.goto(admin + route);
    await page.waitForLoadState("networkidle");
    check(new URL(page.url()).pathname === route.split("?")[0], `legacy link ${route}`);
  }
  await page.goto(admin + `/quizzes/new`);
  await page.getByRole("heading", { name: "Nouveau quiz", exact: true }).waitFor();

  // Error, retry and loading states.
  await page.route("**/api/experiences", (route) => route.fulfill({ status: 500, json: { error: "Synthèse indisponible" } }));
  await page.goto(admin + "/quizzes");
  await page.getByRole("alert").filter({ hasText: "Synthèse indisponible" }).waitFor();
  await page.unroute("**/api/experiences");
  await page.getByRole("button", { name: "Réessayer" }).click();
  await cards.first().waitFor();
  check(await cards.count() === 5, "retry recovers");

  check(await prisma.quiz.count({ where: { tenantId } }) === 5 && await prisma.quizEditorDraft.count({ where: { tenantId } }) === 1 &&
    await prisma.metric.count({ where: { tenantId } }) === 4 && await prisma.campaign.count({ where: { tenantId } }) === 3, "page is read-only");
  check(errors.length === 0, errors.join("\n"));
  await context.close();

  // Provision the legacy default quiz once, so development StrictMode does not race two first-time requests.
  await fetch(`${process.env.POAPO_API_URL || "http://localhost:5050"}/api/auth/me`, { headers: { Authorization: `Bearer ${tokenFor(emptyId)}` } });
  const empty = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await empty.addInitScript(([value, key]) => { localStorage.setItem("poapo_admin_token", value); localStorage.setItem(key, JSON.stringify({ status: "dismissed" })); }, [tokenFor(emptyId), `poapo_tour_v1:${emptyId}`]);
  const emptyPage = await empty.newPage();
  // Any merchant page load provisions the legacy default quiz, so the empty state is exercised with an empty synthesis.
  await emptyPage.route("**/api/experiences", (route) => route.fulfill({ status: 200, json: {
    shopActive: true, period: { from: new Date().toISOString(), to: new Date().toISOString(), days: 30 }, experiences: [] } }));
  await emptyPage.goto(admin + "/quizzes");
  await emptyPage.getByRole("heading", { name: "Vous n'avez pas encore d'expérience" }).waitFor();
  check(await emptyPage.getByRole("link", { name: "Créer ma première expérience" }).getAttribute("href") === "/experiences/new", "empty tenant invites creation without campaign");
  check(await emptyPage.locator(".dashboard-stat").count() === 0, "no fictional figures for an empty tenant");
  if (output) await emptyPage.screenshot({ path: path.join(output, "experiences-vide.png"), fullPage: true });
  await empty.close();
  console.log(`PASS: ${assertions} browser assertions; screenshots: ${output || "not requested"}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, emptyId, foreignId] } } });
  await prisma.$disconnect();
});
