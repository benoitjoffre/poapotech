import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { QuizEditorDraftResponse, QuizEditorDraft, SessionAnswer } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import quizzesRouter from "../src/routes/quizzes";
import quizRouter from "../src/routes/quiz";
import { quizErrorHandler } from "../src/services/quizzes";

const quiz = {
  id: "preview-quiz", tenantId: "preview-tenant", catalogId: "preview-catalog", name: "Quiz",
  industry: "voyage", axes: [{ key: "pace", label: "Rythme" }], quizTitle: "Voyage",
  ctaText: "Découvrir", active: true, useAllProducts: false, products: [{ productId: "product" }], isDefault: false,
};
const answer = (id: string, questionId: string, impact: number, order = 0) => ({
  id, questionId, text: id, emoji: null, imageUrl: null, active: true, order, impacts: { pace: impact },
});
const question = (id: string, order: number, type: "single" | "multi" | "scale" = "single") => ({
  id, tenantId: quiz.tenantId, quizId: quiz.id, text: id, helpText: null, imageUrl: null,
  active: true, order, type, conditionAnswerId: null as string | null, abVariant: null as string | null,
  answers: [answer(`a-${id}`, id, 0.1)],
});
const questions = [
  { ...question("root", 0), answers: [answer("yes", "root", -0.2), answer("no", "root", 0.2, 1)] },
  { ...question("multi", 1, "multi"), conditionAnswerId: "yes", answers: [answer("m1", "multi", 0.1), answer("m2", "multi", 0.2, 1)] },
  { ...question("scale", 2, "scale"), abVariant: "A" },
  { ...question("variant", 3), abVariant: "B" },
  { ...question("disabled", 4), active: false },
];
const product = { id: "product", name: "Voyage", brand: null, description: null, price: 100,
  imageUrl: null, purchaseUrl: "https://example.test", tags: [], attributes: { pace: 0.7 } };
