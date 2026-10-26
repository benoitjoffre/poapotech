// Run against the local admin, API and PostgreSQL. Fixtures are isolated and removed.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { resolveStack } = require("./support/isolatedStack.cjs");

const prisma = new PrismaClient();
const tenantId = `help-browser-${randomUUID()}`;
const output = process.env.POAPO_SCREENSHOT_DIR;
const SLUGS = ["ajouter-vos-produits", "creer-une-experience", "personnaliser-les-questions", "tester-et-publier", "integrer-sur-votre-site", "comprendre-vos-resultats"];
let stack, browser, assertions = 0;
async function cards(page, expected) {
  const deadline = Date.now() + 4000;
  let n;
  while (Date.now() < deadline) { n = await page.locator(".help-grid a").count(); if (expected(n)) return n; await page.waitForTimeout(100); }
  return n;
}
function check(condition, message) { assert.ok(condition, message); assertions++; }

async function main() {
  stack = await resolveStack();
  const { admin } = stack;
  await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test`, name: "Boutique aide" } });
  await prisma.catalog.create({ data: { tenantId, name: "Catalogue aide", isDefault: true } });
  const token = jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((value) => localStorage.setItem("poapo_admin_token", value), token);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = (name) => output && page.screenshot({ path: path.join(output, `help-${name}.png`), fullPage: true });
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

  // Navigation + centre
  await page.goto(admin + "/");
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Centre d'aide" }).click();
  await page.getByRole("heading", { name: "Centre d'aide", level: 1 }).waitFor();
  check(new URL(page.url()).pathname === "/help", "sidebar leads to /help");
  check(await page.locator(".help-grid a").count() === 6, "six guide cards");
  check(await page.locator(".help-faq details").count() === 6, "six FAQ entries");
  await shot("center-1440");

  // FAQ
  const first = page.locator(".help-faq details").first();
  await first.locator("summary").click();
  check(await first.evaluate((d) => d.open), "FAQ opens");

  // Search
  const search = page.getByRole("searchbox");
  await search.fill("csv");
  check(new URL(page.url()).searchParams.get("q") === "csv", "q synced to URL");
  const csvCount = await cards(page, (n) => n === 1);
  check(csvCount === 1, `content search finds import guide (got ${csvCount})`);
  await search.fill("expérience");
  await page.waitForTimeout(400);
  const withAccent = await page.locator(".help-grid a").count();
  await search.fill("experience");
  await page.waitForTimeout(400);
  const noAccent = await page.locator(".help-grid a").count();
  check(noAccent === withAccent && withAccent > 0, `accent-insensitive search (${withAccent} vs ${noAccent})`);
  await search.fill("resultats");
  await cards(page, (n) => n === 1);
  check(await page.locator(".help-grid a", { hasText: "Comprendre vos résultats" }).count() === 1, "title search without accent");
  await search.fill("zzzqqq");
  await page.getByText("Aucun résultat").waitFor();
  await shot("search-empty");
  await search.fill("publier");
  await cards(page, (n) => n >= 1);
  await page.reload();
  check(await page.getByRole("searchbox").inputValue() === "publier", "search survives reload");
  check(await cards(page, (n) => n >= 1) >= 1, "results after reload");
  await page.goto(admin + "/help");
  await page.getByRole("button", { name: "Catalogue", exact: true }).click();
  check(await cards(page, (n) => n >= 1 && n < 6) >= 1, "category chip filters");

  // Articles, direct load, links, pager
  for (const [index, slug] of SLUGS.entries()) {
    await page.goto(admin + `/help/${slug}`);
    await page.getByRole("heading", { level: 1 }).waitFor();
    check(await page.locator(".help-steps li").count() >= 3, `${slug}: numbered steps`);
    check(await page.getByRole("heading", { name: "Bon à savoir" }).count() === 1, `${slug}: bon à savoir`);
    check(await page.getByRole("link", { name: "← Retour au Centre d'aide" }).count() === 1, `${slug}: back link`);
    await page.reload();
    await page.getByRole("heading", { level: 1 }).waitFor();
    check(await page.locator(".help-pager a.btn-primary").count() === 1, `${slug}: next navigation`);
    for (const href of await page.locator(".help-steps a").evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
      const p = await context.newPage();
      await p.goto(admin + href);
      await p.waitForLoadState("networkidle");
      check(new URL(p.url()).pathname !== "/login" && (await p.locator("h1").count()) > 0, `${slug}: link ${href} resolves`);
      await p.close();
    }
    if (index < SLUGS.length - 1) {
      await page.locator(".help-pager a.btn-primary").click();
      await page.waitForURL(`**/help/${SLUGS[index + 1]}`);
    }
  }
  await page.getByRole("link", { name: "← Retour au Centre d'aide" }).click();
  await page.getByRole("heading", { name: "Centre d'aide", level: 1 }).waitFor();
  await page.goto(admin + "/help/inconnu");
  await page.getByRole("heading", { name: "Article introuvable" }).waitFor();
  check(await page.getByRole("link", { name: "← Retour au Centre d'aide" }).count() === 1, "unknown slug has back link");

  // Keyboard
  await page.goto(admin + "/help");
  await page.getByRole("searchbox").focus();
  await page.keyboard.press("Tab");
  check(await page.evaluate(() => document.activeElement?.classList.contains("help-chip")), "tab reaches chips");
  const outline = await page.evaluate(() => { document.activeElement.focus(); return getComputedStyle(document.activeElement).outlineStyle; });
  check(outline !== "none", "chip focus visible");
  await page.goto(admin + "/help/tester-et-publier");
  await page.locator(".help-steps a").first().focus();
  check(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== "none"), "article link focus visible");

  // Responsive
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const url of ["/help", "/help?q=publier", "/help/personnaliser-les-questions", "/help/creer-une-experience"]) {
      await page.goto(admin + url);
      await page.getByRole("heading", { level: 1 }).waitFor();
      check(await noOverflow(), `no horizontal overflow ${url} @${width}`);
    }
    await page.goto(admin + "/help");
    await shot(`center-${width}`);
    await page.goto(admin + "/help/creer-une-experience");
    await shot(`article-${width}`);
  }

  // Contextual links + regressions
  await page.setViewportSize({ width: 1440, height: 1000 });
  const contextual = [["/catalog", "/help/ajouter-vos-produits"], ["/quizzes", "/help/creer-une-experience"], ["/analytics", "/help/comprendre-vos-resultats"]];
  for (const [from, to] of contextual) {
    await page.goto(admin + from);
    const link = page.locator(`main a[href="${to}"]`);
    await link.waitFor();
    await link.click();
    await page.waitForURL(`**${to}`);
    check(true, `contextual link ${from}`);
  }
  for (const route of ["/", "/catalogs", "/catalog", "/quizzes", "/campaigns", "/analytics", "/settings", "/experiences/new"]) {
    await page.goto(admin + route);
    await page.waitForLoadState("networkidle");
    check(new URL(page.url()).pathname === route || route === "/experiences/new", `route ${route} not redirected`);
    check(await page.locator("main h1, main h2").count() > 0, `route ${route} renders`);
  }
  check(errors.length === 0, errors.join("\n"));
  await context.close();

  const anonymous = await browser.newPage();
  for (const url of ["/help", "/help/tester-et-publier"]) {
    await anonymous.goto(admin + url);
    await anonymous.getByRole("button", { name: "Recevoir le lien de connexion" }).waitFor();
    check(new URL(anonymous.url()).pathname === "/login", `anonymous ${url} redirected to login`);
  }
  console.log(`PASS: ${assertions} browser assertions; screenshots: ${output || "not requested"}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  stack?.stop();
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});
