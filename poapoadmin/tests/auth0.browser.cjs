// Recette Auth0 : inscription, onboarding, double soumission, déconnexion/reconnexion, email non vérifié, isolation,
// super-admin, visite guidée, premier catalogue. Fournisseur simulé (tests/support/mockAuth0.cjs) : aucun secret réel.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { startMockAuth0 } = require("./support/mockAuth0.cjs");
const { startIsolatedStack } = require("./support/isolatedStack.cjs");

const run = randomUUID().slice(0, 8);
const audience = "https://api.poapo.test";
const users = {
  alice: { sub: `auth0|alice-${run}`, email: `alice-${run}@example.test`, verified: true },
  bob: { sub: `auth0|bob-${run}`, email: `bob-${run}@example.test`, verified: true },
  carol: { sub: `auth0|carol-${run}`, email: `carol-${run}@example.test`, verified: false },
  root: { sub: `auth0|root-${run}`, email: `root-${run}@example.test`, verified: true },
};
const prisma = new PrismaClient();
let idp, stack, browser, steps = 0;
const ok = (c, m) => { assert.ok(c, m); steps++; };

async function signIn(page, who, signup = false) {
  await page.goto(stack.admin + "/login");
  await page.getByRole("button", { name: signup ? "Créer mon compte" : "Se connecter" }).click();
  await page.locator(`#as-${who}`).click();
}
async function createShop(page, name) {
  await page.waitForURL("**/onboarding");
  await page.getByLabel("Nom de la boutique").fill(name);
  await page.getByLabel("Secteur d'activité").fill("Café de spécialité");
  await page.getByLabel("Site web (facultatif)").fill("ma-boutique.fr");
  const submit = page.getByRole("button", { name: "Créer ma boutique" });
  await submit.dblclick(); // double soumission
}

