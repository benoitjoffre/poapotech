import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import type { ExpressDraft, ExpressProposal } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import expressQuizRouter from "../src/routes/expressQuiz";
import { quizErrorHandler } from "../src/services/quizzes";

type Row = Record<string, any>;

const catalogs: Row[] = [
  { id: "cat-a", tenantId: "tenant-a", name: "Cafés", description: null },
  { id: "cat-b", tenantId: "tenant-b", name: "Cafés B", description: null },
];
const products: Row[] = [
  { id: "a1", tenantId: "tenant-a", catalogId: "cat-a", name: "Doux", attributes: { intensity: 0.2, acidity: 0.8, body: 0.3, sweetness: 0.7 } },
  { id: "a2", tenantId: "tenant-a", catalogId: "cat-a", name: "Corsé", attributes: { intensity: 0.9, acidity: 0.2, body: 0.9, sweetness: 0.2 } },
  { id: "a3", tenantId: "tenant-a", catalogId: "cat-a", name: "Équilibré", attributes: { intensity: 0.5, acidity: 0.5, body: 0.6, sweetness: 0.9 } },
  { id: "f1", tenantId: "tenant-a", catalogId: "cat-flat", name: "Plat 1", attributes: {} },
  { id: "f2", tenantId: "tenant-a", catalogId: "cat-flat", name: "Plat 2", attributes: {} },
  { id: "b1", tenantId: "tenant-b", catalogId: "cat-b", name: "Étranger", attributes: { intensity: 0.1, acidity: 0.9 } },
].map((row) => ({ brand: null, description: null, tags: [], featured: false, active: true, embeddingStatus: "PENDING", imageUrl: null, price: null, ...row }));
catalogs.push({ id: "cat-flat", tenantId: "tenant-a", name: "Divers", description: null });

let writes: string[] = [];
let created: Row[] = [];
let aiCalls: Row[] = [];
let server: Server;
let base: string;
const originalFetch = globalThis.fetch;
const restores: (() => void)[] = [];

function stub<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const previous = target[key];
  target[key] = value;
  restores.push(() => { target[key] = previous; });
}

