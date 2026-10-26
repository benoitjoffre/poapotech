// Run against the isolated admin, API and PostgreSQL. Fixtures are isolated and removed.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { resolveStack } = require("./support/isolatedStack.cjs");

const prisma = new PrismaClient();
const tenantId = `tour-browser-${randomUUID()}`;
const output = process.env.POAPO_SCREENSHOT_DIR;
const KEY = `poapo_tour_v1:${tenantId}`;
let stack, browser, assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions++; }

async function main() {
  stack = await resolveStack();
  const { admin } = stack;
  await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test`, name: "Boutique visite" } });
  await prisma.catalog.create({ data: { tenantId, name: "Catalogue visite", isDefault: true } });
  const token = jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET);
  const counts = async () => [await prisma.quiz.count({ where: { tenantId } }), await prisma.campaign.count({ where: { tenantId } })];
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((value) => { if (!sessionStorage.getItem("seeded")) localStorage.setItem("poapo_admin_token", value); }, token);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = (name) => output && page.screenshot({ path: path.join(output, `tour-${name}.png`) });
  const card = page.locator("[data-tour-card]");
  const status = () => page.evaluate((k) => { const v = localStorage.getItem(k); return v ? JSON.parse(v).status : null; }, KEY);
  const fits = () => card.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  let before;

  // First visit: offer, no automatic start on /login
  const anon = await browser.newPage();
  await anon.goto(admin + "/login");
  await anon.waitForTimeout(600);
  check(await anon.locator("[data-tour-card]").count() === 0, "no offer on login page");
  await anon.close();

  await page.goto(admin + "/");
  await card.waitFor();
  await page.waitForLoadState("networkidle");
  before = await counts(); // the app may create its own default quiz on first load; the tour must add nothing
  check(await page.getByRole("dialog", { name: "Bienvenue sur POAPO !" }).count() === 1, "welcome offer is a labelled dialog");
  check(await card.evaluate((el) => el === document.activeElement), "initial focus in card");
  check(await page.evaluate(() => document.getElementById("root").inert), "app behind overlay is inert");
  await shot("offer-1440");

  // Skip -> persisted, no relaunch after reload
  await page.getByRole("button", { name: "Passer la visite" }).click();
  await card.waitFor({ state: "detached" });
  check(await status() === "dismissed", "dismissal persisted");
  check(await page.evaluate(() => !document.getElementById("root").inert), "app interactive after close");
  await page.reload();
  await page.waitForTimeout(700);
  check(await card.count() === 0, "no relaunch after reload when dismissed");

  // Relaunch from /help, six steps
  await page.goto(admin + "/help");
  const restart = page.getByRole("button", { name: "Relancer la visite guidée" });
  await restart.click();
  await card.waitFor();
  check(await card.getByText("Étape 1 sur 6").count() === 1, "progress step 1/6");
  check(await page.getByRole("button", { name: "Précédent" }).count() === 0, "no previous on step 1");
  const expected = [["Accueil", "anchored"], ["Mes produits", "anchored"], ["Mes expériences", "anchored"], ["Éditeur de questions", "informative"], ["Publication", "informative"], ["Résultats", "anchored"]];
  for (const [i, [title, mode]] of expected.entries()) {
    await card.getByRole("heading", { name: title }).waitFor();
    check(await card.getAttribute("data-tour-mode") === mode, `step ${i + 1} mode ${mode}`);
    check(await fits(), `step ${i + 1} card in viewport`);
    if (mode === "anchored") check(await page.locator(".tour-spot").count() === 1, `step ${i + 1} highlight`);
    if (i === 0) await shot("step1-1440");
    if (i === 3) await shot("step4-info-1440");
    if (i === 5) await shot("step6-1440");
    if (i < 5) await page.getByRole("button", { name: "Suivant" }).click();
  }
  check(new URL(page.url()).pathname === "/help", "tour does not navigate");
  await page.getByRole("button", { name: "Précédent" }).click();
  await card.getByRole("heading", { name: "Publication" }).waitFor();
  check(true, "previous works");
  await page.getByRole("button", { name: "Suivant" }).click();
  await page.getByRole("button", { name: "Terminer" }).click();
  await card.waitFor({ state: "detached" });
  check(await status() === "completed", "completion persisted");
  check(await page.evaluate(() => document.activeElement?.hasAttribute("data-tour-restart")), "focus returns to trigger");
  await page.reload();
  await page.waitForTimeout(700);
  check(await card.count() === 0, "no relaunch after completion");

  // Keyboard: Tab trap, Escape, focus return
  await page.getByRole("button", { name: "Relancer la visite guidée" }).focus();
  await page.keyboard.press("Enter");
  await card.waitFor();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    check(await card.evaluate((el) => el.contains(document.activeElement)), "Tab stays in card");
  }
  await page.keyboard.press("Escape");
  await card.waitFor({ state: "detached" });
  check(await status() === "dismissed", "Escape quits");
  check(await page.evaluate(() => document.activeElement?.hasAttribute("data-tour-restart")), "Escape returns focus to trigger");

  // Missing target: informative fallback
  await page.getByRole("button", { name: "Relancer la visite guidée" }).click();
  await card.waitFor();
  await page.evaluate(() => document.querySelector('[data-tour="nav-home"]').removeAttribute("data-tour"));
  await page.getByRole("button", { name: "Suivant" }).click();
  await page.getByRole("button", { name: "Précédent" }).click();
  await card.getByRole("heading", { name: "Accueil" }).waitFor();
  await page.waitForTimeout(400);
  check(await card.getAttribute("data-tour-mode") === "informative", "missing target -> centered informative card");
  check(await fits(), "informative card visible");
  await page.keyboard.press("Escape");

  // Persisted state cleared -> offered again
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.goto(admin + "/catalog");
  await card.waitFor();
  check(await card.getByRole("heading", { name: "Bienvenue sur POAPO !" }).count() === 1, "offer returns after local data cleared");
  await page.getByRole("button", { name: "Commencer la visite" }).click();
  await card.getByText("Étape 1 sur 6").waitFor();
  await page.keyboard.press("Escape");

  // Not offered inside editors
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.goto(admin + "/experiences/new");
  await page.waitForTimeout(800);
  check(await card.count() === 0, "no offer on experience routes");
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ status: "dismissed" })), KEY);

  // Responsive
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(admin + "/help");
    await page.getByRole("button", { name: "Relancer la visite guidée" }).click();
    for (let i = 0; i < 6; i++) {
      await card.getByText(`Étape ${i + 1} sur 6`).waitFor();
      await page.waitForTimeout(150);
      check(await fits(), `card in viewport step ${i + 1} @${width}`);
      check(await noOverflow(), `no overflow step ${i + 1} @${width}`);
      if (i === 0 || i === 4) await shot(`step${i + 1}-${width}`);
      if (i < 5) await page.getByRole("button", { name: "Suivant" }).click();
    }
    await page.keyboard.press("Escape");
  }
  // Resize while open
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Relancer la visite guidée" }).click();
  await card.waitFor();
  await page.setViewportSize({ width: 375, height: 700 });
  await page.waitForTimeout(300);
  check(await fits(), "card visible after resize");
  await page.keyboard.press("Escape");

  // No side effects, no regressions
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const route of ["/", "/catalog", "/quizzes", "/campaigns", "/analytics", "/settings", "/help"]) {
    await page.goto(admin + route);
    await page.waitForLoadState("networkidle");
    check(new URL(page.url()).pathname === route, `route ${route} not redirected`);
    check(await card.count() === 0, `no offer on ${route} once dismissed`);
  }
  const after = await counts();
  check(JSON.stringify(before) === JSON.stringify(after), "no quiz or campaign created");
  check(errors.length === 0, errors.join("\n"));
  console.log(`PASS: ${assertions} browser assertions; screenshots: ${output || "not requested"}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  stack?.stop();
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});
