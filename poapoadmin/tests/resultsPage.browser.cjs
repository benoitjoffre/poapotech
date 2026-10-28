// Recette page Résultats : synthèse, filtres, détail, états vides, campagne, responsive et clavier.
// Pile isolée par défaut (voir support/isolatedStack.cjs). Captures dans POAPO_SHOTS_DIR si défini.
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { resolveStack } = require("./support/isolatedStack.cjs");

const prisma = new PrismaClient();
const tenantId = `results-browser-${randomUUID()}`;
const emptyTenant = `${tenantId}-empty`;
let browser;
let stack;
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions++; }
const shot = async (page, name) => { if (process.env.POAPO_SHOTS_DIR) await page.screenshot({ path: path.join(process.env.POAPO_SHOTS_DIR, `${name}.png`), fullPage: true }); };

async function main() {
  stack = await resolveStack();
  const { admin } = stack;
  for (const id of [tenantId, emptyTenant]) {
    await prisma.tenant.create({ data: { id, email: `${id}@example.test`, name: "La Belle Boutique" } });
    await prisma.subscription.create({ data: { tenantId: id, plan: "BUSINESS", source: "LEGACY" } });
  }
  const [voyage, cafe] = await Promise.all([
    prisma.catalog.create({ data: { tenantId, name: "Catalogue Odyssey" } }),
    prisma.catalog.create({ data: { tenantId, name: "Catalogue Café" } }),
  ]);
  const mk = (catalogId, name) => prisma.quiz.create({ data: { tenantId, catalogId, name, quizTitle: name, ctaText: "Voir", active: true } });
  const [travel, coffee] = [await mk(voyage.id, "Quel est votre style de voyage ?"), await mk(cafe.id, "Quel café vous correspond ?")];
  for (const name of ["Été", "Noël"]) {
    await prisma.campaign.create({ data: { tenantId, quizId: travel.id, name, occasion: "CUSTOM", occasionLabel: name, objectives: [] } });
  }
  const product = await prisma.product.create({ data: { tenantId, catalogId: voyage.id, name: "Séjour Bali", tags: [] } });
  const question = await prisma.question.create({ data: { tenantId, quizId: travel.id, text: "Quelle destination idéale ?" } });
  const answer = await prisma.answer.create({ data: { questionId: question.id, text: "Plage" } });
  const ago = (days) => new Date(Date.now() - days * 86400000);
  const m = (quizId, type, payload, days) => ({ tenantId, quizId, type, payload, createdAt: ago(days) });
  await prisma.metric.createMany({ data: [
    ...Array.from({ length: 6 }, (_, i) => m(travel.id, "quiz_start", {}, i + 1)),
    m(travel.id, "quiz_complete", {}, 1), m(travel.id, "quiz_complete", {}, 2),
    m(travel.id, "buy_click", { productId: product.id }, 1),
    m(travel.id, "step_view", { step: question.id, questionId: question.id }, 1),
    m(travel.id, "step_answer", { step: question.id, questionId: question.id, answerId: answer.id }, 1),
    m(coffee.id, "quiz_start", {}, 20), m(coffee.id, "quiz_start", {}, 40),
  ] });
  await prisma.quizSession.create({ data: { tenantId, quizId: travel.id, answers: [], resultProductId: product.id, completedAt: ago(1) } });

  const sign = (id) => jwt.sign({ tenantId: id, email: `${id}@example.test` }, process.env.JWT_SECRET);
  browser = await chromium.launch({ headless: true });
  const open = async (id, width = 1440, url = "/analytics") => {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(([value, key]) => { localStorage.setItem("poapo_admin_token", value); localStorage.setItem(key, JSON.stringify({ status: "dismissed" })); }, [sign(id), `poapo_tour_v1:${id}`]);
    const page = await context.newPage();
    await page.goto(`${admin}${url}`);
    return page;
  };
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

  // Tenant avec plusieurs expériences, quiz partagé par deux campagnes.
  const page = await open(tenantId);
  await page.getByRole("heading", { name: "Résultats", level: 1 }).waitFor();
  await page.locator(".rs-kpi").first().waitFor();
  const kpi = (label) => page.locator(".rs-kpi", { hasText: label }).locator(".rs-kpi-value");
  check((await kpi("Démarrages de quiz").innerText()) === "7", "démarrages sur 30 jours (partagé non doublé)");
  check((await kpi("Quiz terminés").innerText()) === "2", "quiz terminés");
  check((await kpi("Recommandations générées").innerText()) === "1", "recommandations");
  check((await kpi("Clics vers les produits").innerText()) === "1", "clics produits");
  const body = await page.locator("body").innerText();
  for (const forbidden of [/chiffre d'affaires/i, /visiteurs uniques/i, /taux de conversion/i, /CTR/]) check(!forbidden.test(body), `libellé interdit absent ${forbidden}`);
  check((await page.locator(".rs-table tbody tr").count()) === 3, "expériences du tenant (dont le quiz par défaut)");
  check((await page.getByRole("heading", { name: /Détail — Quel est votre style/ }).count()) === 1, "détail de l'expérience la plus active");
  await page.getByText("Quelle destination idéale ?").first().waitFor();
  check(!(await page.locator("body").innerText()).includes(question.id), "libellé de question, jamais l'identifiant technique");
  await page.getByText("Séjour Bali").first().waitFor();
  check((await page.getByRole("link", { name: "Ouvrir l'éditeur" }).getAttribute("href")) === `/experiences/${travel.id}/edit`, "lien éditeur");
  check((await page.getByRole("link", { name: "Mes expériences" }).count()) >= 1, "lien Mes expériences");
  check(!(await overflow(page)), "pas de défilement horizontal à 1440");
  await shot(page, "results-1440");

  // Recherche, catalogue, tri.
  await page.getByLabel("Rechercher").fill("café");
  check((await page.locator(".rs-table tbody tr").count()) === 1, "recherche");
  await page.getByLabel("Rechercher").fill("");
  await page.getByLabel("Catalogue").selectOption(voyage.id);
  check((await page.locator(".rs-table tbody tr").count()) === 1, "filtre catalogue");
  await page.getByLabel("Catalogue").selectOption("");
  await page.getByLabel("Trier par").selectOption("name");
  check((await page.locator(".rs-table tbody th").first().innerText()).toLowerCase().startsWith("quel café"), "tri par nom");
  await page.getByRole("button", { name: /le détail de Quel café/ }).click();
  await page.getByRole("heading", { name: /Détail — Quel café/ }).waitFor();
  // Analyses avancées : aucune requête tant que le bloc est replié, suggestions seulement sur demande, même période que la page.
  const legacy = [];
  page.on("request", (request) => { if (request.url().includes("/api/quiz/metrics")) legacy.push(request.url()); });
  await page.getByRole("heading", { name: "Évolution sur 30 jours" }).waitFor();
  check(legacy.length === 0, "analyses avancées repliées : aucune requête");
  await page.getByText("Analyses avancées", { exact: true }).click();
  await page.getByText("Taux de complétion").waitFor();
  // React StrictMode rejoue les effets en dev : on compare les URL distinctes.
  check(new Set(legacy).size === 1 && !legacy[0].includes("ai-insights"), "ouverture : une seule requête, sans suggestions automatiques");
  const since = new URL(legacy[0]).searchParams.get("since");
  check(/T00:00:00\.000Z$/.test(since), "since aligné sur un jour UTC entier");
  await page.getByRole("button", { name: "Générer les suggestions" }).click();
  await page.getByRole("button", { name: "Rafraîchir" }).waitFor();
  check(new Set(legacy.filter((u) => u.includes("ai-insights"))).size === 1, "suggestions à la demande uniquement");

  // Période 7 jours : le démarrage à 40 jours et ceux > 7 jours disparaissent.
  await page.getByRole("button", { name: "7 jours" }).click();
  await page.waitForFunction(() => document.querySelector(".rs-kpi-value")?.textContent === "6");
  check(true, "période 7 jours");

  // Clavier : un bouton de période est atteignable et activable.
  await page.getByRole("button", { name: "30 jours" }).focus();
  await page.keyboard.press("Enter");
  check((await page.getByRole("button", { name: "30 jours" }).getAttribute("aria-pressed")) === "true", "activation clavier");

  // Arrivée depuis Campaign Studio.
  const campaignPage = await open(tenantId, 1440, `/analytics?quizId=${travel.id}&from=campaign`);
  await campaignPage.getByText("Résultats de l'expérience associée.").waitFor();
  await campaignPage.getByRole("heading", { name: /Détail — Quel est votre style/ }).waitFor();
  check(true, "quiz de la campagne sélectionné");

  // Responsive.
  for (const width of [768, 375, 320]) {
    const small = await open(tenantId, width);
    await small.locator(".rs-kpi").first().waitFor();
    check(!(await overflow(small)), `pas de défilement horizontal à ${width}`);
    await shot(small, `results-${width}`);
  }

  // Tenant sans expérience.
  // L'application recrée un quiz par défaut pour toute boutique : l'état vide est donc simulé côté API.
  const zero = { started: 0, completed: 0, recommendations: 0, productClicks: 0 };
  const empty = await open(emptyTenant, 1440, "/about:blank");
  await empty.context().route("**/api/results/summary**", (route) => route.fulfill({ json: {
    period: { from: ago(30).toISOString(), to: new Date().toISOString(), days: 30 }, totals: zero, previous: zero,
    daily: [], experiences: [], catalogs: [],
  } }));
  await empty.goto(`${admin}/analytics`);
  await empty.getByText("Aucune expérience pour le moment").waitFor();
  check((await empty.getByRole("link", { name: "Créer une expérience" }).count()) === 1, "état vide avec action");
  await shot(empty, "results-empty");

  // Erreur API : message + réessayer.
  const failing = await open(tenantId, 1440, "/about:blank");
  await failing.context().route("**/api/results/summary**", (route) => route.fulfill({ status: 500, json: { error: "Service indisponible" } }));
  await failing.goto(`${admin}/analytics`);
  await failing.getByRole("alert").getByText("Service indisponible").waitFor();
  check((await failing.getByRole("button", { name: "Réessayer" }).count()) === 1, "état d'erreur");
  console.log(`resultsPage.browser: ${assertions} assertions OK`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  stack?.stop();
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, emptyTenant] } } });
  await prisma.$disconnect();
});
