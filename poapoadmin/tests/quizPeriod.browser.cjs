// QuizPeriodFields : aucune écriture au montage (React StrictMode du serveur de développement inclus), une seule par vraie modification.
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { startIsolatedStack } = require("./support/isolatedStack.cjs");

const prisma = new PrismaClient();
const tenantId = `period-${randomUUID()}`;
let browser, stack, count = 0;
const ok = (v, m) => { count++; assert.ok(v, m); };
const eq = (a, b, m) => { count++; assert.deepEqual(a, b, m); };

async function main() {
  stack = await startIsolatedStack();
  await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test` } });
  await prisma.subscription.create({ data: { tenantId, plan: "BUSINESS", source: "LEGACY" } });
  const catalog = await prisma.catalog.create({ data: { tenantId, name: "Cafés", isDefault: true } });
  const quiz = await prisma.quiz.create({ data: { tenantId, catalogId: catalog.id, name: "Quiz période", quizTitle: "Titre", ctaText: "Voir", active: false } });
  const token = jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addInitScript(([v, key]) => { localStorage.setItem("poapo_admin_token", v); localStorage.setItem(key, JSON.stringify({ status: "dismissed" })); }, [token, `poapo_tour_v1:${tenantId}`]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const puts = [];
  page.on("request", (r) => { if (r.method() === "PUT" && new URL(r.url()).pathname === `/api/quizzes/${quiz.id}`) puts.push(r.postData()); });
  const settle = () => page.waitForTimeout(2000); // > délai d'enregistrement automatique (800 ms)
  const url = `${stack.admin}/experiences/${quiz.id}/edit?section=configuration`;
  const occasion = () => page.getByLabel("Occasion", { exact: true });
  const tab = (name) => page.getByRole("tab", { name });

  // 1. Montage initial, sans aucune action : aucune écriture.
  await page.goto(url);
  await occasion().waitFor();
  await settle();
  eq(puts.length, 0, "aucun PUT au montage initial (StrictMode)");

  // 2. Vraie modification : exactement une écriture, avec la valeur choisie.
  await occasion().selectOption("CHRISTMAS");
  await page.getByText("Enregistré ✓").waitFor();
  await settle();
  eq(puts.length, 1, "un seul PUT après une modification");
  eq(JSON.parse(puts[0]).occasion, "CHRISTMAS", "valeur envoyée");
  eq((await prisma.quiz.findUnique({ where: { id: quiz.id } })).occasion, "CHRISTMAS", "valeur enregistrée");

  // 3. Démontage / remontage (changement d'onglet) : aucune écriture.
  await tab("Questions").click();
  await page.getByRole("tab", { name: "Questions", selected: true }).waitFor();
  await tab("Réglages").click();
  await occasion().waitFor();
  eq(await occasion().inputValue(), "CHRISTMAS", "valeur conservée au remontage");
  await settle();
  eq(puts.length, 1, "aucun PUT supplémentaire au remontage");

  // 4. Rechargement complet : aucune écriture.
  await page.reload();
  await occasion().waitFor();
  await settle();
  eq(puts.length, 1, "aucun PUT supplémentaire au rechargement");

  // 5. Modification puis retour immédiat à la valeur enregistrée (avant le délai) : rien à écrire.
  await occasion().selectOption("");
  await occasion().selectOption("CHRISTMAS");
  await settle();
  eq(puts.length, 1, "retour à la valeur enregistrée avant l'écriture : aucun PUT");

  // 6. Autre vraie modification (dates) : une écriture, la précédente valeur reste modifiable ensuite.
  await page.getByLabel("Début").fill("2026-12-01");
  await page.getByText("Enregistré ✓").waitFor();
  await settle();
  eq(puts.length, 2, "une écriture pour la date");
  await occasion().selectOption("");
  await settle();
  eq(puts.length, 3, "effacer l'occasion est une vraie modification");
  eq((await prisma.quiz.findUnique({ where: { id: quiz.id } })).occasion, null, "occasion effacée");
  ok(errors.length === 0, errors.join("\n"));
  console.log(`PASS: ${count} assertions (QuizPeriodFields)`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (stack) stack.stop();
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});
