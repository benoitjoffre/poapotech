import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import type { ExpressDraft, ExpressPreviewResponse, ExpressProposal } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import catalogsRouter from "../src/routes/catalogs";
import expressQuizRouter from "../src/routes/expressQuiz";
import quizzesRouter from "../src/routes/quizzes";
import { quizErrorHandler } from "../src/services/quizzes";
import { axialScore, semantic } from "./fixtures/fakeEngine";
import { perfumeSeeded } from "./fixtures/selectionFixtures";

// Opt-in : POAPO_TEST_UNIVERSAL_DB=1. Tenant isolé supprimé en fin de test ; moteur Python remplacé par un faux serveur aux règles vérifiées.
test("PostgreSQL : génération avancée → validation → aperçu → enregistrement inactif (jamais publié)", {
  skip: process.env.POAPO_TEST_UNIVERSAL_DB !== "1",
}, async () => {
  process.env.JWT_SECRET = "universal-db-only";
  process.env.EXPRESS_UNIVERSAL_QUESTIONS = "1";
  const tenantId = `universal-${randomUUID()}`;
  const aiCalls: Record<string, unknown>[] = [];
  const fakeAi = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", async () => {
      const body = JSON.parse(raw) as { tenantId: string; catalogId: string; profile: Record<string, number>; productIds?: string[]; topN?: number };
      aiCalls.push(body);
      const rows = (await prisma.product.findMany({ where: { tenantId: body.tenantId, catalogId: body.catalogId, active: true, ...(body.productIds && { id: { in: body.productIds } }) } })).sort((a, b) => a.id.localeCompare(b.id));
      if (!rows.length) { res.writeHead(404).end("{}"); return; }
      const topN = rows.map((p) => ({ id: p.id, score: 0.6 * semantic(p.id) + 0.4 * axialScore(body.profile, p.attributes) })).sort((a, b) => b.score - a.score).slice(0, body.topN ?? 1);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ productId: topN[0].id, score: topN[0].score, explanation: [], profileSummary: { axes: [] }, topN }));
    });
  });
  await new Promise<void>((resolve) => fakeAi.listen(0, "127.0.0.1", resolve));
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${(fakeAi.address() as { port: number }).port}`;
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api/catalogs", catalogsRouter);
  app.use("/api/express-quiz", expressQuizRouter);
  app.use("/api/quizzes", quizzesRouter);
  app.use(quizErrorHandler);
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const tenant = await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test`, industry: "Parfumerie" } });
    await prisma.subscription.create({ data: { tenantId, plan: "BUSINESS", source: "LEGACY" } });
    const token = jwt.sign({ tenantId, email: tenant.email }, process.env.JWT_SECRET!);
    const call = (path: string, method = "GET", body?: unknown) => fetch(base + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const catalogId = ((await (await call("/api/catalogs")).json()) as { id: string }[])[0].id;
    const catalog = perfumeSeeded(60, 5);
    await prisma.product.createMany({ data: catalog.map((p) => ({ tenantId, catalogId, name: p.id!, brand: p.brand ?? null, price: p.price ?? null, tags: [...(p.tags ?? [])], attributes: p.attributes as object, embeddingStatus: "READY" as const })) });
    const dbPrice = new Map((await prisma.product.findMany({ where: { tenantId }, select: { id: true, price: true } })).map((p) => [p.id, p.price!]));

    assert.deepEqual(await (await call("/api/express-quiz/capabilities")).json(), { universal: true });

    // Génération historique inchangée par défaut.
    const legacy = await (await call("/api/express-quiz/analyze", "POST", { catalogId })).json() as ExpressProposal;
    assert.notEqual(legacy.analysis.generator, "universal");

    // Génération avancée.
    const analyzed = await call("/api/express-quiz/analyze", "POST", { catalogId, generator: "universal" });
    assert.equal(analyzed.status, 200, await analyzed.clone().text());
    const proposal = await analyzed.json() as ExpressProposal;
    assert.equal(proposal.analysis.generator, "universal");
    const draft = proposal.draft!;
    assert.ok(draft.questions.some((q) => q.info?.kind === "choice") && draft.questions.some((q) => q.info?.kind === "budget"));
    const validated = await call("/api/express-quiz/validate", "POST", { catalogId, draft });
    assert.equal(validated.status, 200, await validated.clone().text());

    // Aperçu : préférence souple (toutes les premières réponses) puis tout neutre.
    const lastIndex = (q: ExpressDraft["questions"][number]) => q.answers.length - 1;
    aiCalls.length = 0;
    const first = await call("/api/express-quiz/preview", "POST", { catalogId, draft, answers: draft.questions.map(() => 0) });
    assert.equal(first.status, 200, await first.clone().text());
    const firstBody = await first.json() as ExpressPreviewResponse;
    assert.equal(firstBody.recommendations.length, 3);
    assert.ok(aiCalls.length >= 1);
    const neutral = await call("/api/express-quiz/preview", "POST", { catalogId, draft, answers: draft.questions.map(lastIndex) });
    assert.equal(neutral.status, 200, await neutral.clone().text());
    // Une réponse catégorielle influence réellement le classement : Top 3 différent de « tout neutre » pour au moins une réponse.
    const choiceIndex = draft.questions.findIndex((q) => q.info?.kind === "choice");
    const tops = new Set<string>();
    for (let a = 0; a < draft.questions[choiceIndex].answers.length; a++) {
      const picks = draft.questions.map(lastIndex);
      picks[choiceIndex] = a;
      const body = await (await call("/api/express-quiz/preview", "POST", { catalogId, draft, answers: picks })).json() as ExpressPreviewResponse;
      tops.add(body.recommendations.map((r) => r.product.id).join(","));
    }
    assert.ok(tops.size > 1, "les réponses catégorielles produisent des classements différents");

    // Plafond strict : refusé sans confirmation, respecté avec confirmation.
    const strictProposal = await (await call("/api/express-quiz/analyze", "POST", { catalogId, generator: "universal", strictBudget: true })).json() as ExpressProposal;
    const strictDraft = strictProposal.draft!;
    const budgetIndex = strictDraft.questions.findIndex((q) => q.info?.kind === "budget");
    assert.equal(strictDraft.questions[budgetIndex].info!.strict, true);
    const unconfirmed = await call("/api/express-quiz/preview", "POST", { catalogId, draft: strictDraft, answers: strictDraft.questions.map(() => 0) });
    assert.equal(unconfirmed.status, 400);
    const picks = strictDraft.questions.map(lastIndex);
    picks[budgetIndex] = 0;
    aiCalls.length = 0;
    const capped = await call("/api/express-quiz/preview", "POST", { catalogId, draft: strictDraft, answers: picks, strictConfirmed: true });
    assert.equal(capped.status, 200, await capped.clone().text());
    const cap = (strictDraft.questions[budgetIndex].answers[0].effects!.effects[0] as { max: number }).max;
    for (const item of (await capped.json() as ExpressPreviewResponse).recommendations) assert.ok(dbPrice.get(item.product.id)! <= cap);
    for (const c of aiCalls) assert.ok((c.productIds as string[]).every((id) => dbPrice.get(id)! <= cap), "le moteur ne reçoit que des produits sous le plafond");
    // Plafond sans produit : état explicite, aucun appel au moteur.
    const impossible = JSON.parse(JSON.stringify(strictDraft)) as ExpressDraft;
    (impossible.questions[budgetIndex].answers[0].effects!.effects[0] as { max: number }).max = 1;
    aiCalls.length = 0;
    const none = await call("/api/express-quiz/preview", "POST", { catalogId, draft: impossible, answers: picks, strictConfirmed: true });
    assert.equal(none.status, 422);
    assert.equal(((await none.json()) as { code: string }).code, "no_match");
    assert.equal(aiCalls.length, 0);

    // Enregistrement : brouillon INACTIF, effets persistés, strict refusé sans confirmation, rien de publié.
    const refused = await call("/api/express-quiz/save", "POST", { catalogId, draft: strictDraft, acknowledgeLimits: true });
    assert.equal(refused.status, 400);
    const saved = await call("/api/express-quiz/save", "POST", { catalogId, draft, acknowledgeLimits: true });
    assert.equal(saved.status, 201, await saved.clone().text());
    const { quizId, questionCount } = await saved.json() as { quizId: string; questionCount: number };
    assert.equal(questionCount, draft.questions.length);
    const quiz = await prisma.quiz.findUniqueOrThrow({ where: { id: quizId } });
    assert.equal(quiz.active, false);
    const answers = await prisma.answer.findMany({ where: { question: { quizId } }, select: { effects: true, impacts: true } });
    assert.ok(answers.some((a) => a.effects !== null), "effets enregistrés");
    assert.ok(answers.every((a) => a.effects !== null || Object.keys(a.impacts as object).length > 0), "aucune réponse décorative enregistrée");
    const savedDraft = await (await call(`/api/quizzes/${quizId}/draft`)).json() as { revision: number };
    const check = await (await call(`/api/quizzes/${quizId}/publication/check`, "POST", { revision: savedDraft.revision })).json() as { diagnostic?: { errors: { code: string }[] }; errors?: { code: string }[] };
    const codes = (check.diagnostic?.errors ?? check.errors ?? []).map((e) => e.code);
    assert.ok(!codes.includes("INVALID_EFFECTS") && !codes.includes("UNRELIABLE_CONSTRAINT"), codes.join(","));
    assert.equal((await prisma.quiz.findUniqueOrThrow({ where: { id: quizId } })).active, false, "la publication n'est jamais déclenchée automatiquement");
    assert.equal(await prisma.quizSession.count({ where: { tenantId } }), 0);
  } finally {
    await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
    server.close();
    fakeAi.close();
    delete process.env.EXPRESS_UNIVERSAL_QUESTIONS;
    await prisma.$disconnect();
  }
});