const restores: (() => void)[] = [];
let server: Server;
let engine: Server;
let base: string;
let publicSessions = 0;
let forbiddenWrites = 0;
let engineRequests: Record<string, unknown>[] = [];
let engineStatus = 200;
let engineProduct = "product";
const originalAiUrl = process.env.AI_SERVICE_URL;
function stub<T extends object>(target: T, key: keyof T, impl: (...args: never[]) => unknown) {
  const original = target[key];
  assert.ok(Reflect.set(target, key, impl));
  restores.push(() => { Reflect.set(target, key, original); });
}
async function listen(app: express.Express) {
  const s = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const a = s.address();
  assert.ok(a && typeof a !== "string");
  return { s, url: `http://127.0.0.1:${a.port}` };
}
before(async () => {
  process.env.JWT_SECRET = "preview-test-only";
  stub(prisma, "$transaction", async (fn: (db: typeof prisma) => Promise<unknown>) => fn(prisma));
  stub(prisma.quiz, "findFirst", async ({ where }: Prisma.QuizFindFirstArgs = {}) =>
    where?.id === quiz.id && where.tenantId === quiz.tenantId ? quiz : null);
  stub(prisma.tenant, "findUnique", async () => ({ active: true }));
  // Abonnement BUSINESS + transaction/SQL bruts neutralisés (quota, verrous) : ces tests couvrent le métier, pas PostgreSQL.
  stub(prisma.subscription, "findUnique", (async () => ({ plan: "BUSINESS", status: "ACTIVE", source: "LEGACY", startsAt: new Date(0), endsAt: null })) as unknown as typeof prisma.subscription.findUnique);
  stub(prisma, "$transaction", (async (fn: (tx: typeof prisma) => unknown) => fn(prisma)) as unknown as typeof prisma.$transaction);
  stub(prisma, "$queryRaw", (async () => [{ recommendations: 1 }]) as unknown as typeof prisma.$queryRaw);
  stub(prisma.tenant, "findUniqueOrThrow", async () => ({ name: "Marque", primaryColor: "#246753", logoUrl: null }));
  stub(prisma.question, "findMany", async ({ where }: Prisma.QuestionFindManyArgs = {}) =>
    where?.quizId === quiz.id ? structuredClone(questions) : []);
  stub(prisma.answer, "findMany", async ({ where }: Prisma.AnswerFindManyArgs = {}) => {
    const ids = where?.id && typeof where.id === "object" ? where.id.in : [];
    return questions.flatMap((q) => q.answers.map((a) => ({ ...a, question: { type: q.type } })))
      .filter((a) => Array.isArray(ids) && ids.includes(a.id));
  });
  stub(prisma.catalog, "findFirst", async ({ where }: Prisma.CatalogFindFirstArgs = {}) =>
    where?.tenantId === quiz.tenantId && where.id === quiz.catalogId ? { id: quiz.catalogId } : null);
  stub(prisma.product, "findMany", async ({ where }: Prisma.ProductFindManyArgs = {}) => {
    const ids = where?.id && typeof where.id === "object" ? where.id.in : [];
    return where?.tenantId === quiz.tenantId && Array.isArray(ids) && ids.includes(product.id)
      ? [{ id: product.id, catalogId: quiz.catalogId }] : [];
  });
  stub(prisma.product, "findFirst", async ({ where }: Prisma.ProductFindFirstArgs = {}) =>
    where?.id === product.id && where.tenantId === quiz.tenantId && where.catalogId === quiz.catalogId ? product : null);
  stub(prisma.quizEditorDraft, "findFirst", async () => null);
  for (const delegate of [prisma.metric, prisma.quizEditorDraft, prisma.question, prisma.answer, prisma.quiz]) {
    stub(delegate, "create", async () => { forbiddenWrites++; throw new Error("Preview must never write"); });
    stub(delegate, "updateMany", async () => { forbiddenWrites++; throw new Error("Preview must never update"); });
  }
  stub(prisma.quizSession, "create", async () => { publicSessions++; return { id: "public-session" }; });
  const ai = express();
  ai.use(express.json());
  ai.post("/recommend", (req, res) => {
    engineRequests.push(req.body);
    res.status(engineStatus).json({ productId: engineProduct, explanation: ["Explication réelle du contrat"],
      profileSummary: { axes: [{ key: "pace", label: "Rythme", value: req.body.profile.pace, level: "modéré" }] } });
  });
  const startedAi = await listen(ai);
  engine = startedAi.s;
  process.env.AI_SERVICE_URL = startedAi.url;
  const app = express();
  app.use(express.json());
  app.use("/api/quizzes", quizzesRouter);
  app.use("/api/quiz", quizRouter);
  app.use(quizErrorHandler);
  const started = await listen(app);
  server = started.s;
  base = started.url;
});
beforeEach(() => {
  forbiddenWrites = 0; publicSessions = 0; engineRequests = []; engineStatus = 200; engineProduct = product.id; quiz.active = true;
});
after(async () => {
  for (const restore of restores.reverse()) restore();
  for (const s of [server, engine]) await new Promise<void>((resolve, reject) => s.close((e) => e ? reject(e) : resolve()));
  if (originalAiUrl === undefined) delete process.env.AI_SERVICE_URL;
  else process.env.AI_SERVICE_URL = originalAiUrl;
  await prisma.$disconnect();
});
async function request(path: string, body?: unknown, tenantId: string | null = quiz.tenantId) {
  return fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json",
      ...(tenantId && { Authorization: `Bearer ${jwt.sign({ tenantId, email: "preview@example.test" }, process.env.JWT_SECRET!)}` }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}
const path = `/api/quizzes/${quiz.id}/preview`;
async function draft(): Promise<QuizEditorDraft> {
  const res = await request(`/api/quizzes/${quiz.id}/draft`);
  assert.equal(res.status, 200);
  return ((await res.json()) as QuizEditorDraftResponse).draft;
}
const answersA: SessionAnswer[] = [{ questionId: "root", answerId: "yes" }, { questionId: "multi", answerId: "m1" },
  { questionId: "multi", answerId: "m2" }, { questionId: "scale", answerId: "a-scale" }];
async function recommend(draft: QuizEditorDraft, answers = answersA, abVariant: string | null = "A") {
  return request(`${path}/recommendations`, { draft, answers, abVariant });
}

test("aperçu local, thème et quiz inactif : aucune écriture ni session", async () => {
  const local = await draft();
  local.questions[0].text = "Modification locale";
  local.theme = { primaryColor: "#123456", headingFont: "georgia", startLabel: "Tester" };
  quiz.active = false;
  const prepared = await request(path, { draft: local });
  assert.equal(prepared.status, 200);
  const snapshot = await prepared.json();
  assert.deepEqual(snapshot.draft, local);
  assert.equal(snapshot.branding.primaryColor, "#246753");
  const response = await recommend(local);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sessionId, undefined);
  assert.equal(forbiddenWrites, 0);
  assert.equal(publicSessions, 0);
  assert.equal((await draft()).questions[0].text, "root");
});

