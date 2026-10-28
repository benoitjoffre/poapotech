// Opt-in browser regression against the local admin, API, PostgreSQL and Python service.
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");

const prisma = new PrismaClient();
const tenantId = `preview-browser-${randomUUID()}`;
const adminUrl = process.env.POAPO_ADMIN_URL || "http://localhost:5174";
let browser;
let page;
const errors = [];

async function main() {
  const tenant = await prisma.tenant.create({ data: {
    id: tenantId, email: `${tenantId}@example.test`, primaryColor: "#246753",
  } });
  await prisma.subscription.create({ data: { tenantId, plan: "BUSINESS", source: "LEGACY" } });
  const catalog = await prisma.catalog.create({ data: { tenantId, name: "Odyssey recette", isDefault: true } });
  const product = await prisma.product.create({ data: {
    tenantId, catalogId: catalog.id, name: "Voyage Odyssey de recette", tags: ["calme"],
    attributes: { pace: 0.4 }, purchaseUrl: "https://example.test/buy",
  } });
  const quiz = await prisma.quiz.create({ data: {
    id: `default_${tenantId}`, tenantId, catalogId: catalog.id, name: "Quiz de recette", isDefault: true,
    active: false, quizTitle: "Votre voyage", ctaText: "Découvrir",
    axes: [{ key: "pace", label: "Rythme" }], useAllProducts: false,
    products: { create: { productId: product.id } },
  } });
  const root = await prisma.question.create({ data: {
    tenantId, quizId: quiz.id, text: "Votre rythme ?", order: 0,
    answers: { create: [{ text: "Calme", order: 0, impacts: { pace: -0.2 } },
      { text: "Intense", order: 1, impacts: { pace: 0.2 } }] },
  }, include: { answers: { orderBy: { order: "asc" } } } });
  await prisma.question.create({ data: {
    tenantId, quizId: quiz.id, text: "Vos activités ?", type: "multi", order: 1,
    conditionAnswerId: root.answers[0].id,
    answers: { create: [{ text: "Nature", order: 0, impacts: { pace: 0.1 } },
      { text: "Culture", order: 1, impacts: { pace: 0.1 } }] },
  } });
  await prisma.question.create({ data: {
    tenantId, quizId: quiz.id, text: "Votre confort ?", type: "scale", order: 2, abVariant: "A",
    answers: { create: [{ text: "Simple", order: 0, impacts: { pace: -0.1 } },
      { text: "Premium", order: 1, impacts: { pace: 0.1 } }] },
  } });
  await prisma.question.create({ data: {
    tenantId, quizId: quiz.id, text: "Variante B ?", order: 3, abVariant: "B",
    answers: { create: [{ text: "Option B", order: 0, impacts: { pace: 0 } }] },
  } });
  await prisma.question.create({ data: {
    tenantId, quizId: quiz.id, text: "Question désactivée", order: 4, active: false,
  } });
  const campaign = await prisma.campaign.create({ data: {
    tenantId, quizId: quiz.id, name: "Campagne de recette", occasion: "PERMANENT", objectives: [],
  } });
  const snapshot = async () => ({
    sessions: await prisma.quizSession.findMany({ where: { tenantId } }),
    metrics: await prisma.metric.findMany({ where: { tenantId } }),
    drafts: await prisma.quizEditorDraft.findMany({ where: { tenantId } }),
    quiz: await prisma.quiz.findUnique({ where: { id: quiz.id }, include: {
      questions: { orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } } } }, products: true,
    } }),
  });
  const before = await snapshot();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const token = jwt.sign({ tenantId, email: tenant.email }, process.env.JWT_SECRET);
  await context.addInitScript((token) => {
    localStorage.setItem("poapo_admin_token", token);
    window.__previewBeacons = [];
    navigator.sendBeacon = (...args) => { window.__previewBeacons.push(args[0]); return true; };
  }, token);
  page = await context.newPage();
  const tracking = [];
  page.on("request", (request) => {
    if (/\/api\/quiz\/(track|submit|feedback|conversion)(?:[/?]|$)/.test(request.url())) tracking.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${adminUrl}/campaigns/${campaign.id}/quiz-editor`);
  await page.getByRole("tab", { name: "Apparence" }).click();
  await page.getByLabel("Couleur principale (hexadécimal)", { exact: true }).fill("#123456");
  await page.getByLabel("Couleur de fond (hexadécimal)", { exact: true }).fill("#FAF0DD");
  await page.getByLabel("Police des titres", { exact: true }).selectOption("georgia");
  await page.getByLabel("Forme des boutons", { exact: true }).selectOption("square");
  await page.getByLabel("Démarrer le quiz", { exact: true }).fill("Tester mon voyage");
  await page.getByRole("tab", { name: "Questions", exact: true }).click();
  const firstQuestion = page.locator(".questions-list .question-card").first();
  await firstQuestion.getByRole("button", { name: /Modifier/ }).click();
  await firstQuestion.locator(".question-meta-form input").first().fill("Rythme local non enregistré ?");
  await page.getByRole("tab", { name: "Aperçu", exact: true }).click();
  await page.getByText("Un formulaire de question ou réponse est en cours :", { exact: false }).waitFor();
  await page.getByRole("tab", { name: "Questions", exact: true }).click();
  assert.equal(await firstQuestion.locator(".question-meta-form input").first().inputValue(), "Rythme local non enregistré ?");
  await firstQuestion.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("tab", { name: "Aperçu", exact: true }).click();
  await page.getByRole("button", { name: "Lancer l'aperçu local" }).click();
  const frame = page.frameLocator('iframe[title="Parcours du quiz en mode aperçu"]');
  await frame.getByRole("button", { name: "Tester mon voyage" }).click();
  await frame.getByText("Rythme local non enregistré ?", { exact: false }).first().waitFor();
  await frame.getByLabel("Calme", { exact: true }).click();
  await frame.getByLabel("Nature", { exact: true }).check();
  await frame.getByLabel("Culture", { exact: true }).check();
  await frame.getByRole("button", { name: "Suivant", exact: true }).click();
  await frame.getByRole("button", { name: "Choisir cette valeur" }).click();
  await frame.getByRole("button", { name: "Envoyer mes reponses" }).click();
  await frame.getByRole("heading", { name: product.name }).waitFor({ timeout: 20000 });
  assert.ok(await frame.locator(".result-explanation").innerText());
  assert.equal(await frame.locator("a[href*='/buy']").count(), 0);
  await page.getByRole("tab", { name: "Questions", exact: true }).click();
  await page.getByRole("tab", { name: "Aperçu", exact: true }).click();
  assert.equal(await frame.getByRole("heading", { name: product.name }).count(), 1);
  await page.getByRole("button", { name: "Recommencer", exact: true }).click();
  await frame.getByRole("button", { name: "Tester mon voyage" }).waitFor();
  const style = await frame.locator(".submit").first().evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderRadius,
    font: getComputedStyle(el.closest("#root").querySelector(".title")).fontFamily,
    body: getComputedStyle(el.ownerDocument.body).backgroundColor,
  }));
  assert.equal(style.background, "rgb(18, 52, 86)");
  assert.equal(style.radius, "0px");
  assert.ok(style.font.includes("Georgia"));
  assert.equal(style.body, "rgb(250, 240, 221)");
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.getByRole("button", { name: "Mobile", exact: true }).click();
  await page.getByLabel("Variante A/B").selectOption("B");
  await frame.getByRole("button", { name: "Tester mon voyage" }).click();
  await frame.getByLabel("Intense", { exact: true }).click();
  await frame.getByLabel("Option B", { exact: true }).click();
  const errorRoute = `**/api/quizzes/${quiz.id}/preview/recommendations`;
  await page.route(errorRoute, (route) => route.fulfill({ status: 503, contentType: "application/json",
    body: JSON.stringify({ error: "Moteur de recette indisponible" }) }));
  await frame.getByRole("button", { name: "Envoyer mes reponses" }).click();
  await frame.getByText("Moteur de recette indisponible").waitFor();
  await page.unroute(errorRoute);
  await frame.getByRole("button", { name: "Envoyer mes reponses" }).click();
  await frame.getByRole("heading", { name: product.name }).waitFor({ timeout: 20000 });
  assert.equal(await frame.getByRole("button", { name: "Découvrir", exact: true }).isDisabled(), true);
  await page.getByRole("tab", { name: "Apparence", exact: true }).click();
  assert.equal(await page.getByLabel("Couleur principale (hexadécimal)", { exact: true }).inputValue(), "#123456");
  await page.getByLabel("Démarrer le quiz", { exact: true }).fill("Nouveau départ");
  await page.getByRole("tab", { name: "Aperçu", exact: true }).click();
  await page.getByText("Le brouillon local a changé.", { exact: false }).waitFor();
  assert.equal(await frame.getByRole("heading", { name: product.name }).count(), 1);
  await page.getByRole("button", { name: "Actualiser depuis l'état local" }).click();
  await frame.getByRole("button", { name: "Nouveau départ" }).waitFor();
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const mode of ["Mobile", "Ordinateur"]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `outer overflow ${width}/${mode}`);
      assert.ok(await frame.locator("body").evaluate((el) => el.scrollWidth <= el.ownerDocument.documentElement.clientWidth),
        `frame overflow ${width}/${mode}`);
    }
  }
  assert.deepEqual(tracking, []);
  assert.deepEqual(await page.evaluate(() => window.__previewBeacons), []);
  assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage)), []);
  assert.deepEqual(errors, []);
  assert.deepEqual(await snapshot(), before);
  console.log("PASS: local unsaved questions/theme, pending forms, conditions, A/B, single/multi/scale, inactive quiz, real Python result, error/retry, restart, no tracking/writes, 320/375/768/1440px.");
}

main().catch(async (error) => {
  console.error(error);
  if (page) {
    console.error("URL:", page.url(), "Errors:", errors);
    console.error("Page:", (await page.locator("body").innerText()).slice(0, 2500));
    console.error("Preview panel:", await page.locator("#editor-panel-preview").innerText().catch(() => "not mounted"));
    for (const frame of page.frames().slice(1)) {
      console.error("Frame:", await frame.locator("body").innerText());
      console.error("Overflow:", await frame.evaluate(() => ({
        width: document.documentElement.clientWidth, scroll: document.body.scrollWidth,
        elements: [...document.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .map((el) => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right })).slice(0, 12),
      })));
    }
  }
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});
