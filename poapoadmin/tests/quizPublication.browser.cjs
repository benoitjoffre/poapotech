// Opt-in against the local admin, widget, API, PostgreSQL and recommendation service.
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");

const prisma = new PrismaClient();
const tenantId = `publication-browser-${randomUUID()}`;
const api = process.env.POAPO_API_URL || "http://localhost:5050";
const admin = process.env.POAPO_ADMIN_URL || "http://localhost:5174";
const widget = process.env.POAPO_WIDGET_URL || "http://localhost:5173";
let browser;
async function main() {
  const tenant = await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test`, primaryColor: "#246753" } });
  const catalog = await prisma.catalog.create({ data: { tenantId, name: "Odyssey publication", isDefault: true } });
  const product = await prisma.product.create({ data: { tenantId, catalogId: catalog.id, name: "Voyage Odyssey", tags: [],
    attributes: { pace: 0.4 } } });
  const quiz = await prisma.quiz.create({ data: { id: `default_${tenantId}`, tenantId, catalogId: catalog.id, isDefault: true,
    name: "Quiz publication", quizTitle: "Votre voyage", ctaText: "Voir", axes: [{ key: "pace", label: "Rythme" }],
    useAllProducts: false, products: { create: { productId: product.id } } } });
  const question = await prisma.question.create({ data: { tenantId, quizId: quiz.id, text: "Votre rythme ?", order: 0,
    answers: { create: [{ text: "Calme", order: 0, impacts: { pace: -0.2 } }, { text: "Intense", order: 1, impacts: { pace: 0.2 } }] } } });
  const campaign = await prisma.campaign.create({ data: { tenantId, quizId: quiz.id, name: "Odyssey principale", occasion: "PERMANENT", objectives: [] } });
  await prisma.campaign.create({ data: { tenantId, quizId: quiz.id, name: "Odyssey secondaire", occasion: "SPRING", objectives: [] } });
  const token = jwt.sign({ tenantId, email: tenant.email }, process.env.JWT_SECRET);
  async function request(endpoint, method = "GET", body) {
    const response = await fetch(api + endpoint, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body && { body: JSON.stringify(body) }) });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  const prefix = `/api/quizzes/${quiz.id}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((token) => localStorage.setItem("poapo_admin_token", token), token);
  const page = await context.newPage();
  const pageErrors = [];
  const publicationResponses = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("response", async (response) => {
    if (response.url().includes("/publication/")) publicationResponses.push({ status: response.status(), body: await response.text() });
  });
  await page.goto(`${admin}/campaigns/${campaign.id}/quiz-editor`);
  const questionCard = page.locator(".questions-list .question-card").first();
  await questionCard.getByRole("button", { name: /Modifier/ }).first().click();
  await questionCard.locator(".question-meta-form input").first().fill("Rythme publie ?");
  await page.getByRole("tab", { name: "Publication", exact: true }).click();
  const panel = page.locator("#editor-panel-publication");
  assert.equal(await panel.getByRole("button", { name: "Vérifier le quiz" }).isDisabled(), true);
  await page.getByRole("tab", { name: "Questions", exact: true }).click();
  assert.equal(await questionCard.locator(".question-meta-form input").first().inputValue(), "Rythme publie ?");
  await questionCard.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("tab", { name: "Apparence", exact: true }).click();
  await page.getByLabel("Couleur principale (hexadécimal)", { exact: true }).fill("#123456");
  await page.getByLabel("Couleur de fond (hexadécimal)", { exact: true }).fill("#FAF0DD");
  await page.getByLabel("Police des titres", { exact: true }).selectOption("georgia");
  await page.getByLabel("Forme des boutons", { exact: true }).selectOption("square");
  await page.getByLabel("Démarrer le quiz", { exact: true }).fill("Mon voyage");
  await page.getByRole("button", { name: "Enregistrer le brouillon", exact: true }).click();
  await page.getByText("Brouillon enregistré · révision 1", { exact: true }).waitFor();
  assert.equal((await prisma.question.findUnique({ where: { id: question.id } })).text, "Votre rythme ?");
  assert.equal((await request(`/api/embed/config?clientId=${tenantId}`)).theme, undefined);
  await page.getByRole("tab", { name: "Publication", exact: true }).click();
  const check = () => panel.getByRole("button", { name: "Vérifier le quiz" }).click();
  const general = panel.getByLabel("Je confirme le remplacement", { exact: false });
  const shared = panel.getByLabel("Je confirme que toutes les campagnes", { exact: false });
  const publish = panel.getByRole("button", { name: "Publier le brouillon", exact: true });
  await check();
  await panel.getByText("Aucune erreur bloquante.", { exact: true }).waitFor();
  await panel.getByRole("link", { name: "Odyssey secondaire", exact: true }).waitFor();
  await panel.getByRole("link", { name: "Configurer le quiz", exact: true }).first().waitFor();
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `diagnostic overflow ${width}`);
  }
  await general.check();
  assert.equal(await publish.isDisabled(), true);
  await shared.check();
  const publishUrl = `**/api/quizzes/${quiz.id}/publication/publish`;
  await page.route(publishUrl, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Echec transaction recette" }) }), { times: 1 });
  await publish.click();
  await panel.getByRole("alert").filter({ hasText: "Echec transaction recette" }).waitFor();
  assert.equal(await panel.getByText("Quiz publié avec succès.", { exact: false }).count(), 0);
  assert.equal((await prisma.question.findUnique({ where: { id: question.id } })).text, "Votre rythme ?");
  await check();
  await general.check(); await shared.check();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered;
  const enteredGate = new Promise((resolve) => { entered = resolve; });
  await page.route(publishUrl, async (route) => { entered(); await gate; await route.continue(); }, { times: 1 });
  await publish.click();
  await enteredGate;
  await page.getByRole("tab", { name: "Apparence", exact: true }).click();
  assert.equal(await page.getByLabel("Couleur principale (hexadécimal)", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Abandonner les modifications préparatoires" }).isDisabled(), true);
  await page.getByRole("tab", { name: "Questions", exact: true }).click();
  assert.equal(await questionCard.getByRole("button", { name: /Modifier/ }).first().isDisabled(), true);
  await page.getByRole("tab", { name: "Publication", exact: true }).click();
  release();
  try {
    await panel.getByText("Quiz publié avec succès.", { exact: false }).waitFor();
  } catch (err) {
    console.error(await panel.innerText(), publicationResponses);
    throw err;
  }
  const published = await request(prefix + "/draft");
  assert.equal(published.revision, 2);
  assert.equal(published.hasChanges, false);
  assert.equal(published.draft.questions[0].id, question.id);
  assert.equal(published.draft.questions[0].text, "Rythme publie ?");
  assert.equal(await prisma.metric.count({ where: { tenantId } }), 0);
  assert.equal(await prisma.quizSession.count({ where: { tenantId } }), 0);
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `publication overflow ${width}`);
  }
  const publicPage = await context.newPage();
  const publicResponses = [];
  publicPage.on("pageerror", (e) => pageErrors.push(e.message));
  publicPage.on("response", async (response) => {
    if (response.url().includes("/api/quiz/submit")) publicResponses.push({ status: response.status(), body: await response.text() });
  });
  await publicPage.goto(`${widget}/?clientId=${tenantId}`);
  await publicPage.getByRole("button", { name: "Mon voyage", exact: true }).waitFor();
  const style = await publicPage.locator(".submit").first().evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderRadius,
    font: getComputedStyle(el.ownerDocument.querySelector(".title")).fontFamily,
    body: getComputedStyle(el.ownerDocument.body).backgroundColor,
  }));
  assert.equal(style.background, "rgb(18, 52, 86)");
  assert.equal(style.radius, "0px");
  assert.ok(style.font.includes("Georgia"));
  assert.equal(style.body, "rgb(250, 240, 221)");
  await publicPage.getByRole("button", { name: "Mon voyage", exact: true }).click();
  await publicPage.getByLabel("Calme", { exact: true }).click();
  await publicPage.getByRole("button", { name: "Envoyer mes reponses", exact: true }).click();
  try {
    await publicPage.getByRole("heading", { name: product.name }).waitFor({ timeout: 20000 });
  } catch (err) {
    console.error(await publicPage.locator("body").innerText(), publicResponses);
    throw err;
  }
  assert.ok(await publicPage.locator(".result-explanation").innerText());
  await publicPage.close();
  // A concurrent saved draft invalidates the diagnostic, without losing local content.
  published.draft.config.quizTitle = "Revision concurrente";
  await request(prefix + "/draft", "PUT", { revision: published.revision, draft: published.draft });
  await check();
  await page.getByText("Conflit de révision.", { exact: false }).first().waitFor();
  assert.equal((await request(prefix + "/draft")).draft.config.quizTitle, "Revision concurrente");
  assert.equal((await request(`/api/embed/config?clientId=${tenantId}`)).quizTitle, "Votre voyage");
  const invalid = await request(prefix + "/draft");
  invalid.draft.questions[0].answers.forEach((answer) => { answer.active = false; });
  await request(prefix + "/draft", "PUT", { revision: invalid.revision, draft: invalid.draft });
  await page.reload();
  await page.getByRole("tab", { name: "Publication", exact: true }).click();
  await check();
  await panel.getByText("Question accessible sans réponse active.", { exact: true }).waitFor();
  assert.equal(await publish.count(), 0);
  await panel.getByRole("button", { name: "Voir l'élément", exact: true }).first().click();
  assert.equal(await page.getByRole("tab", { name: "Questions", exact: true }).getAttribute("aria-selected"), "true");
  await questionCard.getByText("Rythme publie ?", { exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
  console.log("PASS publication browser: local forms, shared confirmation, failure, edit lock, stable IDs, no publication tracking, public theme/journey, 409, 320/375/768/1440px");
}
main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});