(async () => {
  idp = await startMockAuth0({ port: 5170, audience, users });
  Object.assign(process.env, {
    AUTH0_ISSUER: idp.issuer, AUTH0_AUDIENCE: audience, SUPER_ADMIN_EMAIL: users.root.email,
    VITE_AUTH0_DOMAIN: "http://localhost:5170", VITE_AUTH0_CLIENT_ID: "poapo-spa-test", VITE_AUTH0_AUDIENCE: audience,
  });
  stack = await startIsolatedStack();
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (process.env.DBG) console.log("console:", m.text().slice(0, 200)); });
  page.on("requestfailed", (r) => { if (process.env.DBG) console.log("failed:", r.url().slice(0, 120), r.failure()?.errorText); });
  page.on("response", (r) => { if (process.env.DBG && r.url().includes(":5170")) console.log("idp:", r.status(), r.url().slice(0, 110)); });
  page.on("pageerror", (e) => errors.push(e.message));

  // Non connecté : page de connexion Auth0, pas de formulaire legacy.
  await page.goto(stack.admin + "/catalog");
  await page.waitForURL("**/login");
  ok(await page.getByRole("button", { name: "Créer mon compte" }).count() === 1, "écran Auth0");
  ok(await page.getByText("Magic link").count() === 0, "plus de magic link marchand");

  // Inscription d'un nouveau commerçant + double soumission.
  await signIn(page, "alice", true);
  await createShop(page, "Café Alice");
  await page.getByRole("dialog", { name: "Bienvenue sur POAPO !" }).waitFor();
  ok(true, "visite guidée proposée au premier accès");
  ok(await prisma.tenant.count({ where: { email: users.alice.email } }) === 1, "un seul tenant malgré la double soumission");
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { email: users.alice.email } });
  ok(tenant.primaryColor === "#6C47FF" && tenant.name === "Café Alice", "paramètres initiaux");
  ok(await prisma.quiz.count({ where: { tenantId: tenant.id } }) <= 1 && await prisma.campaign.count({ where: { tenantId: tenant.id } }) === 0, "ni campagne ni quiz créés");
  await page.getByRole("button", { name: "Passer la visite" }).click();
  ok(await page.getByRole("link", { name: "Mes produits", exact: true }).isVisible() && await page.getByRole("link", { name: "Mes expériences", exact: true }).isVisible(), "accès produits et expériences");

  // Premier catalogue.
  await page.goto(stack.admin + "/catalogs");
  await page.locator("#catalog-name").fill("Mon premier catalogue");
  await page.getByRole("button", { name: "Créer le catalogue" }).click();
  await page.getByText("Mon premier catalogue").first().waitFor();
  ok(await prisma.catalog.count({ where: { tenantId: tenant.id, name: "Mon premier catalogue" } }) === 1, "premier catalogue créé");

  // Import CSV : envoi de fichier authentifié par le jeton Auth0 (appel hors apiFetch).
  await page.goto(stack.admin + "/catalog/import");
  await page.getByLabel("Fichier CSV").setInputFiles({ name: "produits.csv", mimeType: "text/csv", buffer: Buffer.from("nom,marque\nCafé test,Maison\n") });
  await page.getByRole("button", { name: "Analyser le fichier" }).click();
  await page.getByText(/nom/i).first().waitFor();
  ok(await page.getByText(/Erreur 401|Missing authorization/).count() === 0, "import CSV authentifié via Auth0");
  await page.goto(stack.admin + "/catalogs");
  await page.getByText("Mon premier catalogue").first().waitFor();

  // Rechargement (session silencieuse) puis déconnexion / reconnexion.
  await page.reload();
  await page.getByText("Mon premier catalogue").first().waitFor();
  ok(true, "session conservée après rechargement");
  await page.getByRole("button", { name: "Déconnexion" }).click();
  await page.getByRole("heading", { level: 1, name: /Moins de choix au hasard/ }).waitFor(); // retour sur la landing publique
  await page.goto(stack.admin + "/catalogs");
  await page.waitForURL("**/login");
  ok(true, "après déconnexion, l'accès est refusé");
  await signIn(page, "alice");
  await page.waitForURL(stack.admin + "/");
  await page.goto(stack.admin + "/catalogs");
  await page.getByText("Mon premier catalogue").first().waitFor();
  ok(await prisma.tenant.count({ where: { email: users.alice.email } }) === 1, "reconnexion sans nouvelle boutique");

  // Second commerçant : isolation.
  const ctxB = await browser.newContext();
  const pb = await ctxB.newPage();
  await signIn(pb, "bob", true);
  await createShop(pb, "Cosmétiques Bob");
  await pb.waitForURL(stack.admin + "/");
  await pb.goto(stack.admin + "/catalogs");
  await pb.locator("#catalog-name").waitFor();
  ok(await pb.getByText("Mon premier catalogue").count() === 0, "bob ne voit pas le catalogue d'alice");
  const bobTenant = await prisma.tenant.findUniqueOrThrow({ where: { email: users.bob.email } });
  ok(bobTenant.id !== tenant.id, "deux boutiques distinctes");

  // Email non vérifié : pas de boutique.
  const ctxC = await browser.newContext();
  const pc = await ctxC.newPage();
  await signIn(pc, "carol", true);
  await pc.getByText("Vérifiez votre adresse email").waitFor();
  ok(await prisma.tenant.count({ where: { email: users.carol.email } }) === 0, "aucun tenant pour un email non vérifié");

  // Super-admin : jamais créé par l'inscription, accès à l'administration.
  const ctxR = await browser.newContext();
  const pr = await ctxR.newPage();
  await signIn(pr, "root");
  await pr.waitForURL("**/admin/tenants");
  ok(await prisma.user.count({ where: { auth0Sub: users.root.sub } }) === 0, "super-admin sans User marchand");

  // Jeton d'une autre API refusé par le backend.
  const wrong = await fetch(stack.api + "/api/auth/me", { headers: { Authorization: "Bearer " + "x.y.z" } });
  ok(wrong.status === 401, "jeton invalide refusé");
  ok(errors.length === 0, "aucune erreur JS : " + errors.join(" | "));
  console.log(`auth0 browser recipe OK (${steps} checks)`);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  const subs = Object.values(users).map((u) => u.sub);
  await prisma.user.deleteMany({ where: { auth0Sub: { in: subs } } }).catch(() => {});
  await prisma.tenant.deleteMany({ where: { email: { in: Object.values(users).map((u) => u.email) } } }).catch(() => {});
  await browser?.close(); stack?.stop(); idp?.stop(); await prisma.$disconnect(); setTimeout(() => process.exit(), 200);
});
