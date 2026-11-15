// Parcours complet du générateur avancé, de l'import CSV au widget mobile, sur une pile ISOLÉE (API, admin, widget), Auth0 simulé,
// PostgreSQL local et service Python RÉEL (vrai modèle d'embeddings, AI_SERVICE_URL de poapoback/.env). Compte de test créé puis supprimé :
// aucun compte ni catalogue de production. Lancer : POAPO_PLAYWRIGHT_MODULE=<chemin de playwright> node tests/universalQuiz.browser.cjs
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../poapoback/.env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const { chromium } = require(process.env.POAPO_PLAYWRIGHT_MODULE || "playwright");
const { startMockAuth0 } = require("./support/mockAuth0.cjs");
const { startIsolatedStack } = require("./support/isolatedStack.cjs");

const run = randomUUID().slice(0, 8);
const audience = "https://api.poapo.test";
const shots = process.env.POAPO_SHOTS_DIR || path.resolve(__dirname, "screenshots");
fs.mkdirSync(shots, { recursive: true });
const users = { lea: { sub: `auth0|uq-${run}`, email: `universal-${run}@example.test`, verified: true } };
const prisma = new PrismaClient();
let idp, stack, browser, steps = 0;
const ok = (c, m) => { assert.ok(c, m); steps++; };
const shot = (page, name) => page.screenshot({ path: path.join(shots, `u-${name}.png`), fullPage: true });
const timings = [];

// Catalogue de test reproductible (aucune donnée réelle) : 48 parfums, en-têtes avec accents et espaces.
function csv() {
  const families = ["Floral", "Boisé", "Oriental", "Frais", "Gourmand", "Fougère"];
  const genres = ["Femme", "Homme", "Mixte"];
  const brands = ["Maison Aube", "Atelier Nord", "Essences Sud", "Orée"];
  const lines = ["Nom;Marque;Prix;Famille olfactive;Genre;Fraîcheur;Intensité;Référence"];
  for (let i = 0; i < 48; i++) {
    const family = families[i % 6], genre = genres[(i * 7 + Math.floor(i / 6)) % 3];
    const price = 39 + ((i * 29) % 140) + (i % 4 === 0 ? 0.9 : 0);
    const fresh = (family === "Frais" ? 0.8 : family === "Floral" ? 0.55 : 0.3) + ((i * 13) % 20) / 100;
    lines.push([`Parfum ${family} ${i + 1}`, brands[(i * 3) % 4], `${price.toFixed(2).replace(".", ",")} €`, family, genre, String(Math.min(1, fresh)).replace(".", ","), String(((i * 37) % 100) / 100).replace(".", ","), `REF-${1000 + i}`].join(";"));
  }
  return lines.join("\n") + "\n";
}

