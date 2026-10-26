// Recette G-05 : statuts de publication honnêtes et action « Publier et rendre accessible » (assistant, étape 5).
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { resolveStack } = require("./support/isolatedStack.cjs");

const prisma = new PrismaClient();
const tenantId = `pf-${randomUUID()}`;
const foreignId = `pf-foreign-${randomUUID()}`;
const shots = process.env.POAPO_SCREENSHOT_DIR;
let browser, stack, count = 0;
const ok = (v, m) => { count++; assert.ok(v, m); };
const eq = (a, b, m) => { count++; assert.equal(a, b, m); };

async function main() {
  stack = await resolveStack();
  const { api, admin } = stack;
  for (const id of [tenantId, foreignId]) await prisma.tenant.create({ data: { id, email: `${id}@example.test` } });
  const catalog = await prisma.catalog.create({ data: { tenantId, name: "Cafés", isDefault: true } });
  const fcatalog = await prisma.catalog.create({ data: { tenantId: foreignId, name: "Autre", isDefault: true } });
  await prisma.product.createMany({ data: [
    { tenantId, catalogId: catalog.id, name: "Doux", tags: [], attributes: { pace: 0.2 } },
    { tenantId, catalogId: catalog.id, name: "Corsé", tags: [], attributes: { pace: 0.8 } },
  ] });
  const axes = [{ key: "pace", label: "Intensité" }];
  const mk = (id, extra = {}) => prisma.quiz.create({ data: { id: `${id}_${tenantId}`, tenantId, catalogId: catalog.id, name: id, quizTitle: `${id} titre`, ctaText: "Voir", axes, active: false, ...extra } });
  const foreign = await prisma.quiz.create({ data: { id: `foreign_${foreignId}`, tenantId: foreignId, catalogId: fcatalog.id, name: "Intrus", quizTitle: "x", ctaText: "x", axes, active: false } });

  const token = jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const call = async (endpoint, method = "GET", body) => {
    const r = await fetch(api + endpoint, { method, headers, ...(body && { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const question = (text) => ({ id: `draft_${randomUUID()}`, text, helpText: null, type: "single", imageUrl: null, order: 0, active: true, conditionAnswerId: null, abVariant: null,
    answers: [0, 1].map((order) => ({ id: `draft_${randomUUID()}`, text: `R${order}`, emoji: null, imageUrl: null, order, active: true, impacts: { pace: order ? 0.2 : -0.2 } })) });
  // Brouillon enregistré via l'API (équivalent de « Enregistrer »), jamais publié.
  const saveDraft = async (id, patch) => {
    const cur = (await call(`/api/quizzes/${id}/draft`)).body;
    const draft = patch(structuredClone(cur.draft));
    const r = await call(`/api/quizzes/${id}/draft`, "PUT", { revision: cur.revision, draft });
    eq(r.status, 200, "brouillon enregistré");
    return r.body;
  };
  const publishApi = async (id) => {
    const cur = (await call(`/api/quizzes/${id}/draft`)).body;
    eq((await call(`/api/quizzes/${id}/publication/publish`, "POST", { revision: cur.revision, confirm: true })).status, 200);
  };
  const row = (id) => prisma.quiz.findUnique({ where: { id } });

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((v) => localStorage.setItem("poapo_admin_token", v), token);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = async (n) => { if (shots) await page.screenshot({ path: path.join(shots, n), fullPage: true }); };
  const open = async (id) => { await page.goto(`${admin}/experiences/${id}/setup?step=5`); await page.getByRole("heading", { name: "Vérifier et publier" }).waitFor(); };
  const status = (label) => page.locator("[data-publication-status]").filter({ hasText: label }).waitFor();
  const primary = page.getByRole("button", { name: "Publier et rendre accessible" });
  const campaigns = () => prisma.campaign.count({ where: { tenantId } });

  // 1. Première publication : brouillon enregistré mais rien publié → jamais « Publié ».
  const a = (await mk("first")).id;
  await saveDraft(a, (d) => ({ ...d, questions: [question("Doux ou corsé ?")] }));
  await open(a);
  await status("Brouillon non publié");
  eq(await page.getByText("Expérience publiée").count(), 0, "pas de confirmation avant publication");
  eq(await page.locator(".xp-badge.xe-publication").innerText(), "Brouillon non publié");
  eq((await row(a)).active, false, "enregistrer n'active pas");
  await shot("publish-avant.png");

  // 2. Échec de publication : état réel conservé, nouvel essai possible.
  await page.route(`**/api/quizzes/${a}/publication/publish`, (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Échec simulé" }) }), { times: 1 });
  await primary.click();
  await page.getByRole("alert").filter({ hasText: "Échec simulé" }).waitFor();
  eq((await row(a)).active, false, "rien n'est activé après un échec");
  eq((await call(`/api/quizzes/${a}/draft`)).body.hasChanges, true, "brouillon conservé");
  await status("Brouillon non publié");

  // 3. Réussite : publication + activation, confirmation, liens, aucune campagne créée.
  const before = await campaigns();
  await primary.click();
  await page.getByRole("heading", { name: "Expérience publiée" }).waitFor();
  await status("Publié et accessible");
  eq((await row(a)).active, true);
  eq(await campaigns(), before, "aucune campagne créée");
  ok(await page.getByRole("button", { name: "Copier le lien public" }).isVisible());
  ok(await page.getByRole("button", { name: "Copier le code d'intégration" }).isVisible());
  ok(await page.getByRole("link", { name: "Tester l'expérience publiée" }).isVisible());
  await shot("publish-apres.png");
  // Rechargement : même statut, déduit de l'API.
  await page.reload();
  await status("Publié et accessible");

  // 4. Modification d'une expérience publiée : enregistrer ≠ publier.
  await saveDraft(a, (d) => ({ ...d, config: { ...d.config, quizTitle: "Nouveau titre" } }));
  await page.reload();
  await status("Modifications non publiées");
  eq((await row(a)).quizTitle, `first titre`, "version publique inchangée");

  // 5. Quiz désactivé (publié) → réactivation par l'action principale.
  const b = (await mk("off")).id;
  await saveDraft(b, (d) => ({ ...d, questions: [question("Q ?")] }));
  await publishApi(b);
  await open(b);
  await status("Publié mais désactivé");
  await primary.click();
  await status("Publié et accessible");
  eq((await row(b)).active, true);

  // 6. Publication réussie mais accès fermé (boutique désactivée) : état réel affiché, pas de faux succès.
  const c = (await mk("shop")).id;
  await saveDraft(c, (d) => ({ ...d, questions: [question("Q ?")] }));
  await prisma.tenant.update({ where: { id: tenantId }, data: { active: false } });
  await open(c);
  await primary.click();
  await status("Publié mais désactivé");
  ok(await page.getByRole("link", { name: "Ouvrir les paramètres" }).isVisible());
  ok(!(await page.getByRole("button", { name: "Copier le lien public" }).count()), "pas de lien public tant que fermé");
  await prisma.tenant.update({ where: { id: tenantId }, data: { active: true } });
  await page.reload();
  await status("Publié et accessible");

  // 7. Avec campagne : le statut de la campagne n'influe pas.
  const d = (await mk("camp")).id;
  await saveDraft(d, (x) => ({ ...x, questions: [question("Q ?")] }));
  await prisma.campaign.create({ data: { tenantId, quizId: d, name: "Noël", occasion: "CUSTOM", occasionLabel: "x", status: "ACTIVE" } });
  await open(d);
  await status("Brouillon non publié");
  const n = await campaigns();
  await primary.click();
  await status("Publié et accessible");
  eq(await campaigns(), n);

  // 8. Isolation tenant.
  eq((await call(`/api/quizzes/${foreign.id}/draft`)).status >= 400, true, "brouillon étranger refusé");
  const overview = (await call("/api/experiences")).body;
  ok(!overview.experiences.some((e) => e.id === foreign.id), "expérience étrangère absente");
  await page.goto(`${admin}/experiences/${foreign.id}/setup`);
  await page.getByRole("alert").first().waitFor();
  eq((await row(foreign.id)).active, false);

  eq(errors.length, 0, errors.join("\n"));
  console.log(`PASS: ${count} browser assertions`);
}

main().then(() => { process.exitCode = 0; }).catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  stack?.stop();
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignId] } } }).catch(() => {});
  await prisma.$disconnect();
});