before(async () => {
  process.env.JWT_SECRET = "express-tests-only";
  process.env.AI_SERVICE_URL = "http://ai.test";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("http://ai.test")) return originalFetch(input, init);
    aiCalls.push({ path: url.slice(14), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ productId: "a2", profileSummary: { axes: [] }, topN: [{ id: "a2", score: 0.9 }, { id: "a3", score: 0.5 }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  restores.push(() => { globalThis.fetch = originalFetch; });

  stub(prisma.catalog, "findFirst", (async ({ where }: { where: Row }) => catalogs.find((c) => c.id === where.id && c.tenantId === where.tenantId) ?? null) as unknown as typeof prisma.catalog.findFirst);
  stub(prisma.tenant, "findUnique", (async () => ({ id: "tenant-a", industry: "café" })) as unknown as typeof prisma.tenant.findUnique);
  stub(prisma.product, "findMany", (async ({ where }: { where: Row }) => products.filter((p) =>
    p.tenantId === where.tenantId && p.catalogId === where.catalogId && (!where.id || where.id.in.includes(p.id)))) as unknown as typeof prisma.product.findMany);
  stub(prisma.quiz, "findMany", (async () => []) as unknown as typeof prisma.quiz.findMany);
  stub(prisma.quiz, "findUnique", (async () => ({ id: "default_tenant-a" })) as unknown as typeof prisma.quiz.findUnique);
  stub(prisma.quiz, "create", (async ({ data }: { data: Row }) => { writes.push("quiz.create"); const quiz = { ...data, id: "new-quiz" }; created.push(quiz); return quiz; }) as unknown as typeof prisma.quiz.create);
  stub(prisma.question, "create", (async ({ data }: { data: Row }) => { writes.push("question.create"); return { ...data, id: `q${writes.length}` }; }) as unknown as typeof prisma.question.create);
  stub(prisma.answer, "create", (async ({ data }: { data: Row }) => { writes.push("answer.create"); return data; }) as unknown as typeof prisma.answer.create);
  stub(prisma, "$transaction", (async (fn: (tx: typeof prisma) => unknown) => fn(prisma)) as unknown as typeof prisma.$transaction);

  const app = express();
  app.use(express.json());
  app.use("/api/express-quiz", expressQuizRouter);
  app.use(quizErrorHandler);
  server = await new Promise<Server>((resolve) => { const l = app.listen(0, "127.0.0.1", () => resolve(l)); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  for (const restore of restores.reverse()) restore();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await prisma.$disconnect();
});

beforeEach(() => { writes = []; created = []; aiCalls = []; });

async function call(path: string, body: unknown, tenantId: string | null = "tenant-a") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (tenantId) headers.Authorization = `Bearer ${jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET!)}`;
  const res = await originalFetch(`${base}/api/express-quiz${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as any };
}

async function proposal(catalogId = "cat-a", extra: Row = {}): Promise<ExpressProposal> {
  const res = await call("/analyze", { catalogId, ...extra });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

test("authentification requise ; analyse sans aucune écriture", async () => {
  assert.equal((await call("/analyze", { catalogId: "cat-a" }, null)).status, 401);
  const result = await proposal();
  assert.equal(result.analysis.reliability, "reliable");
  assert.ok(result.draft && result.draft.questions.length >= 3);
  assert.deepEqual(writes, []);
  assert.deepEqual(aiCalls, []);
});

test("isolation tenant : catalogue d'un autre tenant introuvable, y compris à l'enregistrement", async () => {
  assert.equal((await call("/analyze", { catalogId: "cat-b" })).status, 404);
  const draft = (await proposal()).draft!;
  assert.equal((await call("/save", { catalogId: "cat-b", draft })).status, 404);
  assert.equal((await call("/preview", { catalogId: "cat-b", draft, answers: [] })).status, 404);
  assert.equal((await call("/validate", { catalogId: "cat-b", draft })).status, 404);
  assert.equal((await call("/analyze", { catalogId: "cat-a" }, "tenant-b")).status, 404);
  assert.equal((await call("/analyze", {})).status, 400);
  assert.deepEqual(writes, []);
});

test("options invalides refusées", async () => {
  assert.equal((await call("/analyze", { catalogId: "cat-a", questionCount: 4 })).status, 400);
  assert.equal((await call("/analyze", { catalogId: "cat-a", sector: "inconnu" })).status, 400);
  assert.equal((await proposal("cat-a", { sector: "generic" })).analysis.sector, "generic");
});

test("enregistrement : expérience inactive, catalogue du tenant, tous les produits, jamais publiée", async () => {
  const draft = (await proposal("cat-a", { questionCount: 5 })).draft!;
  const res = await call("/save", { catalogId: "cat-a", draft });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.questionCount, 5);
  const [quiz] = created;
  assert.equal(quiz.active, false);
  assert.equal(quiz.tenantId, "tenant-a");
  assert.equal(quiz.catalogId, "cat-a");
  assert.equal(quiz.useAllProducts, true);
  assert.deepEqual((quiz.axes as Row[]).map((a) => a.key).sort(), ["acidity", "body", "intensity", "sweetness"]);
  assert.equal(writes.filter((w) => w === "question.create").length, 5);
});

test("enregistrement : brouillon invalide refusé sans écriture", async () => {
  const draft: ExpressDraft = (await proposal()).draft!;
  const broken = JSON.parse(JSON.stringify(draft)) as ExpressDraft;
  broken.questions[0].answers[0].impacts = { fantome: 0.2 };
  const res = await call("/save", { catalogId: "cat-a", draft: broken });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /inexistant/);
  const noEffect = JSON.parse(JSON.stringify(draft)) as ExpressDraft;
  noEffect.questions[0].answers.forEach((a) => { a.impacts = {}; });
  assert.equal((await call("/save", { catalogId: "cat-a", draft: noEffect })).status, 400);
  assert.deepEqual(writes, []);
});

test("catalogue aux données insuffisantes : confirmation explicite exigée avant l'enregistrement", async () => {
  const result = await proposal("cat-flat", { sector: "coffee" });
  assert.equal(result.analysis.reliability, "insufficient");
  assert.ok(result.draft);
  const refused = await call("/save", { catalogId: "cat-flat", draft: result.draft });
  assert.equal(refused.status, 409);
  assert.deepEqual(writes, []);
  const accepted = await call("/save", { catalogId: "cat-flat", draft: result.draft, acknowledgeLimits: true });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.reliability, "insufficient");
  assert.equal(created[0].active, false);
});

test("aperçu : appelle le moteur existant avec le profil calculé, sur les produits du catalogue uniquement", async () => {
  const draft = (await proposal("cat-a", { questionCount: 3 })).draft!;
  const res = await call("/preview", { catalogId: "cat-a", draft, answers: draft.questions.map(() => 0) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.recommendations.map((r: Row) => r.product.id), ["a2", "a3"]);
  assert.equal(aiCalls.length, 1);
  assert.equal(aiCalls[0].path, "/recommend");
  assert.deepEqual(aiCalls[0].body.productIds.sort(), ["a1", "a2", "a3"]);
  assert.equal(aiCalls[0].body.tenantId, "tenant-a");
  for (const axis of draft.axes) assert.ok(aiCalls[0].body.profile[axis.key] >= 0 && aiCalls[0].body.profile[axis.key] <= 1);
  assert.equal((await call("/preview", { catalogId: "cat-a", draft, answers: [0] })).status, 400);
  assert.equal((await call("/preview", { catalogId: "cat-a", draft, answers: draft.questions.map(() => 99) })).status, 400);
  assert.deepEqual(writes, []);
});