import quizRouter from "../src/routes/quiz";

// Le quiz avancé déjà créé reste utilisable quand l'interrupteur change ; seule la CRÉATION d'un nouveau quiz avancé est contrôlée.
test("PostgreSQL : changement d'état de l'interrupteur entre création, édition, publication et service", {
  skip: process.env.POAPO_TEST_UNIVERSAL_DB !== "1",
}, async () => {
  process.env.JWT_SECRET = "universal-db-only";
  process.env.EXPRESS_UNIVERSAL_QUESTIONS = "1";
  const tenantId = `universal-flag-${randomUUID()}`;
  const aiCalls: number[] = [];
  const fakeAi = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", async () => {
      aiCalls.push(1);
      const body = JSON.parse(raw) as { tenantId: string; catalogId: string; profile: Record<string, number>; productIds?: string[]; topN?: number };
      const rows = (await prisma.product.findMany({ where: { tenantId: body.tenantId, catalogId: body.catalogId, active: true, ...(body.productIds && { id: { in: body.productIds } }) } })).sort((a, b) => a.id.localeCompare(b.id));
      const topN = rows.map((p) => ({ id: p.id, score: 0.6 * semantic(p.id) + 0.4 * axialScore(body.profile, p.attributes) })).sort((a, b) => b.score - a.score).slice(0, body.topN ?? 1);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ productId: topN[0].id, score: topN[0].score, explanation: [], profileSummary: { axes: [] }, topN }));
    });
  });
  await new Promise<void>((resolve) => fakeAi.listen(0, "127.0.0.1", resolve));
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${(fakeAi.address() as { port: number }).port}`;
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api/catalogs", catalogsRouter);
  app.use("/api/express-quiz", expressQuizRouter);
  app.use("/api/quizzes", quizzesRouter);
  app.use("/api/quiz", quizRouter);
  app.use(quizErrorHandler);
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const tenant = await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test`, industry: "Parfumerie" } });
    await prisma.subscription.create({ data: { tenantId, plan: "BUSINESS", source: "LEGACY" } });
    const token = jwt.sign({ tenantId, email: tenant.email }, process.env.JWT_SECRET!);
    const call = (path: string, method = "GET", body?: unknown) => fetch(base + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const catalogId = ((await (await call("/api/catalogs")).json()) as { id: string }[])[0].id;
    await prisma.product.createMany({ data: perfumeSeeded(60, 5).map((p) => ({ tenantId, catalogId, name: p.id!, brand: p.brand ?? null, price: p.price ?? null, tags: [...(p.tags ?? [])], attributes: p.attributes as object, embeddingStatus: "READY" as const })) });
    // Libellés d'origine d'un import terminé : relus par le générateur (accents et unités conservés).
    await prisma.importBatch.create({ data: { tenantId, catalogId, key: "k1", fingerprint: "f1", status: "completed", result: { created: 60, labels: { famille: "Famille olfactive", genre: "Genre", contenance: "Contenance (ml)" } } } });

    // 1. Création avec l'interrupteur ouvert.
    const proposal = await (await call("/api/express-quiz/analyze", "POST", { catalogId, generator: "universal" })).json() as ExpressProposal;
    assert.equal(proposal.analysis.generator, "universal");
    const draft = proposal.draft!;
    assert.ok(draft.questions.some((q) => q.info?.criterion === "Famille olfactive" && q.text === "Côté famille olfactive, qu'est-ce qui vous attire le plus ?"), "en-tête d'origine conservé (accents, espaces)");
    const saved = await call("/api/express-quiz/save", "POST", { catalogId, draft, acknowledgeLimits: true });
    assert.equal(saved.status, 201, await saved.clone().text());
    const { quizId } = await saved.json() as { quizId: string };

    // 2. Interrupteur coupé : plus aucune CRÉATION avancée…
    process.env.EXPRESS_UNIVERSAL_QUESTIONS = "0";
    assert.deepEqual(await (await call("/api/express-quiz/capabilities")).json(), { universal: false });
    assert.equal((await call("/api/express-quiz/analyze", "POST", { catalogId, generator: "universal" })).status, 400);
    assert.equal((await call("/api/express-quiz/validate", "POST", { catalogId, draft })).status, 400);
    assert.equal((await call("/api/express-quiz/save", "POST", { catalogId, draft, acknowledgeLimits: true })).status, 400);
    assert.equal((await call("/api/express-quiz/analyze", "POST", { catalogId })).status, 200, "le parcours historique reste disponible");

    // … mais le quiz déjà créé se lit, se modifie, s'enregistre, se prévisualise, se publie et se sert normalement.
    const read = await (await call(`/api/quizzes/${quizId}/draft`)).json() as { draft: any; revision: number };
    const effectAnswers = read.draft.questions.flatMap((q: any) => q.answers).filter((a: any) => a.effects);
    assert.ok(effectAnswers.length > 0, "effets présents dans le brouillon relu");
    read.draft.questions[0].text = `${read.draft.questions[0].text} `;
    read.draft.config.active = true;
    const resaved = await call(`/api/quizzes/${quizId}/draft`, "PUT", { draft: read.draft, revision: read.revision });
    assert.equal(resaved.status, 200, await resaved.clone().text());
    const revision = ((await resaved.json()) as { revision: number }).revision;
    // Les effets restent strictement validés quel que soit l'interrupteur.
    const corrupt = JSON.parse(JSON.stringify(read.draft));
    corrupt.questions.flatMap((q: any) => q.answers).find((a: any) => a.effects).effects = { v: 9, effects: [] };
    assert.equal((await call(`/api/quizzes/${quizId}/draft`, "PUT", { draft: corrupt, revision })).status, 400);
    const questions = await prisma.question.findMany({ where: { quizId }, orderBy: { order: "asc" }, include: { answers: { orderBy: { order: "asc" } } } });
    const picks = questions.map((q) => ({ questionId: q.id, answerId: q.answers[q.answers.length - 1].id }));
    const preview = await call(`/api/quizzes/${quizId}/preview/recommendations`, "POST", { draft: read.draft, answers: picks });
    assert.equal(preview.status, 200, await preview.clone().text());
    const published = await call(`/api/quizzes/${quizId}/publication/publish`, "POST", { revision, confirm: true });
    assert.equal(published.status, 200, await published.clone().text());
    const submit = await fetch(`${base}/api/quiz/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: tenantId, quizId, answers: picks }) });
    assert.equal(submit.status, 200, await submit.clone().text());
    // Fiche publique : caractéristiques utilisées par le quiz, libellés d'origine, aucune donnée interne transmise.
    const body = await submit.json() as { product: { attributes: Record<string, unknown> }; characteristics: { label: string; value: string }[]; explanation: string[] };
    for (const internal of ["sku", "ligne", "vegan"]) assert.ok(!(internal in body.product.attributes), `${internal} non transmis`);
    assert.ok(!JSON.stringify(body).includes("376000"), "aucun EAN dans la réponse publique");
    assert.ok(body.characteristics.every((c) => !/[_.]/.test(c.label) && c.label === c.label.trim()), JSON.stringify(body.characteristics));
    assert.ok(body.explanation.every((line) => !/\bta préférence\b|\btes réponses\b/.test(line)));
    const published2 = (await prisma.answer.findMany({ where: { question: { quizId } }, select: { effects: true } })).filter((a) => a.effects !== null).length;
    assert.ok(published2 > 0, "effets conservés à la publication quand l'interrupteur est coupé");

    // 3. Mode pilote : réservé aux comptes listés.
    process.env.EXPRESS_UNIVERSAL_QUESTIONS = "pilot";
    process.env.EXPRESS_UNIVERSAL_TENANTS = "autre-compte";
    assert.equal((await call("/api/express-quiz/analyze", "POST", { catalogId, generator: "universal" })).status, 400);
    process.env.EXPRESS_UNIVERSAL_TENANTS = tenantId;
    assert.equal((await call("/api/express-quiz/analyze", "POST", { catalogId, generator: "universal" })).status, 200);
    assert.deepEqual(await (await call("/api/express-quiz/capabilities")).json(), { universal: true });
  } finally {
    await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
    server.close();
    fakeAi.close();
    delete process.env.EXPRESS_UNIVERSAL_QUESTIONS;
    delete process.env.EXPRESS_UNIVERSAL_TENANTS;
  }
});
