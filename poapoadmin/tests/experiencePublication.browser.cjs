// Recette complète : édition, brouillon, diagnostic, publication, lien public, conflit et liens du diagnostic.
// Pile isolée par défaut (voir support/isolatedStack.cjs) : aucune dépendance au limiteur du serveur de développement.
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { resolveStack } = require("./support/isolatedStack.cjs");

const prisma = new PrismaClient();
const tenantId = `xp-publication-${randomUUID()}`;
const shots = process.env.POAPO_SCREENSHOT_DIR;
let browser;
let stack;
let count = 0;
const ok = (value, message) => { count++; assert.ok(value, message); };
const eq = (actual, expected, message) => { count++; assert.equal(actual, expected, message); };

async function main() {
  stack = await resolveStack();
  const { api, admin, widget } = stack;
  await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test`, primaryColor: "#6C47FF" } });
  const catalog = await prisma.catalog.create({ data: { tenantId, name: "Voyages", isDefault: true } });
  await prisma.product.createMany({ data: [
    { tenantId, catalogId: catalog.id, name: "Séjour calme", tags: [], attributes: { pace: 0.2 } },
    { tenantId, catalogId: catalog.id, name: "Séjour intense", tags: [], attributes: { pace: 0.8 } },
  ] });
  const axes = [{ key: "pace", label: "Rythme" }];
  const makeQuiz = async (id, name, extra = {}, answers = [{ text: "Calme", impacts: { pace: -0.2 } }, { text: "Intense", impacts: { pace: 0.2 } }]) => {
    const quiz = await prisma.quiz.create({ data: { id, tenantId, catalogId: catalog.id, name, quizTitle: `${name} titre initial`, ctaText: "Voir", axes, active: true, ...extra } });
    const question = await prisma.question.create({ data: { tenantId, quizId: quiz.id, text: "Question initiale ?", order: 0,
      answers: { create: answers.map((answer, order) => ({ ...answer, order })) } } });
    return { quiz, question };
  };
  const { quiz: solo, question } = await makeQuiz(`default_${tenantId}`, "Quiz recette", { isDefault: true });
  const broken = await makeQuiz(`broken_${tenantId}`, "Quiz à corriger", { ctaText: "", useAllProducts: false },
    [{ text: "Réponse inactive", impacts: { pace: 0.1 }, active: false }]);

  const bearer = { Authorization: `Bearer ${jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET)}`, "Content-Type": "application/json" };
  const request = async (endpoint, method = "GET", body) => {
    const response = await fetch(api + endpoint, { method, headers: bearer, ...(body && { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const publicConfig = async () => (await fetch(`${api}/api/embed/config?clientId=${tenantId}`)).json();

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((value) => localStorage.setItem("poapo_admin_token", value), bearer.Authorization.slice(7));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const tab = (name) => page.getByRole("tab", { name, exact: true });
  const waitState = (value) => page.locator(`[data-state="${value}"]`).waitFor();
  const panel = page.locator("#editor-panel-publication");
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name), fullPage: true }); };
  const editorUrl = (id) => `${admin}/experiences/${id}/edit`;
  const save = () => page.getByRole("button", { name: "Enregistrer le brouillon", exact: true }).click();
  const publicTitle = async () => {
    const publicPage = await context.newPage();
    await publicPage.goto(`${widget}/?clientId=${tenantId}`);
    await publicPage.locator(".title").first().waitFor();
    const title = await publicPage.locator(".title").first().innerText();
    return { publicPage, title };
  };

  // Avant toute modification : le lien public reflète la version publiée.
  const before = await publicTitle();
  eq(before.title, "Quiz recette titre initial");
  await before.publicPage.close();

  // 1-3. Quiz sans campagne : configuration + question, puis enregistrement du brouillon.
  await page.goto(editorUrl(solo.id));
  await page.getByRole("heading", { name: "Quiz recette", level: 1 }).waitFor();
  eq((await request(`/api/campaigns?quizId=${solo.id}`)).body.data.length, 0, "quiz sans campagne");
  await page.waitForFunction(() => document.querySelector("#quiz-title")?.value === "Quiz recette titre initial");
  await page.getByLabel("Titre public", { exact: true }).fill("Titre publié par la recette");
  await page.getByRole("button", { name: "Appliquer au brouillon en cours" }).click();
  await waitState("applied");
  await tab("Questions").click();
  const card = page.locator(".questions-list .question-card").first();
  await card.getByRole("button", { name: /Modifier/ }).first().click();
  await card.locator(".question-meta-form input").first().fill("Question publiée par la recette ?");
  await card.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("button", { name: "Enregistrer le brouillon", exact: true }).waitFor();
  await save();
  await waitState("saved");
  const draft = (await request(`/api/quizzes/${solo.id}/draft`)).body;
  eq(draft.draft.config.quizTitle, "Titre publié par la recette");
  eq(draft.draft.questions[0].text, "Question publiée par la recette ?");
  eq(draft.hasChanges, true);

  // 8. Aucune fuite avant publication : base, API publique et widget restent inchangés.
  eq((await prisma.quiz.findUnique({ where: { id: solo.id } })).quizTitle, "Quiz recette titre initial");
  eq((await prisma.question.findUnique({ where: { id: question.id } })).text, "Question initiale ?");
  eq((await publicConfig()).quizTitle, "Quiz recette titre initial");
  const leak = await publicTitle();
  eq(leak.title, "Quiz recette titre initial", "le widget public n'expose pas le brouillon");
  await leak.publicPage.close();

  // 4. Diagnostic serveur.
  await tab("Publication").click();
  await panel.getByRole("button", { name: "Vérifier le quiz" }).click();
  await panel.getByText("Aucune erreur bloquante.", { exact: true }).waitFor();
  const confirm = panel.getByLabel("Je confirme le remplacement", { exact: false });
  const publish = panel.getByRole("button", { name: "Publier le brouillon", exact: true });
  await confirm.check();

  // Échec transactionnel simulé : rien n'est publié, le brouillon reste.
  await page.route(`**/api/quizzes/${solo.id}/publication/publish`,
    (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Échec simulé de la recette" }) }), { times: 1 });
  await publish.click();
  await panel.getByRole("alert").filter({ hasText: "Échec simulé de la recette" }).waitFor();
  eq((await publicConfig()).quizTitle, "Quiz recette titre initial", "rien n'est publié après un échec");
  eq((await request(`/api/quizzes/${solo.id}/draft`)).body.hasChanges, true, "le brouillon est conservé après un échec");

  // 5. Publication de la révision enregistrée.
  await panel.getByRole("button", { name: "Vérifier le quiz" }).click();
  await panel.getByText("Aucune erreur bloquante.", { exact: true }).waitFor();
  await confirm.check();
  await publish.click();
  await panel.getByText("Quiz publié avec succès.", { exact: false }).waitFor();
  await shot("publication-publiee.png");

  // 6-7. Lien public rechargé : contenu publié, brouillon réinitialisé.
  eq((await publicConfig()).quizTitle, "Titre publié par la recette");
  eq((await prisma.question.findUnique({ where: { id: question.id } })).text, "Question publiée par la recette ?", "identifiant de question conservé");
  eq((await request(`/api/quizzes/${solo.id}/draft`)).body.hasChanges, false);
  const after = await publicTitle();
  eq(after.title, "Titre publié par la recette");
  await after.publicPage.locator(".submit").first().click();
  await after.publicPage.getByText("Question publiée par la recette ?", { exact: false }).first().waitFor();
  ok(true, "question publiée visible dans le widget");
  await shot("public-apres-publication.png").catch(() => {});
  await after.publicPage.close();
  eq(await prisma.quizSession.count({ where: { tenantId } }), 0, "aucune session créée par l'édition ou la publication");

  // 9. Conflit de révision : une autre session enregistre avant la publication de cette session.
  await page.goto(editorUrl(solo.id));
  await page.getByRole("heading", { name: "Quiz recette", level: 1 }).waitFor();
  await page.waitForFunction(() => document.querySelector("#quiz-title")?.value === "Titre publié par la recette");
  await page.getByLabel("Titre public", { exact: true }).fill("Titre en conflit");
  await page.getByRole("button", { name: "Appliquer au brouillon en cours" }).click();
  await waitState("applied");
  await save();
  await waitState("saved");
  await tab("Publication").click();
  await panel.getByRole("button", { name: "Vérifier le quiz" }).click();
  await panel.getByText("Aucune erreur bloquante.", { exact: true }).waitFor();
  await confirm.check();
  const current = (await request(`/api/quizzes/${solo.id}/draft`)).body;
  const concurrent = await request(`/api/quizzes/${solo.id}/draft`, "PUT", {
    revision: current.revision, draft: { ...current.draft, config: { ...current.draft.config, quizTitle: "Titre concurrent" } } });
  eq(concurrent.status, 200);
  await publish.click();
  await waitState("conflict");
  ok(await page.getByText(/Conflit de révision/).first().isVisible());
  eq((await publicConfig()).quizTitle, "Titre publié par la recette", "un conflit ne publie rien");
  eq((await request(`/api/quizzes/${solo.id}/draft`)).body.draft.config.quizTitle, "Titre concurrent");
  await tab("Configuration").click();
  eq(await page.getByLabel("Titre public", { exact: true }).inputValue(), "Titre en conflit", "modifications locales conservées après conflit");
  await shot("publication-conflit.png");

  // Liens du diagnostic : chaque erreur ouvre la bonne section et cible le champ.
  await page.goto(editorUrl(broken.quiz.id));
  await page.getByRole("heading", { name: "Quiz à corriger", level: 1 }).waitFor();
  await tab("Publication").click();
  await panel.getByRole("button", { name: "Vérifier le quiz" }).click();
  await panel.getByRole("heading", { name: /Erreurs bloquantes/ }).waitFor();
  await shot("diagnostic-erreurs.png");
  const fix = (text) => panel.locator("li", { hasText: text }).getByRole("button", { name: "Corriger" }).first();
  const focused = (id) => page.waitForFunction((target) => document.activeElement?.id === target, id, { timeout: 5000 });

  await fix("Aucun produit actif").click();
  await focused("quiz-use-all-products");
  eq(await tab("Produits").getAttribute("aria-selected"), "true");

  await tab("Publication").click();
  await fix("Question accessible sans réponse active").click();
  await focused(`editor-question-${broken.question.id}`);
  eq(await tab("Questions").getAttribute("aria-selected"), "true");

  await tab("Configuration").click();
  await page.getByLabel("Nom interne", { exact: true }).fill("Nom local non enregistré");
  await tab("Publication").click();
  await fix("Le nom, le titre").click();
  eq(await tab("Configuration").getAttribute("aria-selected"), "true");
  eq(await page.getByLabel("Nom interne", { exact: true }).inputValue(), "Nom local non enregistré", "modifications locales préservées par la navigation du diagnostic");
  await focused("quiz-cta");
  eq(await page.locator("[data-state]").getAttribute("data-state"), "local");

  // Limiteur : aucune requête de la recette n'a été refusée.
  eq(errors.length, 0, errors.join("\n"));
  console.log(`PASS: ${count} browser assertions (pile ${stack.api})`);
}

main().then(() => { process.exitCode = 0; }).catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  stack?.stop();
  await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
  await prisma.$disconnect();
});
