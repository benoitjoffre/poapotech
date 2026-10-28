// Recette Auth0 RÉELLE (manuelle, jamais lancée par défaut). Aucun paramètre Auth0 n'est modifié par ce script.
// Prérequis (voir docs/recette-auth0-reelle.md) : deux comptes de test déjà créés dans le tenant Auth0 de DÉVELOPPEMENT,
// emails vérifiés, URL de callback http://localhost:5174 autorisée, API locale (5050) et admin (5174) démarrées avec poapoback/.env.
//   POAPO_REAL_AUTH0=1 AUTH0_E2E_A_EMAIL=… AUTH0_E2E_A_PASSWORD=… AUTH0_E2E_B_EMAIL=… AUTH0_E2E_B_PASSWORD=… node tests/auth0Real.browser.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");

const need = ["POAPO_REAL_AUTH0", "AUTH0_E2E_A_EMAIL", "AUTH0_E2E_A_PASSWORD", "AUTH0_E2E_B_EMAIL", "AUTH0_E2E_B_PASSWORD"].filter((k) => !process.env[k]);
if (need.length) { console.log(`SKIP recette Auth0 réelle : variables manquantes (${need.join(", ")})`); process.exit(0); }
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const admin = process.env.POAPO_ADMIN_URL || "http://localhost:5174";
const prisma = new PrismaClient();
let steps = 0;
const ok = (c, m) => { assert.ok(c, m); steps++; };

async function login(page, email, password) {
  await page.goto(admin + "/login");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/auth0\.com/);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/mot de passe|password/i).first().fill(password);
  await page.getByRole("button", { name: /continuer|continue|log in|se connecter/i }).first().click();
  const consent = page.getByRole("button", { name: /accepter|accept/i });
  if (await consent.isVisible({ timeout: 3000 }).catch(() => false)) await consent.click();
  await page.waitForURL((u) => u.origin === new URL(admin).origin, { timeout: 30000 });
}
async function onboardIfNeeded(page, name) {
  if (page.url().includes("/onboarding") || await page.waitForURL("**/onboarding", { timeout: 8000 }).then(() => true, () => false)) {
    await page.getByLabel("Nom de la boutique").fill(name);
    await page.getByLabel("Secteur d'activité").fill("Test recette");
    await page.getByRole("button", { name: "Créer ma boutique" }).click();
    await page.getByRole("button", { name: "Passer la visite" }).click({ timeout: 15000 }).catch(() => {});
  }
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED ? false : true });
  try {
    const a = await (await browser.newContext()).newPage();
    await login(a, process.env.AUTH0_E2E_A_EMAIL, process.env.AUTH0_E2E_A_PASSWORD);
    await onboardIfNeeded(a, "Recette Auth0 A");
    const ta = await prisma.tenant.findUniqueOrThrow({ where: { email: process.env.AUTH0_E2E_A_EMAIL.toLowerCase() } });
    const sa = await prisma.subscription.findUniqueOrThrow({ where: { tenantId: ta.id } });
    ok(sa.plan === "STARTER" && sa.source === "SIGNUP", "STARTER attribué automatiquement à l'inscription");
    await a.goto(admin + "/settings/subscription");
    await a.getByRole("heading", { name: /Formule/ }).waitFor();
    // Déconnexion / reconnexion.
    await a.getByRole("button", { name: "Déconnexion" }).click();
    await a.goto(admin + "/catalogs");
    await a.waitForURL("**/login");
    ok(true, "après déconnexion, accès refusé");
    await login(a, process.env.AUTH0_E2E_A_EMAIL, process.env.AUTH0_E2E_A_PASSWORD);
    ok(await prisma.tenant.count({ where: { email: process.env.AUTH0_E2E_A_EMAIL.toLowerCase() } }) === 1, "reconnexion sans nouvelle boutique");
    // Isolation avec B.
    const b = await (await browser.newContext()).newPage();
    await login(b, process.env.AUTH0_E2E_B_EMAIL, process.env.AUTH0_E2E_B_PASSWORD);
    await onboardIfNeeded(b, "Recette Auth0 B");
    const tb = await prisma.tenant.findUniqueOrThrow({ where: { email: process.env.AUTH0_E2E_B_EMAIL.toLowerCase() } });
    ok(ta.id !== tb.id, "deux boutiques distinctes");
    await b.goto(admin + "/catalogs");
    ok(await b.getByText("Recette Auth0 A").count() === 0, "B ne voit pas A");
    console.log(`Auth0 réel : recette OK (${steps} contrôles)`);
  } finally { await browser.close(); await prisma.$disconnect(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