test("mêmes données : même profil, requête moteur et recommandation que la soumission publique", async () => {
  const local = await draft();
  const preview = await recommend(local);
  assert.equal(preview.status, 200);
  const previewResult = await preview.json();
  assert.equal(publicSessions, 0);
  const submitted = await request("/api/quiz/submit", { clientId: quiz.tenantId, quizId: quiz.id, answers: answersA, abVariant: "A" });
  assert.equal(submitted.status, 200);
  const { sessionId, feedbackToken, ...publicResult } = await submitted.json();
  assert.equal(sessionId, "public-session");
  assert.equal(typeof feedbackToken, "string");
  assert.deepEqual(previewResult, publicResult);
  assert.deepEqual(engineRequests[0], engineRequests[1]);
  assert.ok(Math.abs((engineRequests[0].profile as { pace: number }).pace - 0.7) < 1e-10);
  assert.equal(forbiddenWrites, 0);
  assert.equal(publicSessions, 1);
});

test("conditions, variantes A/B, single/multi/scale et réponses désactivées sont validées", async () => {
  const local = await draft();
  for (const [answers, variant] of [
    [answersA.slice(0, -1), "A"],
    [[...answersA, answersA[0]], "A"],
    [answersA, "B"],
    [answersA, "unknown"],
    [[...answersA, { questionId: "disabled", answerId: "a-disabled" }], "A"],
    [[{ questionId: "root", answerId: "no" }, ...answersA.slice(1)], "A"],
    [[{ questionId: "root", answerId: "yes" }, { questionId: "root", answerId: "no" }, ...answersA.slice(1)], "A"],
  ] as [SessionAnswer[], string][]) assert.equal((await recommend(local, answers, variant)).status, 400);
  assert.equal((await recommend(local, [{ questionId: "root", answerId: "no" }, { questionId: "variant", answerId: "a-variant" }], "B")).status, 200);
  local.questions[1].answers[0].active = false;
  assert.equal((await recommend(local)).status, 400);
  assert.equal(publicSessions + forbiddenWrites, 0);
});

test("isolation tenant/catalogue/produits, authentification et validation du thème", async () => {
  const local = await draft();
  for (const suffix of ["", "/recommendations"]) {
    const body = { draft: local, answers: answersA, abVariant: "A" };
    assert.equal((await request(path + suffix, body, null)).status, 401);
    assert.equal((await request(path + suffix, body, "foreign")).status, 404);
  }
  local.config.catalogId = "foreign-catalog";
  assert.equal((await request(path, { draft: local })).status, 404);
  local.config.catalogId = quiz.catalogId;
  local.config.productIds = ["foreign-product"];
  assert.equal((await request(path, { draft: local })).status, 400);
  local.config.productIds = ["product"];
  local.theme = { primaryColor: "red" };
  assert.equal((await request(path, { draft: local })).status, 400);
  assert.equal(engineRequests.length, 0);
  assert.equal(publicSessions + forbiddenWrites, 0);
});

test("axes et impacts locaux, sélection vide et erreurs moteur explicites", async () => {
  const local = await draft();
  local.questions[0].answers[0].impacts.pace = 0.1;
  local.config.axes.push({ key: "comfort", label: "Confort", lowLabel: null, highLabel: null });
  local.questions[0].answers[0].impacts.comfort = 0.2;
  assert.equal((await recommend(local)).status, 200);
  assert.deepEqual(engineRequests[0].axes, local.config.axes);
  assert.equal((engineRequests[0].profile as { comfort: number }).comfort, 0.7);
  assert.deepEqual(engineRequests[0].productIds, ["product"]);
  local.config.productIds = [];
  assert.equal((await recommend(local)).status, 422);
  local.config.useAllProducts = true;
  assert.equal((await recommend(local)).status, 200);
  assert.equal(engineRequests.at(-1)?.productIds, undefined);
  engineProduct = "foreign-product";
  assert.equal((await recommend(local)).status, 502);
  engineStatus = 503;
  assert.equal((await recommend(local)).status, 503);
  assert.equal(publicSessions + forbiddenWrites, 0);
});

test("nouveaux identifiants locaux, parcours sans A/B et brouillon incomplet", async () => {
  const local = await draft();
  local.questions.forEach((q) => { q.abVariant = null; });
  const extra = structuredClone(local.questions[0]);
  extra.id = `draft_${randomUUID()}`;
  extra.order = 5;
  extra.answers = [{ ...extra.answers[0], id: `draft_${randomUUID()}` }];
  local.questions.push(extra);
  const answers = [...answersA, { questionId: "variant", answerId: "a-variant" },
    { questionId: extra.id, answerId: extra.answers[0].id }];
  assert.equal((await recommend(local, answers, null)).status, 200);
  local.questions[0].text = "";
  assert.equal((await request(path, { draft: local })).status, 422);
  local.questions[0].text = "root";
  local.questions[0].answers.forEach((a) => { a.active = false; });
  assert.equal((await request(path, { draft: local })).status, 422);
  assert.equal(publicSessions + forbiddenWrites, 0);
});
