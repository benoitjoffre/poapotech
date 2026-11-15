// Fiches produit du widget (mobile) : libellés lisibles, aucune donnée interne, vouvoiement, états particuliers.
// Pile isolée (API, admin, widget), PostgreSQL local, service Python réel. Comptes et catalogues de test créés puis supprimés.
// Lancer : POAPO_PLAYWRIGHT_MODULE=<chemin de playwright> node tests/widgetPresentation.browser.cjs
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { resolveStack } = require("./support/isolatedStack.cjs");

const prisma = new PrismaClient();
const shots = process.env.POAPO_SHOTS_DIR || path.resolve(__dirname, "screenshots");
fs.mkdirSync(shots, { recursive: true });
const tenants = [];
let stack, browser, checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const FORBIDDEN = /_|REF-|SKU|EAN|376\d{10}|\{|\[|attribute|undefined|null|\bta préférence\b|\btes réponses\b|Ton profil|reponses/;

// Catalogues de test : colonnes utiles + champs internes (EAN, SKU, référence, lot, JSON).
const SECTORS = {
  cafe: {
    name: "Cafés", industry: "Café", labels: { origine: "Pays d'origine", torrefaction: "Torréfaction", poids: "Poids (g)" },
    axes: [{ key: "acidite", label: "Acidité", lowLabel: "Rond", highLabel: "Vif" }],
    products: Array.from({ length: 12 }, (_, i) => ({
      name: `Café ${["Éthiopie", "Colombie", "Brésil"][i % 3]} ${i + 1}`, price: 8 + i,
      attributes: { origine: ["Éthiopie", "Colombie", "Brésil"][i % 3], torrefaction: ["Légère", "Moyenne", "Foncée"][i % 3], poids: [250, 500, 1000][i % 3], acidite: (i % 10) / 10,
        ean: `37600${String(10000000 + i)}`, sku: `SKU-${i}`, reference_interne: `REF-${2000 + i}`, lot: `L-${i}`, stockage: { entrepot: "A" } },
    })),
    choice: { criterion: "torrefaction", values: ["Légère", "Moyenne", "Foncée"], text: "Côté torréfaction, qu'est-ce qui vous attire le plus ?" },
    extra: { criterion: "origine" }, expect: ["Torréfaction", "Pays d'origine"],
  },
  mode: {
    name: "Vêtements", industry: "Mode", labels: { categorie: "Catégorie", matiere: "Matière", couleur: "Couleur" },
    axes: [],
    products: Array.from({ length: 12 }, (_, i) => ({
      name: `${["Robe", "Veste", "Pull"][i % 3]} ${i + 1}`, price: 30 + i * 7,
      attributes: { categorie: ["Robe", "Veste", "Pull"][i % 3], matiere: ["Lin", "Laine", "Coton"][i % 3], couleur: ["Noir", "Beige", "Vert", "Bleu marine"][i % 4],
        sku: `SKU-M${i}`, gtin: `0${7612345678900 + i}`, reference_fournisseur: `F-${i}` },
    })),
    choice: { criterion: "categorie", values: ["Robe", "Veste", "Pull"], text: "Côté catégorie, qu'est-ce qui vous attire le plus ?" },
    extra: { criterion: "matiere" }, expect: ["Catégorie", "Matière"],
  },
};

async function setupQuiz(sectorKey, { withLabels, strictCap }) {
  const s = SECTORS[sectorKey];
  const id = `widget-${sectorKey}-${randomUUID().slice(0, 8)}`;
  tenants.push(id);
  await prisma.tenant.create({ data: { id, email: `${id}@example.test`, name: `Boutique ${s.name}`, industry: s.industry } });
  await prisma.subscription.create({ data: { tenantId: id, plan: "BUSINESS", source: "LEGACY" } });
  const catalog = await prisma.catalog.create({ data: { tenantId: id, name: s.name, isDefault: true } });
  await prisma.product.createMany({ data: s.products.map((p) => ({ tenantId: id, catalogId: catalog.id, name: p.name, price: p.price, tags: [], attributes: p.attributes, embeddingStatus: "READY" })) });
  // Nouveau catalogue : en-têtes d'origine connus (résultat d'import) ; ancien catalogue : aucun.
  if (withLabels) await prisma.importBatch.create({ data: { tenantId: id, catalogId: catalog.id, key: "k", fingerprint: "f", status: "completed", result: { created: s.products.length, labels: s.labels } } });
  const quiz = await prisma.quiz.create({ data: { tenantId: id, catalogId: catalog.id, name: "Quiz", quizTitle: "Trouvez votre bonheur", ctaText: "Voir", active: true, axes: s.axes } });
  const cat = (criterion, value) => ({ v: 1, effects: [{ type: "category", criterion: `attribute.${criterion}`, mode: "soft", values: [value] }] });
  const none = (criterion) => ({ v: 1, effects: [{ type: "none", criterion: `attribute.${criterion}` }] });
  await prisma.question.create({ data: { tenantId: id, quizId: quiz.id, text: s.choice.text, order: 0, answers: { create: [
    ...s.choice.values.map((value, i) => ({ text: value, order: i, impacts: {}, effects: cat(s.choice.criterion, value) })),
    { text: "Sans préférence", order: 9, impacts: {}, effects: none(s.choice.criterion) },
  ] } } });
  await prisma.question.create({ data: { tenantId: id, quizId: quiz.id, text: "Une préférence de plus ?", order: 1, answers: { create: [
    { text: String(s.products[0].attributes[s.extra.criterion]), order: 0, impacts: {}, effects: cat(s.extra.criterion, String(s.products[0].attributes[s.extra.criterion])) },
    { text: "Sans préférence", order: 1, impacts: {}, effects: none(s.extra.criterion) },
  ] } } });
  if (s.axes.length) await prisma.question.create({ data: { tenantId: id, quizId: quiz.id, text: "Plutôt rond ou vif ?", order: 2, answers: { create: [
    { text: "Rond", order: 0, impacts: { acidite: -0.25 } }, { text: "Vif", order: 1, impacts: { acidite: 0.25 } },
  ] } } });
  if (strictCap !== undefined) await prisma.question.create({ data: { tenantId: id, quizId: quiz.id, text: "Quel budget maximum ?", order: 3, answers: { create: [
    { text: `Jusqu'à ${strictCap} €`, order: 0, impacts: {}, effects: { v: 1, effects: [{ type: "range", criterion: "price", mode: "strict", max: strictCap }] } },
    { text: "Pas de limite de budget", order: 1, impacts: {}, effects: { v: 1, effects: [{ type: "none", criterion: "price" }] } },
  ] } } });
  return { tenantId: id, quiz };
}

async function answerAll(page, choose, count) {
  await page.locator("button.submit").first().click();
  for (let i = 0; i < count; i++) {
    // La question suivante est pré-affichée hors écran (réponses désactivées) : ne garder que les réponses actives.
    const options = page.locator("label.option").filter({ has: page.locator("input:not([disabled])") });
    await options.first().waitFor();
    const texts = await options.allInnerTexts();
    await options.nth(Math.max(0, choose(texts))).click();
    // Attendre l'affichage de la question suivante avant de lire ses réponses.
    if (i < count - 1) await page.waitForFunction((previous) => JSON.stringify([...document.querySelectorAll("label.option")].filter((e) => !e.querySelector("input[disabled]")).map((e) => e.innerText)) !== previous, JSON.stringify(texts), { timeout: 15000 });
  }
  const submit = page.locator("button.submit[type=submit]");
  if (await submit.isVisible().catch(() => false)) {
    ok((await submit.innerText()).includes("Envoyer mes réponses"), "bouton « Envoyer mes réponses » accentué");
    await submit.click();
  }
  return Promise.race([
    page.locator(".result").waitFor({ timeout: 60000 }).then(() => "result"),
    page.locator(".form-error").waitFor({ timeout: 60000 }).then(() => "error"),
  ]);
}

async function visit(sectorKey, options, choose, label) {
  const { tenantId, quiz } = await setupQuiz(sectorKey, options);
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await page.goto(`${stack.widget}/?clientId=${tenantId}&quizId=${quiz.id}`);
  await page.locator("button.submit").first().waitFor({ timeout: 30000 });
  await page.getByText(/quelques questions/).first().waitFor({ timeout: 30000 });
  const intro = await page.locator("body").innerText();
  ok(/Répondez à quelques questions et découvrez/.test(intro), `${label} : introduction au vouvoiement (${intro.slice(0, 200).replace(/\n/g, " | ")})`);
  const outcome = await answerAll(page, choose, await prisma.question.count({ where: { quizId: quiz.id, active: true } }));
  const body = await page.locator("body").innerText();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  ok(!overflow, `${label} : aucun débordement horizontal sur mobile`);
  await page.screenshot({ path: path.join(shots, `w-${label}.png`), fullPage: true });
  return { page, outcome, body, tenantId };
}

(async () => {
  stack = await resolveStack();
  browser = await chromium.launch({ headless: true });

  for (const [sectorKey, withLabels] of [["cafe", true], ["cafe", false], ["mode", true], ["mode", false]]) {
    const s = SECTORS[sectorKey];
    const label = `${sectorKey}-${withLabels ? "nouveau" : "ancien"}`;
    const { page, outcome, body } = await visit(sectorKey, { withLabels }, (texts) => 0, label);
    ok(outcome === "result", `${label} : recommandation servie`);
    const chips = await page.getByTestId("result-characteristics").innerText();
    const headings = chips.split("\n").map((l) => l.trim()).filter(Boolean);
    const expected = withLabels ? s.expect : s.expect.map((l) => l.normalize("NFD").replace(/[̀-ͯ]/g, "").replace("Pays d'origine", "Origine"));
    for (const name of expected) ok(headings.some((h) => h.toLowerCase() === name.toLowerCase()), `${label} : caractéristique « ${name} » affichée (${headings.join(" | ")})`);
    ok(!FORBIDDEN.test(chips), `${label} : aucune clé technique ni donnée interne dans la fiche (${chips.replace(/\n/g, " | ")})`);
    ok(!/REF-|SKU|F-\d|L-\d|37600|entrepot/.test(body), `${label} : aucune référence interne sur la page`);
    ok(!/\bta préférence\b|\btes réponses\b|Ton profil/.test(body), `${label} : vouvoiement dans le résultat`);
    if (sectorKey === "cafe") ok(/Votre profil/.test(body), "profil au vouvoiement");
    await page.close();
  }

  // Un seul produit conforme au plafond strict ; aucun produit ; produit sans caractéristique présentable.
  const one = await visit("mode", { withLabels: true, strictCap: 30 }, (texts) => (texts.some((t) => /Jusqu'à 30/.test(t)) ? texts.findIndex((t) => /Jusqu'à 30/.test(t)) : texts.findIndex((t) => /Sans préférence/.test(t))), "mode-un-seul");
  ok(one.outcome === "result" && /Un seul produit correspond exactement à vos critères/.test(one.body), "un seul produit : message clair");
  await one.page.close();
  const none = await visit("mode", { withLabels: true, strictCap: 5 }, (texts) => (texts.some((t) => /Jusqu'à 5 €/.test(t)) ? texts.findIndex((t) => /Jusqu'à 5 €/.test(t)) : texts.findIndex((t) => /Sans préférence/.test(t))), "mode-aucun");
  ok(none.outcome === "error" && /Aucun produit ne correspond à tous vos critères/.test(none.body), "aucun produit : message clair");
  ok(!/price|range|attribute|no_match|422/.test(none.body), "aucun détail technique (aucun produit)");
  await none.page.close();
  const bare = await visit("mode", { withLabels: true }, (texts) => texts.findIndex((t) => /Sans préférence/.test(t)), "mode-sans-preference");
  ok(bare.outcome === "result", "réponses neutres : recommandation servie");
  ok(!/Envoyer mes reponses|Merci de repondre/.test(bare.body), "accents corrigés");
  await bare.page.close();

  console.log(`widget presentation OK (${checks} checks)`);
  await browser.close();
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } }).catch(() => {});
  await browser?.close().catch(() => {}); stack?.stop(); await prisma.$disconnect(); setTimeout(() => process.exit(), 200);
});
