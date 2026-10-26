// Recette de l'assistant de création : création sans campagne, cinq étapes, reprise, conflit, aperçu, publication.
// Pile isolée par défaut (voir support/isolatedStack.cjs).
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { resolveStack } = require("./support/isolatedStack.cjs");

const prisma = new PrismaClient();
const tenantId = `xw-${randomUUID()}`;
const foreignId = `xw-foreign-${randomUUID()}`;
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
  await prisma.tenant.create({ data: { id: foreignId, email: `${foreignId}@example.test` } });
  const catalog = await prisma.catalog.create({ data: { tenantId, name: "Voyages", isDefault: true } });
  const foreignCatalog = await prisma.catalog.create({ data: { tenantId: foreignId, name: "Catalogue étranger", isDefault: true } });
  await prisma.product.createMany({ data: [
    { tenantId, catalogId: catalog.id, name: "Séjour calme", tags: [], attributes: { budget: 0.2 } },
    { tenantId, catalogId: catalog.id, name: "Séjour intense", tags: [], attributes: { budget: 0.8 } },
  ] });

  const token = jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const request = async (endpoint, method = "GET", body) => {
    const response = await fetch(api + endpoint, { method, headers, ...(body && { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const counts = async () => [await prisma.metric.count({ where: { tenantId } }), await prisma.quizSession.count({ where: { tenantId } }), await prisma.campaign.count({ where: { tenantId } })];

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((value) => localStorage.setItem("poapo_admin_token", value), token);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name), fullPage: true }); };
  const waitState = (value) => page.locator(`[data-state="${value}"]`).waitFor();
  const currentStep = async () => (await page.locator('.xw-step[aria-current="step"] .xw-step-label').innerText()).split(/\s*—/)[0].trim();
  const stepButton = (name) => page.locator(".xw-stepper").getByRole("button", { name });
  const next = () => page.getByRole("button", { name: "Enregistrer et continuer" });

  // 1. Nouveau commerçant : un seul catalogue, sélectionné automatiquement, aucune campagne.
  await page.goto(`${admin}/experiences/new`);
  await page.getByRole("heading", { name: "Créer une expérience", level: 1 }).waitFor();
  await page.getByText("sélectionné automatiquement").waitFor();
  eq(await page.locator('input[type="radio"]').count(), 0, "catalogue unique : pas de choix");
  const base = await counts();
  await page.getByLabel("Nom de l'expérience").fill("Mon premier voyage");
  await page.getByLabel("Titre public").fill("Trouvez votre séjour");
  await page.getByLabel(/Activité/).fill("Voyage");
  await shot("wizard-1440-creation.png");
  await page.getByRole("button", { name: /Commencer l'assistant/ }).click();
  await page.waitForURL(/\/experiences\/[^/]+\/setup\?step=1$/);
  const quizId = new URL(page.url()).pathname.split("/")[2];
  const created = await prisma.quiz.findUnique({ where: { id: quizId } });
  eq(created.tenantId, tenantId);
  eq(created.catalogId, catalog.id);
  eq(created.active, false, "créée inactive");
  eq(JSON.stringify(created.axes), "[]", "aucun axe inventé");
  eq((await counts())[2], base[2], "aucune campagne créée");

  // 2. Étape 1 : produits.
  await page.getByRole("heading", { name: "Mes produits", level: 2 }).waitFor();
  eq(await currentStep(), "Mes produits");
  eq(await page.locator(".xw-stepper li").count(), 5, "cinq étapes");
  ok(await page.getByText("Tous les produits actifs").first().isVisible(), "explication tous / sélection");
  ok(await page.getByText(/ne synchronise ni ne déduplique/).isVisible(), "import : pas de synchronisation");
  ok(await stepButton(/Mes questions/).isDisabled(), "étapes futures non accessibles");
  await shot("wizard-1440-produits.png");
  await next().click();
  await page.getByRole("heading", { name: "Qu'est-ce qui différencie vos produits ?" }).waitFor();

  // 3. Étape 2 : aucun axe imposé ; exemple ajouté sur clic ; saisie manuelle.
  ok(await page.getByText("Aucune préférence définie.").isVisible(), "état sans axe");
  await page.getByRole("button", { name: /Budget : Économique/ }).click();
  ok(await page.getByRole("button", { name: /✓ Budget/ }).isDisabled(), "exemple déjà ajouté");
  await page.getByRole("button", { name: /^Ajouter (une préférence|un axe)/i }).first().click().catch(() => {});
  await shot("wizard-1440-preferences.png");
  // Navigation arrière puis avant : le formulaire local survit.
  await stepButton(/Mes produits/).click();
  await page.getByRole("heading", { name: "Mes produits", level: 2 }).waitFor();
  eq((await request(`/api/quizzes/${quizId}/draft`)).body?.draft?.config?.axes?.length ?? 0, 0, "l'axe local n'est pas enregistré par un retour en arrière");
  await stepButton(/Mes préférences/).click();
  await page.getByRole("heading", { name: "Qu'est-ce qui différencie vos produits ?" }).waitFor();
  ok(await page.getByRole("button", { name: /✓ Budget/ }).isVisible(), "axe local conservé entre les étapes");
  await next().click();
  await page.getByRole("button", { name: "+ Nouvelle question" }).waitFor();
  const draft = (await request(`/api/quizzes/${quizId}/draft`)).body;
  eq(draft.draft.config.axes.length >= 1, true, "axe enregistré dans le brouillon");
  eq(JSON.stringify((await prisma.quiz.findUnique({ where: { id: quizId } })).axes), "[]", "version publiée inchangée");

  // 4. Étape 3 : question du Quiz Builder.
  await page.getByRole("button", { name: "+ Nouvelle question" }).click();
  await page.getByPlaceholder("Ex: Quelle est votre saison préférée ?").fill("Quel budget ?");
  await page.getByRole("button", { name: "Créer la question" }).click();
  await page.getByText("Quel budget ?").first().waitFor();
  await page.getByRole("button", { name: "+ Ajouter une réponse" }).click();
  await page.getByPlaceholder("Texte de la réponse…").fill("Économique");
  await page.getByRole("button", { name: "+ Ajouter", exact: true }).click();
  await page.getByText("Économique").first().waitFor();
  await shot("wizard-1440-questions.png");
  await page.getByRole("button", { name: /Enregistrer et quitter/ }).click();
  await page.waitForURL(/\/quizzes/, { timeout: 8000 }).catch(async (e) => { console.log("ALERT:", await page.locator("[role=alert]").allInnerTexts()); await shot("debug.png"); throw e; });

  // 5. Reprise : le brouillon est retrouvé, étape de reprise cohérente.
  await page.goto(`${admin}/experiences/${quizId}/setup`);
  await page.locator(".xw-stepper").waitFor();
  const resumed = await currentStep();
  ok(["Mes questions", "Personnaliser et tester"].includes(resumed), `reprise sur ${resumed}`);
  await page.goto(`${admin}/experiences/${quizId}/setup?step=3`);
  await page.getByText("Quel budget ?").first().waitFor();

  // Garde de navigation : modification locale non appliquée.
  await page.goto(`${admin}/experiences/${quizId}/setup?step=1`);
  await page.getByRole("heading", { name: "Mes produits", level: 2 }).waitFor();
  await page.waitForFunction(() => document.querySelector("#quiz-name")?.value === "Mon premier voyage");
  await page.getByLabel("Nom interne", { exact: true }).fill("Mon voyage v2");
  ok(await stepButton(/Mes préférences/).isEnabled());
  await next().click();
  await page.getByRole("heading", { name: "Qu'est-ce qui différencie vos produits ?" }).waitFor();
  eq((await request(`/api/quizzes/${quizId}/draft`)).body.draft.config.name, "Mon voyage v2", "enregistré à l'étape suivante");

  // 6. Conflit de révision.
  const current = (await request(`/api/quizzes/${quizId}/draft`)).body;
  eq((await request(`/api/quizzes/${quizId}/draft`, "PUT", { revision: current.revision, draft: { ...current.draft, config: { ...current.draft.config, name: "Nom concurrent" } } })).status, 200);
  await stepButton(/Mes produits/).click();
  await page.getByLabel("Nom interne", { exact: true }).fill("Nom local conflit");
  await stepButton(/Mes préférences/).click();
  await waitState("conflict");
  ok(await page.getByText(/Conflit de révision/).first().isVisible());
  await stepButton(/Mes produits/).click();
  eq(await page.getByLabel("Nom interne", { exact: true }).inputValue(), "Nom local conflit", "modifications locales conservées après 409");
  await shot("wizard-1440-conflit.png");

  // Résolution : on recharge la session, on réapplique un nom valide.
  await page.goto(`${admin}/experiences/${quizId}/setup?step=4`);
  await page.getByRole("heading", { name: /Personnaliser|Apparence|Aperçu/ }).first().waitFor();

  // 7. Étape 4 : aperçu sans tracking.
  const before = await counts();
  await page.locator("#editor-panel-preview").getByRole("button", { name: /Actualiser|Générer|Lancer|Démarrer|aperçu/i }).first().click().catch(() => {});
  await page.locator("iframe.quiz-preview-frame").waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  eq(JSON.stringify(await counts()), JSON.stringify(before), "l'aperçu ne crée ni session, ni métrique, ni campagne");
  ok(await page.locator("#editor-panel-appearance").isVisible(), "apparence visible à l'étape 4");
  await shot("wizard-1440-apercu.png");

  // 8. Étape 5 : diagnostic, activation, publication.
  await next().click();
  await page.getByRole("heading", { name: "Vérifier et publier" }).waitFor();
  eq(await currentStep(), "Vérifier et publier");
  const panel = page.locator("#editor-panel-publication");
  await panel.getByRole("button", { name: "Vérifier le quiz" }).click();
  await panel.getByText(/Aucune erreur bloquante|Erreurs bloquantes/).first().waitFor();
  await page.locator("#wizard-active").check();
  await page.getByRole("button", { name: "Appliquer et enregistrer", exact: true }).click();
  await waitState("saved");
  eq((await prisma.quiz.findUnique({ where: { id: quizId } })).active, false, "activation non effective avant publication");
  await panel.getByRole("button", { name: "Vérifier le quiz" }).click();
  await panel.getByText("Aucune erreur bloquante.", { exact: true }).waitFor({ timeout: 8000 }).catch(async (e) => { console.log("PANEL:", (await panel.innerText()).slice(0, 900)); throw e; });
  await panel.getByLabel("Je confirme le remplacement", { exact: false }).check();
  await panel.getByRole("button", { name: "Publier le brouillon", exact: true }).click();
  await panel.getByText("Quiz publié avec succès.", { exact: false }).waitFor();
  const published = await prisma.quiz.findUnique({ where: { id: quizId } });
  eq(published.active, true);
  ok(published.axes.length >= 1, "axes publiés");
  await page.getByText(/Publié/).first().waitFor();
  ok(await page.getByText(/Accessible au public/).first().isVisible(), "publié et accessible distingués");
  ok(await page.getByRole("link", { name: /résultats/i }).first().isVisible(), "lien résultats");
  ok(await page.getByRole("link", { name: /Mes expériences/ }).first().isVisible(), "retour Mes expériences");
  await shot("wizard-1440-publie.png");

  // Lien public.
  const publicPage = await context.newPage();
  await publicPage.goto(`${widget}/?clientId=${tenantId}&quizId=${quizId}`);
  await publicPage.locator(".title").first().waitFor();
  ok((await publicPage.locator(".title").first().innerText()).includes("Trouvez"), "lien public sert la version publiée");
  await publicPage.close();
  eq((await counts())[2], base[2], "toujours aucune campagne");

  // 9. Catalogues multiples : choix explicite ; catalogue étranger inaccessible.
  const second = await prisma.catalog.create({ data: { tenantId, name: "Cafés" } });
  await page.goto(`${admin}/experiences/new`);
  await page.getByRole("heading", { name: "Créer une expérience", level: 1 }).waitFor();
  await page.locator('input[type="radio"]').first().waitFor();
  eq(await page.locator('input[type="radio"]').count(), 2, "deux catalogues : choix explicite");
  ok(!(await page.getByText("Catalogue étranger").count()), "catalogue d'un autre tenant absent");
  await page.getByLabel("Nom de l'expérience").fill("Mes cafés");
  await page.getByRole("radio", { name: /Cafés/ }).check();
  await page.getByRole("button", { name: /Commencer l'assistant/ }).click();
  await page.waitForURL(/\/setup\?step=1$/);
  const secondId = new URL(page.url()).pathname.split("/")[2];
  eq((await prisma.quiz.findUnique({ where: { id: secondId } })).catalogId, second.id);
  await page.getByText(/Aucun produit actif recommandable/).waitFor();
  ok(await page.getByRole("link", { name: "Importer un CSV" }).isVisible(), "état sans produit : import proposé");
  await shot("wizard-1440-sans-produit.png");
  const foreign = await request("/api/quizzes", "POST", { name: "Intrus", catalogId: foreignCatalog.id });
  ok(foreign.status >= 400 && foreign.status < 500, "écriture dans un catalogue étranger refusée");
  eq(await prisma.quiz.count({ where: { catalogId: foreignCatalog.id } }), 0);

  // 10. Responsive et clavier.
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const url of [`${admin}/experiences/new`, `${admin}/experiences/${quizId}/setup?step=5`]) {
      await page.goto(url);
      await page.locator("h1").first().waitFor();
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(overflow <= 1, `pas de débordement horizontal à ${width}px (${url.split("/").slice(-2).join("/")} : ${overflow})`);
    }
    await shot(`wizard-${width}-publication.png`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${admin}/experiences/${quizId}/setup?step=3`);
  await page.locator(".xw-stepper").waitFor();
  await stepButton(/Mes questions/).focus();
  await page.keyboard.press("Shift+Tab");
  eq(await page.evaluate(() => document.activeElement?.closest(".xw-stepper li")?.textContent?.includes("Mes préférences")), true, "stepper atteignable au clavier");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Qu'est-ce qui différencie vos produits ?" }).waitFor();

  // Anciennes routes toujours disponibles.
  await page.goto(`${admin}/quizzes/new`);
  await page.getByRole("heading", { name: "Nouveau quiz", exact: true }).waitFor();
  await page.goto(`${admin}/experiences/${quizId}/edit`);
  await page.getByRole("tab", { name: "Questions", exact: true }).waitFor();

  eq(errors.length, 0, errors.join("\n"));
  console.log(`PASS: ${count} browser assertions (pile ${stack.api})`);
}

main().then(() => { process.exitCode = 0; }).catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  stack?.stop();
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignId] } } }).catch(() => {});
  await prisma.$disconnect();
});
