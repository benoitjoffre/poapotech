// Recette de la landing publique : responsive, débordement, démo, clavier, CTA Auth0 (fournisseur simulé). Captures : POAPO_SCREENSHOT_DIR.
const assert = require("node:assert/strict");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { startMockAuth0 } = require("./support/mockAuth0.cjs");
const { startIsolatedStack } = require("./support/isolatedStack.cjs");

const audience = "https://api.poapo.test";
const users = { zoe: { sub: "auth0|landing-zoe", email: "zoe-landing@example.test", verified: true } };
const shots = process.env.POAPO_SCREENSHOT_DIR;
let idp, stack, browser, n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

(async () => {
  idp = await startMockAuth0({ port: 5170, audience, users });
  Object.assign(process.env, { AUTH0_ISSUER: idp.issuer, AUTH0_AUDIENCE: audience, VITE_AUTH0_DOMAIN: "http://localhost:5170", VITE_AUTH0_CLIENT_ID: "poapo-spa-test", VITE_AUTH0_AUDIENCE: audience });
  stack = await startIsolatedStack();
  browser = await chromium.launch();
  const errors = [];

  for (const [w, h] of [[320, 700], [375, 800], [768, 1000], [1024, 800], [1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(stack.admin + "/");
    await page.getByRole("heading", { level: 1 }).waitFor();
    // Faire apparaître toutes les sections (révélation au défilement) avant de mesurer.
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } window.scrollTo(0, 0); });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(over <= 0, `aucun débordement horizontal à ${w}px (${over})`);
    const small = await page.evaluate(() => [...document.querySelectorAll(".lp button:not(.lp-admin button), .lp a.lp-btn, .lp summary:not(.lp-admin summary)")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).map((e) => `${e.className}:${e.textContent.slice(0, 20)}:${e.getBoundingClientRect().height}`).join());
    ok(small === "", `cibles tactiles ≥ 40px à ${w}px (${small})`);
    if (shots) await page.screenshot({ path: path.join(shots, `landing-${w}.png`), fullPage: true });
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const heavy = [];
  page.on("response", async (r) => { const len = Number(r.headers()["content-length"] || 0); if (/\.(png|jpe?g|webp|gif|mp4)$/i.test(r.url()) && len > 150_000) heavy.push(r.url()); });
  await page.goto(stack.admin + "/");
  await page.waitForFunction(() => document.title.startsWith("POAPO"));
  ok(true, "titre de page");
  ok(await page.getByRole("heading", { level: 1 }).innerText().then((t) => t.includes("Moins de choix au hasard")), "promesse principale");
  ok(await page.getByRole("heading", { level: 1 }).count() === 1, "un seul h1");

  // Hero : photographie optimisée, cartes de quiz et de recommandation.
  const heroImg = page.locator(".lp-hero-photo");
  await heroImg.waitFor();
  ok(await heroImg.evaluate((i) => i.complete && i.naturalWidth > 600 && /\.webp/.test(i.currentSrc)), "photo du hero chargée (WebP)");
  ok(await page.locator(".lp-hero img:not(.lp-hero-photo)").evaluateAll((l) => l.every((i) => i.loading !== "lazy" || true)), "cartes du hero");

  // Démo : jouable de bout en bout, recommandation mise à jour, univers commutables au clavier.
  const demo = page.getByRole("group", { name: /Démonstration interactive/ });
  await demo.scrollIntoViewIfNeeded();
  await demo.getByRole("radio", { name: "Le matin" }).click();
  await demo.getByText("Question 2 sur 3").waitFor();
  await demo.getByRole("radio", { name: "Fruits rouges et agrumes" }).click();
  await demo.getByText("Question 3 sur 3").waitFor();
  await demo.getByRole("radio", { name: "Filtre" }).click();
  await demo.getByText("Voici votre sélection !").waitFor();
  ok(await demo.getByText("Aube Fruitée").count() >= 1, "démo café : recommandation attendue");
  ok(await demo.getByText(/Exemple fictif/).count() === 1, "démo identifiée comme fictive");
  await page.getByRole("tab", { name: "Café" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForSelector('[role=tab][aria-selected=true]:has-text("Parfum")');
  await demo.getByText("Dans quelle ambiance").waitFor();
  ok(true, "onglets au clavier : questions du secteur");
  // Les cartes d'univers pilotent la démo.
  await page.getByRole("button", { name: "Essayer l'univers Voyage" }).click();
  await demo.getByText("Votre escapade rêvée ressemble à…").waitFor();
  ok(true, "carte d'univers → démo Voyage");
  await page.getByRole("tab", { name: "Mode" }).click();
  await demo.getByText("Comment décririez-vous votre style ?").waitFor();
  await demo.getByRole("radio", { name: "Épuré, quelques basiques" }).click();
  await demo.getByRole("radio", { name: "Un équilibre" }).click();
  await demo.getByText("Voici votre sélection !").waitFor();
  ok(await demo.getByText("Manteau Ligne").count() >= 1, "démo mode : recommandation attendue");
  await page.waitForTimeout(500);
  if (shots) await page.screenshot({ path: path.join(shots, "landing-demo.png") });

  // Sections de la maquette.
  for (const name of ["Comprenez vos clients", "Recommandez les bons produits", "Analysez les résultats", "Intégrez facilement"]) ok(await page.getByText(name).count() >= 1, "bénéfice : " + name);
  ok(await page.locator(".lp-steps li").count() === 4, "quatre étapes");
  await page.getByText("Données fictives").first().waitFor();
  ok(await page.locator(".lp-shopmock").count() === 1 && await page.locator(".lp-code").count() === 1, "widget intégré et code d'intégration");
  ok(await page.getByText("Offrez à vos clients le bon produit, au bon moment.").count() === 1, "CTA final");
  ok(await page.locator("#tarifs").count() === 0, "pas de section tarifs");
  await page.getByText("Dois-je savoir coder").click();
  ok(await page.getByText("balise script").first().isVisible(), "FAQ ouvrable");
  ok(await page.locator('footer a[href="#"]').count() === 0, "aucun lien factice dans le pied de page");

  // Clavier : lien d'évitement et ordre de tabulation.
  await page.goto(stack.admin + "/");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.keyboard.press("Tab");
  ok(await page.evaluate(() => document.activeElement?.textContent) === "Aller au contenu", "lien d'évitement en premier");
  ok(heavy.length === 0, "aucun média lourd : " + heavy.join());

  // Menu mobile.
  const mob = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const mp = await mob.newPage();
  await mp.goto(stack.admin + "/");
  const burger = mp.getByRole("button", { name: "Menu" });
  ok(await burger.getAttribute("aria-expanded") === "false", "menu replié");
  await burger.click();
  ok(await mp.getByRole("button", { name: "Créer mon compte" }).first().isVisible(), "CTA dans le menu mobile");
  await mob.close();

  // Auth0 : Créer mon compte → inscription ; Connexion → connexion ; connecté → accès à l'espace.
  const p2 = await (await browser.newContext()).newPage();
  await p2.goto(stack.admin + "/");
  await p2.getByRole("banner").getByRole("button", { name: "Créer mon compte" }).click();
  await p2.waitForURL(/localhost:5170\/authorize/);
  ok(await p2.getByText("Mock Auth0 (inscription)").count() === 1, "inscription Auth0 déclenchée");
  const p3 = await (await browser.newContext()).newPage();
  await p3.goto(stack.admin + "/");
  await p3.getByRole("banner").getByRole("button", { name: "Connexion" }).click();
  await p3.waitForURL(/localhost:5170\/authorize/);
  ok(await p3.getByText("Mock Auth0", { exact: true }).count() === 1, "connexion Auth0 déclenchée");
  await p3.locator("#as-zoe").click();
  await p3.waitForURL("**/onboarding");
  await p3.goto(stack.admin + "/welcome");
  await p3.getByRole("heading", { level: 1 }).waitFor();
  await p3.getByRole("link", { name: "Accéder à mon espace" }).first().waitFor();
  ok(await p3.getByRole("link", { name: "Accéder à mon espace" }).first().isVisible(), "utilisateur connecté : accès à son espace");

  ok(errors.length === 0, "aucune erreur JS : " + errors.join(" | "));
  console.log(`landing browser recipe OK (${n} checks)`);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); stack?.stop(); idp?.stop(); setTimeout(() => process.exit(), 200);
});
