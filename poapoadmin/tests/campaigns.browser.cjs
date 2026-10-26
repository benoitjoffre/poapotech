// Recette Campaign Studio (Sprint UX D) : liste, création guidée, détail, partage, isolation tenant, anciennes routes, responsive.
// Pile isolée (voir support/isolatedStack.cjs).
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { resolveStack } = require("./support/isolatedStack.cjs");

const prisma = new PrismaClient();
const tenantId = `cp-${randomUUID()}`;
const otherTenantId = `cp-other-${randomUUID()}`;
const shots = process.env.POAPO_SCREENSHOT_DIR;
let browser;
let stack;
let count = 0;
const ok = (value, message) => { count++; assert.ok(value, message); };
const eq = (actual, expected, message) => { count++; assert.equal(actual, expected, message); };
const day = (offset) => new Date(Date.now() + offset * 86400000);

async function main() {
  stack = await resolveStack();
  const { api, admin } = stack;
  for (const id of [tenantId, otherTenantId]) {
    await prisma.tenant.create({ data: { id, email: `${id}@example.test`, primaryColor: "#6C47FF" } });
  }
  const catalog = await prisma.catalog.create({ data: { tenantId, name: "Voyages", isDefault: true } });
  const catalog2 = await prisma.catalog.create({ data: { tenantId, name: "Cadeaux" } });
  const otherCatalog = await prisma.catalog.create({ data: { tenantId: otherTenantId, name: "Autre", isDefault: true } });
  const axes = [{ key: "pace", label: "Rythme" }];
  const makeQuiz = (id, owner, cat, name, active, extra = {}) =>
    prisma.quiz.create({ data: { id, tenantId: owner, catalogId: cat.id, name, quizTitle: name, ctaText: "Voir", axes, active, ...extra } });
  const shared = await makeQuiz(`default_${tenantId}`, tenantId, catalog, "Quiz partagé", true, { isDefault: true });
  const inactive = await makeQuiz(`inactive_${tenantId}`, tenantId, catalog2, "Quiz inactif", false);
  const foreign = await makeQuiz(`default_${otherTenantId}`, otherTenantId, otherCatalog, "Quiz étranger", true, { isDefault: true });
  const camp = (data) => prisma.campaign.create({ data: { tenantId, occasion: "PROMOTION", objectives: [], ...data } });
  const noDates = await camp({ quizId: shared.id, name: "Sans dates", status: "DRAFT" });
  const scheduled = await camp({ quizId: shared.id, name: "Programmée été", status: "SCHEDULED", startsAt: day(10), endsAt: day(20) });
  const finished = await camp({ quizId: shared.id, name: "Terminée hiver", status: "ACTIVE", startsAt: day(-30), endsAt: day(-10) });
  const onInactive = await camp({ quizId: inactive.id, name: "Sur quiz inactif", status: "DRAFT" });
  const foreignCampaign = await prisma.campaign.create({ data: { tenantId: otherTenantId, quizId: foreign.id, name: "Campagne étrangère", occasion: "PROMOTION", objectives: [], status: "DRAFT" } });

  const bearer = jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET);
  const request = async (endpoint, method = "GET", body) => {
    const response = await fetch(api + endpoint, { method, headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, ...(body && { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  await context.addInitScript((value) => localStorage.setItem("poapo_admin_token", value), bearer);
  const page = await context.newPage();
  const errors = [];
  const embedCalls = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => { if (req.url().includes("/api/embed") || req.url().includes("/api/sessions")) embedCalls.push(req.url()); });
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name), fullPage: true }); };
  const card = (name) => page.locator(".cp-card", { hasText: name });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // 1. Liste : états séparés, aucune statistique fictive, isolation tenant.
  await page.goto(`${admin}/campaigns`);
  await page.getByRole("heading", { name: "Campagnes", level: 1 }).waitFor();
  await page.locator(".cp-card").first().waitFor();
  eq(await page.locator(".cp-card").count(), 4, "4 campagnes du tenant, aucune étrangère");
  eq(await card("Campagne étrangère").count(), 0);
  const body = await page.locator("body").innerText();
  ok(!/Ventes/.test(body) && !/En ligne/.test(body) && !/Mettre en ligne/.test(body), "aucun libellé « En ligne » ni vente");
  ok(/Campagne : Terminée/.test(await card("Terminée hiver").innerText()), "campagne terminée (statut calculé)");
  ok(/Campagne : Programmée/.test(await card("Programmée été").innerText()));
  const noDatesText = await card("Sans dates").innerText();
  ok(/Campagne : Brouillon/.test(noDatesText) && /Quiz : /.test(noDatesText), "état campagne et état du quiz séparés");
  ok(/Quiz : .*désactivé|Quiz : .*inactif|Quiz : Désactivé/i.test(await card("Sur quiz inactif").innerText()), "quiz inactif signalé");
  eq(await card("Sans dates").getByRole("link", { name: "Ouvrir" }).count(), 1, "une seule action principale");
  eq(await card("Sans dates").locator(".btn-primary").count(), 1);
  ok(await card("Sans dates").getByRole("link", { name: "Quiz partagé" }).getAttribute("href") === `/experiences/${shared.id}/edit`, "lien vers l'éditeur unifié");
  await shot("campaigns-list-1440.png");

  // Filtres, recherche, tri, état vide.
  await page.getByRole("button", { name: /^Brouillons/ }).click();
  await page.waitForFunction(() => document.querySelectorAll(".cp-card").length === 2);
  await page.getByRole("button", { name: /^Toutes/ }).click();
  await page.getByLabel("Rechercher une campagne").fill("hiver");
  await page.waitForFunction(() => document.querySelectorAll(".cp-card").length === 1);
  await page.getByLabel("Rechercher une campagne").fill("zzz-introuvable");
  await page.getByText("Aucune campagne ne correspond").waitFor();
  await page.getByRole("button", { name: "Réinitialiser les filtres" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".cp-card").length === 4);
  await page.getByLabel("Trier").selectOption("name");
  await page.waitForFunction(() => /Programmée|Sans dates/.test(document.querySelector(".cp-card-title")?.textContent ?? ""));
  ok(await page.getByLabel("Catalogue").count() === 1, "plusieurs catalogues : filtre catalogue");
  await page.getByLabel("Catalogue").selectOption(catalog2.id);
  await page.waitForFunction(() => document.querySelectorAll(".cp-card").length === 1);
  await page.getByLabel("Catalogue").selectOption("");
  await page.waitForFunction(() => document.querySelectorAll(".cp-card").length === 4);

  // 2. Menu : clavier, duplication, suppression.
  const menuButton = page.getByRole("button", { name: "Autres actions pour Sans dates" });
  await menuButton.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("link", { name: "Modifier" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Modifier" }).waitFor({ state: "detached" });
  await card("Terminée hiver").getByRole("button", { name: /Autres actions/ }).click();
  eq(await page.getByRole("button", { name: "Supprimer le brouillon" }).count(), 0, "suppression absente hors brouillon");
  await page.keyboard.press("Escape");
  await card("Terminée hiver").getByRole("button", { name: /Autres actions/ }).click();
  await page.getByRole("button", { name: "Dupliquer" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".cp-card").length === 5);
  const copy = await prisma.campaign.findFirst({ where: { tenantId, name: "Terminée hiver (copie)" } });
  ok(copy, "copie créée");
  eq(copy.status, "DRAFT");
  eq(copy.startsAt, null);
  eq(copy.quizId, shared.id, "la copie réutilise le même quiz");
  eq(await prisma.quiz.count({ where: { tenantId } }), 2, "aucun quiz dupliqué");
  page.once("dialog", (dialog) => dialog.accept());
  await card("(copie)").getByRole("button", { name: /Autres actions/ }).click();
  await page.getByRole("button", { name: "Supprimer le brouillon" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".cp-card").length === 4);
  eq(await prisma.campaign.count({ where: { id: copy.id } }), 0);
  eq((await request(`/api/campaigns/${finished.id}`, "DELETE")).status, 409, "suppression refusée hors brouillon");
  eq((await request(`/api/campaigns/${foreignCampaign.id}`)).status, 404, "campagne d'un autre tenant introuvable");
  eq((await request(`/api/campaigns/${foreignCampaign.id}`, "DELETE")).status, 404);
  eq((await request("/api/campaigns", "POST", { quizId: foreign.id, name: "x", occasion: "PROMOTION", objectives: [], status: "DRAFT" })).status >= 400, true, "quiz étranger refusé");

  // 3. Détail : campagne partagée, accessible, avec lien public et intégration.
  await card("Sans dates").getByRole("link", { name: "Ouvrir" }).click();
  await page.getByRole("heading", { name: "Sans dates", level: 1 }).waitFor();
  await page.getByText("Partagée avec 2 autres campagnes").waitFor();
  ok(await page.getByRole("link", { name: "Programmée été" }).count() === 1, "autres campagnes listées");
  ok(await page.getByText(/sans en posséder de copie/).count() >= 1, "pas une copie indépendante");
  ok(await page.getByText(/Aucune vente n'est suivie/).count() === 1);
  ok(await page.getByText("Pas encore de données", { exact: false }).count() === 1, "état sans données");
  await page.getByRole("link", { name: "Modifier l'expérience" }).waitFor();
  eq(await page.getByRole("link", { name: "Modifier l'expérience" }).getAttribute("href"), `/experiences/${shared.id}/edit`);
  const link = await page.getByTestId("public-link").innerText();
  ok(link.includes(`clientId=${tenantId}`) && link.includes(`quizId=${shared.id}`), "lien public du quiz");
  await page.getByRole("button", { name: "Copier le code d'intégration" }).click();
  await page.getByText("Code d'intégration copié.").waitFor();
  ok((await page.evaluate(() => navigator.clipboard.readText())).includes(`data-quiz-id="${shared.id}"`), "code d'intégration copié");
  ok(await page.getByRole("link", { name: "Personnaliser le quiz" }).count() === 1, "Campaign Studio conservé");
  await shot("campaigns-detail-1440.png");

  // Détail sur quiz inactif : aucun lien public proposé.
  await page.goto(`${admin}/campaigns/${onInactive.id}`);
  await page.getByRole("heading", { name: "Sur quiz inactif", level: 1 }).waitFor();
  await page.getByText(/n'est pas accessible au public/).waitFor();
  eq(await page.getByTestId("public-link").count(), 0);
  await shot("campaigns-detail-inactive.png");

  // 4. Création guidée : validations, quiz inactif, enregistrement.
  await page.goto(`${admin}/campaigns/new`);
  await page.getByRole("heading", { name: "Nouvelle campagne", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("alert").filter({ hasText: "Donnez un nom" }).waitFor();
  await page.getByLabel("Nom de la campagne").fill("Noël recette");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("heading", { name: "Expérience associée" }).waitFor();
  ok(await page.getByText(/Utilisée par 3 campagnes/).count() >= 1, "nombre de campagnes utilisant déjà le quiz");
  ok(await page.getByText("Catalogue : Cadeaux").count() === 1, "catalogue affiché");
  await shot("campaigns-form-step2.png");
  await page.getByLabel(/Quiz inactif/).check();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByLabel("Statut de la campagne").selectOption("ACTIVE");
  await page.getByText(/Le quiz associé est désactivé/).waitFor();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("alert").filter({ hasText: "désactivé" }).waitFor();
  await page.getByLabel("Statut de la campagne").selectOption("DRAFT");
  await page.getByRole("button", { name: "Précédent" }).click();
  await page.getByLabel(/Quiz partagé/).check();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByLabel("Date de début").fill("2030-11-01");
  await page.getByLabel("Date de fin").fill("2030-12-24");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("heading", { name: "Récapitulatif" }).waitFor();
  await page.getByRole("button", { name: "Créer la campagne" }).click();
  await page.getByRole("heading", { name: "Noël recette", level: 1 }).waitFor();
  const created = await prisma.campaign.findFirst({ where: { tenantId, name: "Noël recette" } });
  ok(created && created.quizId === shared.id && created.status === "DRAFT", "campagne créée sans modifier le quiz");
  eq(await prisma.quiz.count({ where: { tenantId } }), 2);

  // Enregistrer et quitter (brouillon) puis reprise via l'ancienne route /edit.
  await page.goto(`${admin}/campaigns/new`);
  await page.getByLabel("Nom de la campagne").fill("À reprendre");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByLabel(/Quiz partagé/).check();
  await page.getByRole("button", { name: "Enregistrer en brouillon et quitter" }).click();
  await page.getByRole("heading", { name: "Campagnes", level: 1 }).waitFor();
  const resumed = await prisma.campaign.findFirst({ where: { tenantId, name: "À reprendre" } });
  eq(resumed.status, "DRAFT");
  await page.goto(`${admin}/campaigns/${resumed.id}/edit`);
  await page.waitForFunction(() => document.querySelector("#campaign-name")?.value === "À reprendre");
  await page.getByLabel("Nom de la campagne").fill("Reprise terminée");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("heading", { name: "Reprise terminée", level: 1 }).waitFor();
  eq((await prisma.campaign.findUnique({ where: { id: resumed.id } })).name, "Reprise terminée");

  // Rejet serveur conservé : programmer sur un quiz inactif reste refusé.
  eq((await request(`/api/campaigns/${onInactive.id}`, "PUT", { status: "ACTIVE" })).status, 400, "règle serveur conservée");

  // 5. Anciennes routes.
  for (const route of [`/campaigns/${noDates.id}/quiz-editor`, `/campaigns/${noDates.id}/generate-quiz`, "/quizzes", `/experiences/${shared.id}/edit`, "/experiences"]) {
    await page.goto(admin + route);
    await page.waitForLoadState("networkidle");
    ok(!(await page.locator("body").innerText()).includes("Page introuvable"), `route ${route}`);
  }

  // 6. Responsive.
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, route, ready] of [["list", "/campaigns", ".cp-card"], ["detail", `/campaigns/${noDates.id}`, ".cp-panel"], ["form", "/campaigns/new", ".cp-steps"]]) {
      await page.goto(admin + route);
      await page.locator(ready).first().waitFor();
      await page.waitForTimeout(150);
      if ((await overflow()) > 1) console.log("OVF", name, width, await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 6).map((e) => e.tagName + "." + e.className + ":" + Math.round(e.getBoundingClientRect().right))));
      ok((await overflow()) <= 1, `pas de débordement ${name} à ${width}px`);
      if (name !== "form" || width === 320) await shot(`campaigns-${name}-${width}.png`);
    }
  }

  eq(embedCalls.length, 0, "aucune session ni statistique créée par l'interface");
  eq(errors.length, 0, errors.join("\n"));
  console.log(`campaigns.browser: ${count} assertions OK`);
}

main().then(() => { process.exitCode = 0; }).catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  stack?.stop();
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } }).catch(() => {});
  await prisma.$disconnect();
});