async function waitEmbeddings(tenantId, expected) {
  const deadline = Date.now() + 240000;
  for (;;) {
    const rows = await prisma.product.groupBy({ by: ["embeddingStatus"], where: { tenantId }, _count: true });
    const ready = rows.find((r) => r.embeddingStatus === "READY")?._count ?? 0;
    if (ready >= expected) return;
    assert.ok(Date.now() < deadline, `embeddings non prêts : ${JSON.stringify(rows)}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// Crée un quiz avancé par l'interface (budget strict ou non) et le publie ; renvoie le quiz.
async function createAndPublish(page, tenant, { strict, edit }) {
  await page.goto(stack.admin + "/experiences/new");
  await page.getByRole("button", { name: /Analyser mon catalogue/ }).waitFor();
  const advanced = page.getByLabel(/Questions avancées/);
  ok(await advanced.isChecked(), "questions avancées proposées et cochées (interrupteur actif pour ce compte)");
  if (strict) await page.getByLabel(/Budget maximum strict/).check();
  await page.getByRole("button", { name: /Analyser mon catalogue/ }).click();
  await page.getByTestId("express-criteria-summary").waitFor({ timeout: 60000 });
  const summary = await page.getByTestId("express-criteria-summary").innerText();
  ok(/Famille olfactive/.test(summary) && /Utilisés dans le quiz/.test(summary), "critères utilisés listés avec l'en-tête d'origine (accents conservés)");
  ok(!/attribute\.|CATEGORICAL|RANGE|effects|impacts/.test(await page.locator("body").innerText()), "aucun terme technique à l'écran (critères)");
  ok(/Référence/.test(summary) && /Non utilisés/.test(summary), "la référence interne est écartée et expliquée");
  await shot(page, `${strict ? "strict" : "souple"}-1-criteres`);
  await page.locator(".xw-footer .btn-primary").click(); // → caractéristiques
  await page.getByTestId("express-features").waitFor({ timeout: 60000 });
  await page.locator(".xw-footer .btn-primary").click(); // → questions
  await page.getByRole("heading", { name: /Questions et réponses/ }).waitFor();
  const info = await page.locator("[data-testid^=question-info-]").allInnerTexts();
  ok(info.length >= 4 && info.every((t) => /Critère :/.test(t)), "chaque question affiche son critère");
  ok(info.some((t) => /Budget/.test(t)) && info.some((t) => /Choix parmi vos produits/.test(t)), "questions de choix et de budget");
  if (strict) ok(info.some((t) => /Plafond strict/.test(t)), "plafond strict signalé dans l'éditeur");
  const bodyText = await page.locator("body").innerText();
  const technical = bodyText.match(/attribute\.|effects|impacts?\b|price ≤|CATEGORICAL|RANGE/i);
  ok(!technical, "aucune structure technique dans l'éditeur de questions" + (technical ? ` (trouvé : « ${technical[0]} »)` : ""));
  ok(/Ne change pas le classement/.test(bodyText) && /Favorise les produits|Écarte tous les produits/.test(bodyText), "effets attendus décrits en une phrase");
  if (edit) {
    // Modification : reformuler une question, retirer une réponse, ajouter une suggestion à valider.
    const first = page.getByLabel("Texte de la question 1");
    await first.fill("Quelle famille vous fait envie ?");
    const removable = page.getByRole("button", { name: "Retirer" }).first();
    if (await removable.isEnabled()) await removable.click();
    // Retirer la réponse « Sans préférence » de la question 2 : avertissement clair, rien d'empêché.
    const q2 = page.locator("fieldset").nth(1);
    const neutralRow = q2.locator("div", { has: page.locator("input[value='Sans préférence']") }).last();
    const neutralInputs = await q2.locator("input.field-input").evaluateAll((els) => els.map((e) => e.value));
    const neutralIndex = neutralInputs.indexOf("Sans préférence");
    if (neutralIndex > 0) {
      await q2.getByRole("button", { name: "Retirer" }).nth(neutralIndex - 1).click();
      await page.getByTestId("question-no-neutral-1").waitFor();
      ok(/plus de réponse « Sans préférence »/.test(await page.getByTestId("question-no-neutral-1").innerText()), "avertissement quand la réponse « Sans préférence » est retirée");
    }
    void neutralRow;
    if (await page.getByTestId("express-suggestions").count()) {
      const add = page.getByTestId("express-suggestions").getByRole("button", { name: "Ajouter au quiz" }).first();
      if (await add.count()) { await add.click(); ok(true, "suggestion à valider ajoutée par le commerçant"); }
    }
  }
  await shot(page, `${strict ? "strict" : "souple"}-2-questions`);
  await page.locator(".xw-footer .btn-primary").click(); // → aperçu
  await page.getByRole("heading", { name: /Prévisualisation/ }).waitFor({ timeout: 60000 });
  const fieldsets = await page.locator("fieldset").all();
  for (const f of fieldsets) await f.locator("input[type=radio]").first().check();
  const t0 = Date.now();
  await page.getByRole("button", { name: "Voir les recommandations" }).click();
  await page.locator("[role=status] ol li").first().waitFor({ timeout: 60000 });
  timings.push(["aperçu (moteur réel)", Date.now() - t0]);
  ok((await page.locator("[role=status] ol li").count()) >= 1, "recommandations d'aperçu affichées par le vrai moteur");
  await shot(page, `${strict ? "strict" : "souple"}-3-apercu`);
  await page.locator(".xw-footer .btn-primary").click(); // → enregistrer
  await page.getByRole("heading", { name: /Enregistrer en brouillon/ }).waitFor();
  const ack = page.getByLabel(/Je comprends que les données/);
  if (await ack.count()) await ack.check();
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await page.waitForURL(/\/experiences\/(?!new)[^/]+\/(edit|setup)/, { timeout: 60000 });
  const quiz = await prisma.quiz.findFirstOrThrow({ where: { tenantId: tenant.id, NOT: { id: { startsWith: "default_" } } }, orderBy: { createdAt: "desc" } });
  ok(quiz.active === false, "brouillon enregistré inactif");
  const stored = await prisma.answer.findMany({ where: { question: { quizId: quiz.id } }, select: { effects: true } });
  ok(stored.some((a) => a.effects !== null), "effets persistés");
  // Reprise : réouverture de l'éditeur, le brouillon est intact.
  await page.goto(`${stack.admin}/experiences/${quiz.id}/edit?section=questions`);
  await page.getByRole("tab", { name: "Questions" }).waitFor({ timeout: 60000 });
  await page.getByRole("tab", { name: "Questions" }).click();
  await page.waitForLoadState("networkidle");
  if (edit) {
    ok(!!(await prisma.question.findFirst({ where: { quizId: quiz.id, text: "Quelle famille vous fait envie ?" } })), "modification de la question enregistrée dans le brouillon");
    const values = await page.locator("input, textarea").evaluateAll((els) => els.map((el) => el.value));
    const editorText = await page.locator("body").innerText();
    ok(values.includes("Quelle famille vous fait envie ?") || editorText.includes("Quelle famille vous fait envie ?"), "brouillon repris dans l'éditeur avec la question modifiée — page : " + editorText.slice(0, 600).replace(/\s+/g, " ") + " | champs : " + JSON.stringify(values.slice(0, 8)));
  }
  await page.goto(`${stack.admin}/experiences/${quiz.id}/edit?section=publication`);
  await page.getByRole("heading", { name: "Publier mon expérience" }).waitFor({ timeout: 60000 });
  const publish = page.getByRole("button", { name: "Publier et rendre accessible" });
  await publish.waitFor();
  await publish.click();
  await page.getByRole("heading", { name: "Expérience publiée" }).waitFor({ timeout: 60000 });
  ok((await prisma.quiz.findUniqueOrThrow({ where: { id: quiz.id } })).active === true, "publication dans l'environnement de test");
  return quiz;
}

// Parcours visiteur (mobile) : choisit la réponse `pick(questionIndex, answers)` à chaque question.
async function visit(browser, tenant, quiz, pick) {
  const w = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await w.goto(`${stack.widget}/?clientId=${tenant.id}&quizId=${quiz.id}`);
  await w.locator("button.submit").first().click();
  const questions = await prisma.question.findMany({ where: { quizId: quiz.id, active: true }, orderBy: { order: "asc" }, include: { answers: { where: { active: true }, orderBy: { order: "asc" } } } });
  for (let i = 0; i < questions.length; i++) {
    const options = w.locator("label.option");
    await options.first().waitFor();
    const answer = pick(i, questions[i].answers, questions[i]);
    await options.filter({ hasText: answer.text }).first().click();
  }
  const submit = w.locator("button.submit[type=submit]");
  const t0 = Date.now();
  if (await submit.isVisible().catch(() => false)) await submit.click();
  const outcome = await Promise.race([
    w.locator(".result").waitFor({ timeout: 60000 }).then(() => "result"),
    w.locator(".form-error").waitFor({ timeout: 60000 }).then(() => "error"),
  ]);
  timings.push(["soumission visiteur (widget → moteur réel → produit)", Date.now() - t0]);
  const overflow = await w.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  const data = { outcome, overflow, page: w };
  if (outcome === "result") {
    data.name = (await w.locator(".result-hero-name").innerText()).trim();
    const card = await w.locator(".result").innerText();
    ok(!/_|REF-\d|SKU|\bta préférence\b|Ton profil/.test(card), "fiche produit sans clé technique, référence interne ni tutoiement");
    const chips = await w.getByTestId("result-characteristics").innerText().catch(() => "");
    if (chips) ok(/Famille olfactive|Genre/i.test(chips), "caractéristiques avec les en-têtes d'origine (" + chips.replace(/\n/g, " | ") + ")");
  }
  else data.error = (await w.locator(".form-error").first().innerText()).trim();
  data.notice = await w.getByTestId("limited-results").innerText().catch(() => null);
  return data;
}

(async () => {
  idp = await startMockAuth0({ port: 5170, audience, users });
  Object.assign(process.env, {
    AUTH0_ISSUER: idp.issuer, AUTH0_AUDIENCE: audience, EXPRESS_UNIVERSAL_QUESTIONS: "1",
    VITE_AUTH0_DOMAIN: "http://localhost:5170", VITE_AUTH0_CLIENT_ID: "poapo-spa-test", VITE_AUTH0_AUDIENCE: audience,
  });
  stack = await startIsolatedStack();
  browser = await chromium.launch({ headless: true });
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const badResponses = [];
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) badResponses.push(`${r.status()} ${r.url().replace(stack.api, "")}`); });

  // 1. Compte de test.
  await page.goto(stack.admin + "/login");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.locator("#as-lea").click();
  await page.waitForURL("**/onboarding");
  await page.getByLabel("Nom de la boutique").fill("Maison Test Universel");
  await page.getByLabel("Secteur d'activité").fill("Parfumerie");
  await page.getByRole("button", { name: "Créer ma boutique" }).click();
  await page.getByRole("button", { name: "Passer la visite" }).click();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { email: users.lea.email } });
  // Compte de test hors quotas (deux expériences publiées dans ce test).
  await prisma.subscription.update({ where: { tenantId: tenant.id }, data: { plan: "BUSINESS" } });

  // 2. Import CSV par l'interface : suggestions d'informations supplémentaires, confirmation, aperçu, import.
  const file = path.join(os.tmpdir(), `poapo-universal-${run}.csv`);
  fs.writeFileSync(file, csv());
  await page.goto(stack.admin + "/catalog/import");
  await page.locator("input[type=file]").setInputFiles(file);
  await page.getByRole("button", { name: "Analyser le fichier" }).click();
  await page.getByRole("button", { name: /Associer les colonnes/ }).click();
  const importSummary = page.getByTestId("import-columns-summary");
  await importSummary.waitFor();
  ok(/informations? supplémentaires? proposées?/.test(await importSummary.innerText()), "informations supplémentaires proposées, à confirmer");
  ok((await prisma.product.count({ where: { tenantId: tenant.id } })) === 0, "rien n'est enregistré avant confirmation");
  await shot(page, "0-import-mapping");
  // La référence interne n'est pas recommandée : la colonne reste ignorée tant que le commerçant ne la conserve pas explicitement (ce qu'on fait ici pour vérifier qu'elle est écartée du quiz).
  ok(/référence ou à un code|Référence ou code/i.test(await page.locator("tr", { hasText: "Référence" }).innerText()), "colonne de référence signalée comme code");
  await page.locator("tr", { hasText: "Référence" }).getByRole("button", { name: "Conserver" }).click();
  await importSummary.getByRole("button", { name: /Conserver les \d+ colonnes recommandées/ }).click();
  await page.getByRole("button", { name: /Vérifier les données/ }).click();
  await page.getByTestId("import-columns-recap").waitFor();
  ok(/Famille olfactive/.test(await page.getByTestId("import-columns-recap").innerText()), "récapitulatif des colonnes avant import");
  await page.getByRole("button", { name: /Confirmer l'import de 48 produits/ }).click();
  await page.getByRole("heading", { name: "Import terminé" }).waitFor({ timeout: 60000 });
  const catalog = await prisma.catalog.findFirstOrThrow({ where: { tenantId: tenant.id } });
  const batch = await prisma.importBatch.findFirstOrThrow({ where: { tenantId: tenant.id, status: "completed" } });
  ok(batch.result.labels && batch.result.labels.famille_olfactive === "Famille olfactive", "en-têtes d'origine conservés (accents, espaces)");
  const sample = await prisma.product.findFirstOrThrow({ where: { tenantId: tenant.id, name: { startsWith: "Parfum Floral" } } });
  ok(sample.price !== null && sample.attributes.famille_olfactive === "Floral" && sample.attributes.genre, "prix « 49,00 € » lu, informations supplémentaires enregistrées");
  await waitEmbeddings(tenant.id, 48);
  ok(true, "embeddings calculés par le vrai modèle (48/48)");

  // 3. Quiz avancé souple (création, modification, reprise, aperçu, publication).
  const soft = await createAndPublish(page, tenant, { strict: false, edit: true });
  const questions = await prisma.question.findMany({ where: { quizId: soft.id, active: true }, orderBy: { order: "asc" }, include: { answers: { where: { active: true }, orderBy: { order: "asc" } } } });
  const isNeutral = (a) => /^(Sans préférence|Pas de budget précis|Peu importe)/.test(a.text);
  const familyQuestion = questions.findIndex((q) => /famille/i.test(q.text));
  ok(familyQuestion >= 0, "question sur la famille présente");
  const byName = async (name) => prisma.product.findFirstOrThrow({ where: { tenantId: tenant.id, name } });

  // 4. Widget mobile : « Sans préférence » partout, puis une famille précise.
  const neutralRun = await visit(browser, tenant, soft, (i, answers) => answers.find(isNeutral) ?? answers[0]);
  ok(neutralRun.outcome === "result" && !neutralRun.overflow, "widget mobile : parcours neutre abouti, sans débordement horizontal");
  await shot(neutralRun.page, "4-widget-neutre");
  await neutralRun.page.close();
  const familyOf = async (name) => (await byName(name)).attributes.famille_olfactive;
  let hits = 0;
  const tried = [];
  for (const family of ["Frais", "Oriental", "Gourmand"]) {
    // Une question sans « Sans préférence » (retirée par le commerçant) impose un choix : on note la préférence exprimée.
    const forced = [];
    const r = await visit(browser, tenant, soft, (i, answers, question) => {
      if (i === familyQuestion) return answers.find((a) => a.text === family) ?? answers[0];
      const neutral = answers.find(isNeutral);
      if (!neutral) forced.push(answers[0].text);
      return neutral ?? answers[0];
    });
    ok(r.outcome === "result", `réponse « ${family} » : une recommandation est servie`);
    const product = await byName(r.name);
    const got = product.attributes.famille_olfactive;
    tried.push(`${family}→${got}${forced.length ? ` (+ ${forced.join(", ")} → ${product.attributes.genre})` : ""}`);
    if (got === family || forced.includes(product.attributes.genre)) hits++;
    await r.page.close();
  }
  ok(hits >= 2, `les réponses catégorielles influencent réellement le produit recommandé (au moins une préférence exprimée respectée) (${tried.join(", ")})`);
  // Préférence de budget souple : les produits hors budget ne sont pas exclus (une recommandation est toujours servie).
  const budgetIndex = questions.findIndex((q) => /budget/i.test(q.text));
  const cheap = await visit(browser, tenant, soft, (i, answers) => (i === budgetIndex ? answers[0] : answers.find(isNeutral) ?? answers[0]));
  ok(cheap.outcome === "result", "budget souple : recommandation servie");
  await cheap.page.close();
  ok(await prisma.quizSession.count({ where: { tenantId: tenant.id, quizId: soft.id } }) === 5, "5 sessions enregistrées pour le quiz souple");

  // 5. Quiz avec plafond strict : jamais dépassé, aucun résultat, un ou deux résultats.
  const strict = await createAndPublish(page, tenant, { strict: true, edit: false });
  const sq = await prisma.question.findMany({ where: { quizId: strict.id, active: true }, orderBy: { order: "asc" }, include: { answers: { where: { active: true }, orderBy: { order: "asc" } } } });
  const sBudget = sq.findIndex((q) => /budget/i.test(q.text));
  ok(sBudget >= 0, "question de budget strict présente");
  const capOf = (a) => a.effects?.effects?.find((e) => e.type === "range")?.max;
  const capped = sq[sBudget].answers.filter((a) => capOf(a) !== undefined);
  for (const answer of capped) {
    const r = await visit(browser, tenant, strict, (i, answers) => (i === sBudget ? answers.find((a) => a.id === answer.id) : answers.find(isNeutral) ?? answers[0]));
    ok(r.outcome === "result", `plafond ${capOf(answer)} € : résultat servi`);
    const product = await byName(r.name);
    ok(product.price <= capOf(answer), `plafond strict respecté : ${r.name} à ${product.price} € ≤ ${capOf(answer)} €`);
    await r.page.close();
  }
  // Aucun produit : état explicite, message compréhensible, rien de technique.
  const tight = capped[0];
  await prisma.answer.update({ where: { id: tight.id }, data: { effects: { v: 1, effects: [{ type: "range", criterion: "price", mode: "strict", max: 1 }] } } });
  const none = await visit(browser, tenant, strict, (i, answers) => (i === sBudget ? answers.find((a) => a.id === tight.id) : answers.find(isNeutral) ?? answers[0]));
  ok(none.outcome === "error" && /Aucun produit ne correspond à tous vos critères/.test(none.error), "aucun produit : message clair dans le widget mobile");
  ok(!/price|range|effects|attribute|422|no_match/.test(none.error), "aucun détail technique dans le message visiteur");
  await shot(none.page, "5-widget-aucun-produit");
  await none.page.close();
  // Deux produits seulement.
  const cheapest = await prisma.product.findMany({ where: { tenantId: tenant.id }, orderBy: { price: "asc" }, take: 2 });
  await prisma.answer.update({ where: { id: tight.id }, data: { effects: { v: 1, effects: [{ type: "range", criterion: "price", mode: "strict", max: cheapest[1].price }] } } });
  const two = await visit(browser, tenant, strict, (i, answers) => (i === sBudget ? answers.find((a) => a.id === tight.id) : answers.find(isNeutral) ?? answers[0]));
  ok(two.outcome === "result" && cheapest.some((p) => p.name === two.name), "deux produits conformes : l'un des deux est proposé");
  ok(two.notice && /Seulement 2 produits correspondent exactement/.test(two.notice), "le widget indique qu'il n'y a que deux produits conformes");
  await shot(two.page, "5-widget-deux-produits");
  await two.page.close();
  // Donnée peu fiable : la contrainte ne peut pas être garantie.
  await prisma.product.updateMany({ where: { tenantId: tenant.id, id: { in: (await prisma.product.findMany({ where: { tenantId: tenant.id }, take: 12, select: { id: true } })).map((p) => p.id) } }, data: { price: null } });
  const unreliable = await visit(browser, tenant, strict, (i, answers) => (i === sBudget ? answers.find((a) => a.id === tight.id) : answers.find(isNeutral) ?? answers[0]));
  ok(unreliable.outcome === "error" && /ne pouvons pas garantir/.test(unreliable.error), "prix incomplets : état « contrainte non garantie » compréhensible");
  ok(!/price|effects|attribute|422|constraints_unreliable/.test(unreliable.error), "aucun détail technique (contrainte non garantie)");
  await unreliable.page.close();

  const unexpected = badResponses.filter((c) => !/\/enrichment\/context/.test(c));
  ok(unexpected.length === 0, "aucune réponse d'erreur API inattendue côté admin : " + unexpected.join(" | "));
  ok(errors.length === 0, "aucune erreur JS côté admin : " + errors.join(" | "));
  console.log("latences mesurées (ms) :", JSON.stringify(timings));
  console.log(`universal browser OK (${steps} checks)`);
  await browser.close();
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await prisma.user.deleteMany({ where: { auth0Sub: { in: Object.values(users).map((u) => u.sub) } } }).catch(() => {});
  await prisma.tenant.deleteMany({ where: { email: { in: Object.values(users).map((u) => u.email) } } }).catch(() => {});
  await browser?.close().catch(() => {}); stack?.stop(); idp?.stop(); await prisma.$disconnect(); setTimeout(() => process.exit(), 200);
});
