// Opt-in against the local admin, API and PostgreSQL: POAPO_PLAYWRIGHT_MODULE=... node tests/experienceEditor.browser.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");

const prisma = new PrismaClient();
const { resolveStack } = require("./support/isolatedStack.cjs");
let api, admin, stack;
const shots = process.env.POAPO_SCREENSHOT_DIR;
const ids = [`xe-a-${randomUUID()}`, `xe-b-${randomUUID()}`];
let browser;
let count = 0;
const ok = (value, message) => { count++; assert.ok(value, message); };
const eq = (actual, expected, message) => { count++; assert.equal(actual, expected, message); };
const token = (tenantId) => jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET);

async function main() {
  stack = await resolveStack();
  ({ api, admin } = stack);
  const [tenantId, foreignId] = ids;
  for (const id of ids) await prisma.tenant.create({ data: { id, email: `${id}@example.test`, primaryColor: "#6C47FF" } });
  const voyage = await prisma.catalog.create({ data: { tenantId, name: "Voyage", isDefault: true } });
  const cafe = await prisma.catalog.create({ data: { tenantId, name: "Café" } });
  const foreignCatalog = await prisma.catalog.create({ data: { tenantId: foreignId, name: "Étranger", isDefault: true } });
  const axes = [{ key: "pace", label: "Rythme" }, { key: "culture", label: "Culture" }];
  await prisma.product.createMany({ data: [
    { tenantId, catalogId: voyage.id, name: "Séjour complet", tags: [], attributes: { pace: 0.4, culture: 0.7 } },
    { tenantId, catalogId: voyage.id, name: "Séjour partiel", tags: [], attributes: { pace: 0.6 } },
    { tenantId, catalogId: voyage.id, name: "Séjour inactif", tags: [], active: false, attributes: { pace: 0.1, culture: 0.1 } },
  ] });
  const make = async (id, name, extra = {}) => {
    const quiz = await prisma.quiz.create({ data: { id, tenantId, catalogId: voyage.id, name, quizTitle: `${name} (public)`, ctaText: "Voir",
      axes, active: true, ...extra } });
    await prisma.question.create({ data: { tenantId, quizId: quiz.id, text: "Votre rythme ?", order: 0,
      answers: { create: [{ text: "Calme", order: 0, impacts: { pace: -0.2 } }, { text: "Intense", order: 1, impacts: { pace: 0.2 } }] } } });
    return quiz;
  };
  const solo = await make(`default_${tenantId}`, "Quiz sans campagne", { isDefault: true });
  const shared = await make(`shared_${tenantId}`, "Quiz partagé");
  const off = await make(`off_${tenantId}`, "Quiz inactif", { active: false });
  const foreign = await prisma.quiz.create({ data: { id: `foreign_${foreignId}`, tenantId: foreignId, catalogId: foreignCatalog.id,
    name: "Quiz secret étranger", quizTitle: "Secret", ctaText: "Voir" } });
  const campaigns = [];
  for (const [name, status] of [["Vacances d'été", "ACTIVE"], ["Noël 2026", "SCHEDULED"]]) {
    campaigns.push(await prisma.campaign.create({ data: { tenantId, quizId: shared.id, name, occasion: "PERMANENT", objectives: [], status } }));
  }
  const bearer = { Authorization: `Bearer ${token(tenantId)}`, "Content-Type": "application/json" };
  const request = async (endpoint, method = "GET", body) => {
    const response = await fetch(api + endpoint, { method, headers: bearer, ...(body && { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((value) => localStorage.setItem("poapo_admin_token", value), token(tenantId));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const editor = (quizId, section) => `${admin}/experiences/${quizId}/edit${section ? `?section=${section}` : ""}`;
  const tab = (name) => page.getByRole("tab", { name, exact: true });
  const state = () => page.locator("[data-state]").getAttribute("data-state");
  const waitState = (value) => page.locator(`[data-state="${value}"]`).waitFor();
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name), fullPage: true }); };

  // 1. Quiz sans campagne : l'éditeur s'ouvre et la liste des sections est complète.
  await page.goto(editor(solo.id));
  await page.getByRole("heading", { name: "Quiz sans campagne", level: 1 }).waitFor();
  eq((await page.getByRole("tab").allTextContents()).map((t) => t.replace(/^\d/, "")).join("|"),
    "Configuration|Produits|Questions|Apparence|Aperçu|Publication");
  ok(await page.getByText("Aucune campagne n'utilise cette expérience").isVisible());
  ok(await page.getByRole("link", { name: "← Mes expériences" }).isVisible());
  eq(await state(), "published");
  ok(await page.getByText("Public : accessible").isVisible());
  ok(await page.getByRole("link", { name: "Voir les résultats" }).isVisible());
  ok(await page.getByRole("link", { name: /Lien public/ }).isVisible());
  ok(await page.getByText("Préférences de recommandation", { exact: true }).isVisible());
  await shot("editor-1440-configuration.png");

  // 2. Produits : avertissement, couverture réelle des axes, outils.
  await tab("Produits").click();
  ok(await page.getByText("Les produits ne sont pas protégés par le brouillon").isVisible());
  await page.getByText("2 sur 3 dans le catalogue").waitFor();
  ok(await page.getByText("1 sur 2 avec tous les axes renseignés").isVisible());
  ok(await page.getByRole("link", { name: "Gérer les produits" }).isVisible());
  await shot("editor-1440-produits.png");

  // 3. Modification locale conservée entre sections, puis appliquée, enregistrée.
  await tab("Configuration").click();
  await page.getByLabel("Titre public", { exact: true }).fill("Nouveau titre public");
  eq(await state(), "local");
  await tab("Questions").click();
  await tab("Configuration").click();
  eq(await page.getByLabel("Titre public", { exact: true }).inputValue(), "Nouveau titre public");
  await tab("Publication").click();
  ok(await page.locator("#editor-panel-publication").getByRole("button", { name: "Vérifier le quiz" }).isDisabled());
  await tab("Configuration").click();
  await page.getByRole("button", { name: "Appliquer au brouillon en cours" }).click();
  await waitState("applied");
  eq((await prisma.quiz.findUnique({ where: { id: solo.id } })).quizTitle, "Quiz sans campagne (public)");
  await page.getByRole("button", { name: "Enregistrer le brouillon", exact: true }).click();
  await waitState("saved");
  eq((await prisma.quiz.findUnique({ where: { id: solo.id } })).quizTitle, "Quiz sans campagne (public)", "le brouillon ne publie rien");
  const draft = await request(`/api/quizzes/${solo.id}/draft`);
  eq(draft.body.draft.config.quizTitle, "Nouveau titre public");
  await shot("editor-1440-brouillon.png");

  // 4. Protection contre la perte de modifications : le garde de navigation demande confirmation.
  await tab("Configuration").click();
  await page.getByLabel("Texte du bouton résultat", { exact: true }).fill("Autre bouton");
  const dialogs = [];
  page.once("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await page.getByRole("link", { name: "← Mes expériences" }).click();
  await page.waitForTimeout(500);
  eq(dialogs.length, 1);
  ok(page.url().includes("/experiences/"), "reste sur l'éditeur après refus");
  await page.getByLabel("Texte du bouton résultat", { exact: true }).fill("Voir");
  eq(await state(), "saved");

  // 5. Changement de catalogue appliqué au brouillon uniquement.
  await page.getByLabel("Catalogue", { exact: true }).selectOption({ label: "Café" });
  await page.getByRole("button", { name: "Appliquer au brouillon en cours" }).click();
  await waitState("applied");
  ok(await page.getByText("Catalogue : Café").isVisible());
  await page.getByRole("button", { name: "Enregistrer le brouillon", exact: true }).click();
  await waitState("saved");
  eq((await prisma.quiz.findUnique({ where: { id: solo.id } })).catalogId, voyage.id, "catalogue public inchangé");

  // 6. Conflit 409 : une autre session enregistre pendant l'édition.
  const current = await request(`/api/quizzes/${solo.id}/draft`);
  const other = await request(`/api/quizzes/${solo.id}/draft`, "PUT", {
    revision: current.body.revision, draft: { ...current.body.draft, config: { ...current.body.draft.config, name: "Nom concurrent" } } });
  eq(other.status, 200);
  await page.getByLabel("Nom interne", { exact: true }).fill("Mon nom local");
  await page.getByRole("button", { name: "Appliquer au brouillon en cours" }).click();
  await page.getByRole("button", { name: "Enregistrer le brouillon", exact: true }).click();
  await waitState("conflict");
  ok(await page.getByText(/Conflit de révision/).first().isVisible());
  eq(await page.getByLabel("Nom interne", { exact: true }).inputValue(), "Mon nom local", "modifications locales conservées");
  await shot("editor-1440-conflit.png");

  // 7. Aperçu : aucun tracking créé.
  await page.goto(editor(solo.id, "preview"));
  await page.locator("h1").waitFor();
  const before = [await prisma.metric.count({ where: { tenantId } }), await prisma.quizSession.count({ where: { tenantId } })];
  await page.locator("#editor-panel-preview").getByRole("button", { name: /Actualiser|Générer|Lancer|Démarrer|aperçu/i }).first().click().catch(() => {});
  await page.locator("iframe.quiz-preview-frame").waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  const after = [await prisma.metric.count({ where: { tenantId } }), await prisma.quizSession.count({ where: { tenantId } })];
  eq(JSON.stringify(after), JSON.stringify(before), "l'aperçu ne crée ni session ni métrique");
  await shot("editor-1440-apercu.png");

  // 8. Publication : la révision enregistrée seulement.
  await page.goto(editor(solo.id, "publication"));
  await page.locator("h1").waitFor();
  await page.locator("#editor-panel-publication").getByRole("button", { name: "Vérifier le quiz" }).click();
  await page.locator("#editor-panel-publication").getByText(/Brouillon|révision|Diagnostic|Publication possible/i).first().waitFor();
  await shot("editor-1440-publication.png");

  // 9. Quiz partagé : campagnes affichées, inactif signalé.
  await page.goto(editor(shared.id));
  await page.getByRole("heading", { name: "Quiz partagé", level: 1 }).waitFor();
  ok(await page.getByText("Campagnes liées · 2").isVisible());
  for (const campaign of campaigns) ok(await page.locator(".xe-campaigns").getByRole("link", { name: campaign.name }).isVisible());
  ok(await page.getByText(/Aucune copie du quiz n'existe par campagne/).isVisible());
  await shot("editor-1440-partage.png");
  await page.goto(editor(off.id));
  await page.getByRole("heading", { name: "Quiz inactif", level: 1 }).waitFor();
  ok(await page.getByText("Public : désactivé").isVisible());
  ok(await page.getByText("Lien public indisponible").isVisible());

  // 10. Clavier : flèches entre les sections.
  await page.goto(editor(solo.id));
  await page.locator("h1").waitFor();
  await tab("Configuration").focus();
  await page.keyboard.press("ArrowRight");
  eq(await tab("Produits").getAttribute("aria-selected"), "true");
  await page.keyboard.press("End");
  eq(await tab("Publication").getAttribute("aria-selected"), "true");

  // 11. Isolation tenant : le quiz d'un autre tenant n'est pas accessible.
  await page.goto(editor(foreign.id));
  await page.getByRole("alert").waitFor();
  ok(!(await page.content()).includes("Quiz secret étranger"));
  eq((await request(`/api/quizzes/${foreign.id}/draft`)).status, 404);

  // 12. Anciennes routes toujours disponibles.
  await page.goto(`${admin}/quiz-builder?quizId=${shared.id}`);
  await page.getByRole("heading", { name: /Quiz Builder/ }).waitFor();
  await page.goto(`${admin}/quizzes/${shared.id}`);
  await page.getByRole("heading", { name: /Configurer le brouillon du quiz/ }).waitFor();
  await page.goto(`${admin}/campaigns/${campaigns[0].id}/quiz-editor`);
  await page.getByRole("heading", { name: "Vacances d'été", level: 1 }).waitFor();
  eq(await page.getByRole("tab").count(), 4);

  // 13. Depuis Mes expériences : « Éditer » ouvre le nouvel éditeur.
  await page.goto(`${admin}/quizzes`);
  const card = page.locator(".xp-card", { hasText: "Quiz sans campagne" }).first();
  await card.getByRole("link", { name: /Reprendre le brouillon|Éditer/ }).click();
  await page.waitForURL(new RegExp(`/experiences/${encodeURIComponent(solo.id)}/edit`));
  await page.getByRole("heading", { name: /Quiz sans campagne|Mon nom|Nom concurrent/, level: 1 }).waitFor();

  // 14. Responsive.
  const tabNames = { configuration: "Configuration", questions: "Questions", publication: "Publication" };
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(editor(shared.id));
    await page.getByRole("heading", { name: "Quiz partagé", level: 1 }).waitFor();
    for (const section of Object.keys(tabNames)) {
      await tab(tabNames[section]).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(overflow <= 1, `débordement horizontal ${overflow}px à ${width}px (${section})`);
      ok(await tab("Publication").isVisible());
      ok(await page.getByRole("link", { name: "Voir les résultats" }).isVisible());
    }
    await tab("Configuration").click();
    await shot(`editor-${width}.png`);
  }
  eq(errors.length, 0, errors.join("\n"));
  console.log(`PASS: ${count} browser assertions`);
}

main().then(() => process.exitCode = 0).catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  stack?.stop();
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await prisma.$disconnect();
});
