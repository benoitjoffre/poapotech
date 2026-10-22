import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { prisma } from "../src/lib/prisma";
import campaignsRouter from "../src/routes/campaigns";
import { quizErrorHandler } from "../src/services/quizzes";
import { GenerationLimiter, generationLimiter } from "../src/services/quizGeneration";

type Row = Record<string, any>;

const AXES = [
  { key: "intensity", label: "Intensité", lowLabel: "Doux", highLabel: "Corsé" },
  { key: "sweetness", label: "Douceur", lowLabel: null, highLabel: null },
  { key: "budget", label: "Budget", lowLabel: null, highLabel: null },
];

const quizzes: Row[] = [
  { id: "coffee", tenantId: "tenant-a", catalogId: "catalog-a", name: "Mon café", industry: "café", axes: AXES },
  { id: "flat", tenantId: "tenant-a", catalogId: "catalog-a", name: "Sans axes", industry: "", axes: [] },
  { id: "trips", tenantId: "tenant-a", catalogId: "catalog-voyages", name: "Voyages", industry: "voyage", axes: AXES },
  { id: "foreign-quiz", tenantId: "tenant-b", catalogId: "catalog-b", name: "Quiz B", industry: "thé", axes: AXES },
];
const catalogNames: Record<string, string> = { "catalog-a": "Catalogue principal", "catalog-voyages": "Voyages", "catalog-b": "Catalogue B" };

const products: Row[] = [
  { id: "prod-1", tenantId: "tenant-a", active: true, name: "Moka doux", attributes: { intensity: 0.2, sweetness: 0.8 }, embedding: [0.1] },
  { id: "prod-2", tenantId: "tenant-a", active: true, name: "Espresso noir", attributes: { intensity: 0.9, sweetness: 0.1 }, embedding: [0.2] },
  { id: "prod-3", tenantId: "tenant-a", active: true, name: "Coffret équilibré", attributes: { intensity: 0.5, sweetness: 0.5 }, embedding: null },
  { id: "flat-1", tenantId: "tenant-a", active: true, name: "Café A", attributes: { intensity: 0.5 }, embedding: [0.3] },
  { id: "flat-2", tenantId: "tenant-a", active: true, name: "Café B", attributes: { intensity: 0.55 }, embedding: null },
  { id: "bare-1", tenantId: "tenant-a", active: true, name: "Sans données 1", attributes: {}, embedding: null },
  { id: "bare-2", tenantId: "tenant-a", active: true, name: "Sans données 2", attributes: {}, embedding: null },
  { id: "inactive", tenantId: "tenant-a", active: false, name: "Retiré", attributes: {}, embedding: null },
  { id: "foreign-prod", tenantId: "tenant-b", catalogId: "catalog-b", active: true, name: "Thé B", attributes: { intensity: 0.1 }, embedding: [0.4] },
  { id: "trip-1", tenantId: "tenant-a", catalogId: "catalog-voyages", active: true, name: "Trek", attributes: { intensity: 0.9, sweetness: 0.1 }, embedding: [0.5] },
  { id: "trip-2", tenantId: "tenant-a", catalogId: "catalog-voyages", active: true, name: "Croisière", attributes: { intensity: 0.1, sweetness: 0.9 }, embedding: [0.6] },
].map((row) => ({ catalogId: "catalog-a", brand: null, description: `Description de ${row.name}`, tags: ["café"], price: 12, imageUrl: null, featured: false, ...row }));

let campaigns: Row[] = [];
let writes: string[] = [];
let createdQuizzes: Row[] = [];
let aiCalls: { path: string; body: Row }[] = [];
let aiHandler: (path: string, body: Row, call: number) => Response | Promise<Response> = () => json(500, {});
let server: Server;
let base: string;
const originalFetch = globalThis.fetch;
const restores: (() => void)[] = [];

function stub<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const previous = target[key];
  target[key] = value;
  restores.push(() => { target[key] = previous; });
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Évalue les filtres Prisma utilisés par les routes de génération. */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === "embedding") return row.embedding !== null;
    if (condition !== null && typeof condition === "object" && "in" in condition) return condition.in.includes(row[key]);
    return row[key] === condition;
  });
}

function campaignRow(overrides: Row): Row {
  return { tenantId: "tenant-a", quizId: "coffee", name: "Noël gourmand", status: "DRAFT", startsAt: null, endsAt: null, occasion: "CHRISTMAS", occasionLabel: null, ...overrides };
}

beforeEach(() => {
  generationLimiter.reset();
  writes = [];
  createdQuizzes = [];
  aiCalls = [];
  campaigns = [
    campaignRow({ id: "draft-a" }),
    campaignRow({ id: "flat-a", quizId: "flat" }),
    campaignRow({ id: "active-a", status: "ACTIVE" }),
    campaignRow({ id: "scheduled-a", status: "SCHEDULED", startsAt: new Date(Date.now() + 86_400_000) }),
    campaignRow({ id: "paused-a", status: "PAUSED" }),
    campaignRow({ id: "foreign-campaign", tenantId: "tenant-b", quizId: "foreign-quiz" }),
  ];
});

before(async () => {
  process.env.JWT_SECRET = "multi-quiz-tests-only";
  process.env.AI_SERVICE_URL = "http://ai.test";

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("http://ai.test")) return originalFetch(input, init);
    const path = url.slice("http://ai.test".length);
    const body = JSON.parse(String(init?.body));
    aiCalls.push({ path, body });
    return aiHandler(path, body, aiCalls.length);
  }) as typeof fetch;
  restores.push(() => { globalThis.fetch = originalFetch; });

  stub(prisma.tenant, "findUnique", (async ({ where }: { where: Row }) => (
    where.id === "tenant-a" ? { id: "tenant-a", industry: "épicerie fine", quizTitle: "", ctaText: "" } : null
  )) as unknown as typeof prisma.tenant.findUnique);
  stub(prisma.campaign, "findFirst", (async ({ where }: { where: Row }) => {
    const row = campaigns.find((c) => matches(c, where));
    if (!row) return null;
    const quiz = quizzes.find((q) => q.id === row.quizId && q.tenantId === row.tenantId)!;
    return {
      ...row,
      quiz: {
        id: quiz.id, name: quiz.name, industry: quiz.industry, axes: quiz.axes,
        catalogId: quiz.catalogId, catalog: { id: quiz.catalogId, name: catalogNames[quiz.catalogId] },
      },
      tenant: { industry: "épicerie fine" },
    };
  }) as unknown as typeof prisma.campaign.findFirst);
  stub(prisma.campaign, "updateMany", (async ({ where, data }: { where: Row; data: Row }) => {
    writes.push("campaign.updateMany");
    const rows = campaigns.filter((c) => matches(c, where));
    rows.forEach((row) => Object.assign(row, data));
    return { count: rows.length };
  }) as unknown as typeof prisma.campaign.updateMany);
  stub(prisma.product, "findMany", (async ({ where }: { where: Row }) => (
    products.filter((p) => matches(p, where))
  )) as unknown as typeof prisma.product.findMany);
  stub(prisma.quiz, "findUnique", (async () => null) as unknown as typeof prisma.quiz.findUnique);
  stub(prisma.catalog, "findFirst", (async ({ where }: { where: Row }) => (
    where.tenantId === "tenant-a" && where.isDefault ? { id: "catalog-a", tenantId: "tenant-a", name: "Catalogue principal", isDefault: true } : null
  )) as unknown as typeof prisma.catalog.findFirst);
  stub(prisma.quiz, "upsert", (async () => {
    writes.push("quiz.upsert");
    return { id: "default_tenant-a" };
  }) as unknown as typeof prisma.quiz.upsert);
  stub(prisma.quiz, "create", (async ({ data }: { data: Row }) => {
    writes.push("quiz.create");
    const quiz = { ...data, id: `generated-${createdQuizzes.length + 1}` };
    createdQuizzes.push(quiz);
    return quiz;
  }) as unknown as typeof prisma.quiz.create);
  stub(prisma.question, "create", (async ({ data }: { data: Row }) => {
    writes.push("question.create");
    return { ...data, id: `question-${writes.length}` };
  }) as unknown as typeof prisma.question.create);
  stub(prisma.answer, "create", (async ({ data }: { data: Row }) => {
    writes.push("answer.create");
    return data;
  }) as unknown as typeof prisma.answer.create);
  stub(prisma, "$transaction", (async (fn: (tx: typeof prisma) => unknown) => fn(prisma)) as unknown as typeof prisma.$transaction);

  const app = express();
  app.use(express.json());
  app.use("/api/campaigns", campaignsRouter);
  app.use(quizErrorHandler);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  for (const restore of restores.reverse()) restore();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await prisma.$disconnect();
});

async function request(path: string, method = "GET", body?: unknown, token: Row | null = { tenantId: "tenant-a", email: "a@example.test" }) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${jwt.sign(token, process.env.JWT_SECRET!)}`;
  return originalFetch(`${base}/api/campaigns${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const generateInput = { objective: "GIFT_FINDER", productIds: ["prod-1", "prod-2", "prod-3"], questionCount: 3, instructions: "Ton chaleureux" };

function aiAnswer(text: string, axis: string, value: number, refs: string[] = []) {
  return { text, emoji: "☕", impacts: [{ axis, value }], targetProductRefs: refs };
}

function validAiQuiz() {
  return {
    name: "Quiz de Noël",
    quizTitle: "Le cadeau café idéal",
    ctaText: "Voir mon cadeau",
    questions: [
      { text: "Quel café aime la personne ?", helpText: null, answers: [aiAnswer("Doux", "intensity", -0.15, ["p1"]), aiAnswer("Corsé", "intensity", 0.15, ["p2"])] },
      { text: "Plutôt sucré ?", helpText: null, answers: [aiAnswer("Oui", "sweetness", 0.15, ["p1"]), aiAnswer("Non", "sweetness", -0.15, ["p2", "p3"])] },
      { text: "Pour quel moment ?", helpText: null, answers: [aiAnswer("Matin", "intensity", 0.1), aiAnswer("Soir", "intensity", -0.1)] },
    ],
  };
}

function generated(quiz: unknown = validAiQuiz()) {
  return json(200, { quiz, model: "test-model" });
}

function manualDraft(overrides: Row = {}) {
  return {
    name: "Quiz de Noël",
    quizTitle: "Le cadeau café idéal",
    ctaText: "Voir mon cadeau",
    axisKeys: ["intensity", "sweetness"],
    productIds: ["prod-1", "prod-2"],
    questions: [
      { text: "Quel café ?", helpText: null, answers: [{ text: "Doux", emoji: null, impacts: { intensity: -1 } }, { text: "Corsé", emoji: "🔥", impacts: { intensity: 0.8 } }] },
      { text: "Sucré ?", helpText: "Une seule réponse", answers: [{ text: "Oui", emoji: null, impacts: { sweetness: 0.4 } }, { text: "Non", emoji: null, impacts: { sweetness: -0.4 } }] },
    ],
    ...overrides,
  };
}

// ─── Isolation et contexte ────────────────────────────────────────────────────

test("authentification requise, super-admin sans tenant refusé et campagne étrangère introuvable", async () => {
  assert.equal((await request("/draft-a/quiz-generation/context", "GET", undefined, null)).status, 401);
  const admin = await request("/draft-a/quiz-generation/context", "GET", undefined, { tenantId: "super-admin", email: "root@example.test", isSuperAdmin: true });
  assert.equal(admin.status, 403);
  for (const path of ["/context"]) {
    assert.equal((await request(`/foreign-campaign/quiz-generation${path}`)).status, 404);
  }
  assert.equal((await request("/foreign-campaign/quiz-generation", "POST", generateInput)).status, 404);
  assert.equal((await request("/foreign-campaign/quiz-generation/save", "POST", { draft: manualDraft(), attachToCampaign: true })).status, 404);
  assert.equal(aiCalls.length, 0);
  assert.deepEqual(writes, []);
});

test("le contexte expose les axes du quiz, les produits actifs du tenant et le droit de rattachement", async () => {
  const res = await request("/draft-a/quiz-generation/context");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.axes.map((axis: Row) => axis.key), ["intensity", "sweetness", "budget"]);
  assert.equal(body.industry, "café");
  assert.equal(body.canAttach, true);
  assert.equal(body.limits.generationImpact, 0.15);
  assert.equal(body.limits.manualImpact, 1);
  const ids = body.products.map((p: Row) => p.id);
  assert.ok(!ids.includes("foreign-prod") && !ids.includes("inactive"));
  const moka = body.products.find((p: Row) => p.id === "prod-1");
  assert.deepEqual(moka.axisValues, { intensity: 0.2, sweetness: 0.8 });
  assert.equal(moka.hasEmbedding, true);
  assert.equal(body.products.find((p: Row) => p.id === "prod-3").hasEmbedding, false);

  for (const id of ["active-a", "scheduled-a", "paused-a"]) {
    assert.equal((await (await request(`/${id}/quiz-generation/context`)).json()).canAttach, false, id);
  }
});

// ─── Génération ───────────────────────────────────────────────────────────────

test("génération valide : identifiants réels jamais envoyés à l'IA, impacts bornés à ±0,15, aucune écriture", async () => {
  const quiz = validAiQuiz();
  quiz.questions[0].answers[0].impacts = [{ axis: "intensity", value: -0.12 }, { axis: "intensity", value: -0.2 }];
  aiHandler = () => generated(quiz);

  const res = await request("/draft-a/quiz-generation", "POST", generateInput);
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.equal(aiCalls.length, 1);
  const sent = JSON.stringify(aiCalls[0].body);
  for (const id of ["prod-1", "prod-2", "prod-3", "tenant-a", "draft-a"]) assert.ok(!sent.includes(id), `${id} ne doit pas être transmis`);
  assert.deepEqual(aiCalls[0].body.products.map((p: Row) => p.ref), ["p1", "p2", "p3"]);
  assert.equal(aiCalls[0].body.occasion, "Noël");
  assert.equal(aiCalls[0].body.mode, "AXES");

  assert.equal(body.mode, "AXES");
  assert.deepEqual(body.draft.productIds, ["prod-1", "prod-2", "prod-3"]);
  assert.deepEqual(body.draft.questions[0].answers[0].impacts, { intensity: -0.15 });
  assert.deepEqual(body.draft.questions[0].answers[0].targetProductIds, ["prod-1"]);
  for (const answer of body.draft.questions.flatMap((q: Row) => q.answers)) {
    for (const value of Object.values(answer.impacts) as number[]) assert.ok(Math.abs(value) <= 0.15);
  }
  assert.equal(body.generation.attempts, 1);
  assert.deepEqual(writes, []);
});

test("produits étrangers ou inactifs refusés avant tout appel IA", async () => {
  for (const productIds of [["prod-1", "foreign-prod"], ["prod-1", "inactive"], ["prod-1", "unknown"]]) {
    const res = await request("/draft-a/quiz-generation", "POST", { ...generateInput, productIds });
    assert.equal(res.status, 400);
  }
  assert.equal(aiCalls.length, 0);
});

test("axes demandés hors configuration du quiz refusés ; quiz sans axes refusé", async () => {
  assert.equal((await request("/draft-a/quiz-generation", "POST", { ...generateInput, axisKeys: ["intensity", "aroma"] })).status, 400);
  assert.equal((await request("/flat-a/quiz-generation", "POST", generateInput)).status, 422);
  assert.equal(aiCalls.length, 0);
});

test("repli sémantique sans axe discriminant si des produits ont un embedding, refus sinon", async () => {
  aiHandler = (_path, body) => {
    assert.equal(body.mode, "SEMANTIC");
    const quiz = validAiQuiz();
    quiz.questions.forEach((q) => q.answers.forEach((a) => { a.targetProductRefs = []; }));
    return generated(quiz);
  };
  const res = await request("/draft-a/quiz-generation", "POST", { ...generateInput, productIds: ["flat-1", "flat-2"] });
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.equal(body.mode, "SEMANTIC");
  assert.ok(body.warnings.some((w: string) => w.includes("similarité sémantique")));

  const refused = await request("/draft-a/quiz-generation", "POST", { ...generateInput, productIds: ["bare-1", "bare-2"] });
  assert.equal(refused.status, 422);
  assert.equal(aiCalls.length, 1);
});

test("sortie IA avec axe ou référence inventés : une relance avec retour d'erreurs, puis 502", async () => {
  const invalid = validAiQuiz();
  invalid.questions[0].answers[0].impacts = [{ axis: "aroma", value: 0.1 }];
  invalid.questions[1].answers[0].targetProductRefs = ["p9"];
  aiHandler = () => generated(invalid);

  const res = await request("/draft-a/quiz-generation", "POST", generateInput);
  assert.equal(res.status, 502);
  assert.equal(aiCalls.length, 2);
  assert.equal(aiCalls[0].body.feedback.length, 0);
  assert.ok(aiCalls[1].body.feedback.some((f: string) => f.includes("aroma")));
  assert.ok(aiCalls[1].body.feedback.some((f: string) => f.includes("p9")));
  assert.deepEqual(writes, []);
});

test("la relance aboutit quand la seconde réponse est valide", async () => {
  aiHandler = (_path, _body, call) => call === 1
    ? json(502, { detail: { code: "invalid_ai_output", message: "x", errors: ["questions manquantes"] } })
    : generated();
  const res = await request("/draft-a/quiz-generation", "POST", generateInput);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).generation.attempts, 2);
  assert.deepEqual(aiCalls[1].body.feedback, ["questions manquantes"]);
});

test("délai dépassé → 504, service indisponible ou non configuré → 503, sans relance", async () => {
  aiHandler = () => json(504, { detail: { code: "ai_timeout", message: "timeout" } });
  assert.equal((await request("/draft-a/quiz-generation", "POST", generateInput)).status, 504);
  aiHandler = () => { throw new TypeError("fetch failed"); };
  assert.equal((await request("/draft-a/quiz-generation", "POST", generateInput)).status, 503);
  aiHandler = () => json(503, { detail: { code: "ai_not_configured", message: "no key" } });
  assert.equal((await request("/draft-a/quiz-generation", "POST", generateInput)).status, 503);
  assert.equal(aiCalls.length, 3);
});

test("limitation : une génération à la fois (409) et quota horaire (429)", async () => {
  let release!: () => void;
  aiHandler = () => new Promise<Response>((resolve) => { release = () => resolve(generated()); });
  const first = request("/draft-a/quiz-generation", "POST", generateInput);
  while (!aiCalls.length) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await request("/draft-a/quiz-generation", "POST", generateInput)).status, 409);
  release();
  assert.equal((await first).status, 200);

  let clock = 0;
  const limiter = new GenerationLimiter(2, () => clock);
  limiter.acquire("t")();
  limiter.acquire("t")();
  assert.throws(() => limiter.acquire("t"), (err: Row) => err.status === 429);
  assert.doesNotThrow(() => limiter.acquire("other")());
  clock = 60 * 60 * 1000 + 1;
  assert.doesNotThrow(() => limiter.acquire("t")());
});

// ─── Aperçu ───────────────────────────────────────────────────────────────────

test("aperçu : un seul appel /recommend restreint aux produits du brouillon, sans écriture", async () => {
  aiHandler = (path) => {
    assert.equal(path, "/recommend");
    return json(200, {
      productId: "prod-2",
      explanation: ["Profil corsé"],
      profileSummary: { intensity: "élevé" },
      topN: [{ id: "prod-2", score: 0.9 }, { id: "prod-1", score: 0.4 }],
    });
  };
  const res = await request("/draft-a/quiz-generation/preview", "POST", { draft: manualDraft(), answers: [1, 1] });
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.equal(aiCalls.length, 1);
  const sent = aiCalls[0].body;
  assert.deepEqual(sent.productIds, ["prod-1", "prod-2"]);
  assert.equal(sent.tenantId, "tenant-a");
  assert.equal(sent.catalogId, "catalog-a");
  assert.deepEqual(sent.axes.map((axis: Row) => axis.key), ["intensity", "sweetness"]);
  // Profil calculé comme au /submit du widget : 0,5 + impacts, borné à [0, 1].
  assert.deepEqual(Object.keys(sent.profile).sort(), ["intensity", "sweetness"]);
  assert.equal(sent.profile.intensity, 1);
  assert.ok(Math.abs(sent.profile.sweetness - 0.1) < 1e-9);
  assert.deepEqual(body.recommendations.map((r: Row) => r.product.id), ["prod-2", "prod-1"]);
  assert.deepEqual(writes, []);
});

test("aperçu : réponses incomplètes refusées et recommandation hors sélection rejetée", async () => {
  assert.equal((await request("/draft-a/quiz-generation/preview", "POST", { draft: manualDraft(), answers: [0] })).status, 400);
  assert.equal((await request("/draft-a/quiz-generation/preview", "POST", { draft: manualDraft(), answers: [0, 5] })).status, 400);
  assert.equal(aiCalls.length, 0);
  aiHandler = () => json(200, { productId: "foreign-prod", explanation: [], profileSummary: {}, topN: [{ id: "foreign-prod", score: 1 }] });
  assert.equal((await request("/draft-a/quiz-generation/preview", "POST", { draft: manualDraft(), answers: [0, 0] })).status, 502);
});

// ─── Validation du brouillon modifié ──────────────────────────────────────────

test("brouillon modifié : ±1 accepté comme dans le builder, au-delà ou hors axes retenus refusé", async () => {
  aiHandler = () => json(200, { productId: "prod-1", explanation: [], profileSummary: {}, topN: [{ id: "prod-1", score: 1 }] });
  assert.equal((await request("/draft-a/quiz-generation/preview", "POST", { draft: manualDraft(), answers: [0, 0] })).status, 200);

  const tooStrong = manualDraft();
  tooStrong.questions[0].answers[0].impacts = { intensity: 1.5 };
  assert.equal((await request("/draft-a/quiz-generation/save", "POST", { draft: tooStrong, attachToCampaign: false })).status, 400);

  const notSelected = manualDraft();
  notSelected.questions[0].answers[0].impacts = { budget: 0.2 };
  assert.equal((await request("/draft-a/quiz-generation/save", "POST", { draft: notSelected, attachToCampaign: false })).status, 400);

  const invented = manualDraft();
  invented.questions[0].answers[0].impacts = { aroma: 0.2 };
  assert.equal((await request("/draft-a/quiz-generation/save", "POST", { draft: invented, attachToCampaign: false })).status, 400);

  const foreign = manualDraft({ productIds: ["prod-1", "foreign-prod"] });
  assert.equal((await request("/draft-a/quiz-generation/save", "POST", { draft: foreign, attachToCampaign: false })).status, 400);
  assert.deepEqual(writes, []);
});

// ─── Enregistrement ───────────────────────────────────────────────────────────

test("enregistrement : nouveau quiz inactif limité aux produits choisis, rattaché à la campagne en brouillon", async () => {
  const res = await request("/draft-a/quiz-generation/save", "POST", { draft: manualDraft(), attachToCampaign: true });
  assert.equal(res.status, 201, await res.clone().text());
  const body = await res.json();
  assert.equal(createdQuizzes.length, 1);
  const quiz = createdQuizzes[0];
  assert.equal(quiz.tenantId, "tenant-a");
  assert.equal(quiz.active, false);
  assert.equal(quiz.useAllProducts, false);
  assert.equal(quiz.industry, "café");
  assert.deepEqual(quiz.axes.map((axis: Row) => axis.key), ["intensity", "sweetness"]);
  assert.deepEqual(quiz.products.create, [{ productId: "prod-1" }, { productId: "prod-2" }]);
  assert.equal(quiz.catalogId, "catalog-a", "le quiz généré reste dans le catalogue du quiz de la campagne");
  assert.equal(body.questionCount, 2);
  assert.equal(body.answerCount, 4);
  assert.equal(body.attachedToCampaign, true);
  assert.equal(campaigns.find((c) => c.id === "draft-a")!.quizId, quiz.id);
  assert.ok(writes.indexOf("quiz.upsert") < writes.indexOf("quiz.create"), "le quiz par défaut est garanti avant la création");
});

test("enregistrement sans rattachement : la campagne en brouillon garde son quiz", async () => {
  const res = await request("/draft-a/quiz-generation/save", "POST", { draft: manualDraft(), attachToCampaign: false });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).attachedToCampaign, false);
  assert.equal(campaigns.find((c) => c.id === "draft-a")!.quizId, "coffee");
  assert.ok(!writes.includes("campaign.updateMany"));
});

test("campagnes programmées, actives ou suspendues : le quiz généré reste indépendant", async () => {
  for (const id of ["active-a", "scheduled-a", "paused-a"]) {
    const res = await request(`/${id}/quiz-generation/save`, "POST", { draft: manualDraft(), attachToCampaign: true });
    assert.equal(res.status, 201, id);
    const body = await res.json();
    assert.equal(body.attachedToCampaign, false, id);
    assert.match(body.attachMessage, /indépendant/);
    assert.equal(campaigns.find((c) => c.id === id)!.quizId, "coffee", id);
  }
  assert.ok(createdQuizzes.every((quiz) => quiz.active === false));
});

test("attachToCampaign doit être un booléen explicite", async () => {
  assert.equal((await request("/draft-a/quiz-generation/save", "POST", { draft: manualDraft() })).status, 400);
  assert.deepEqual(writes, []);
});

// ─── Multi-catalogue ──────────────────────────────────────────────────────────

test("multi-catalogue : contexte, génération, aperçu et enregistrement limités au catalogue du quiz", async () => {
  campaigns.push(campaignRow({ id: "trips-a", quizId: "trips" }));

  const context = await (await request("/draft-a/quiz-generation/context")).json();
  assert.deepEqual(context.catalog, { id: "catalog-a", name: "Catalogue principal" });
  const ids = context.products.map((p: Row) => p.id);
  assert.ok(!ids.includes("trip-1") && !ids.includes("trip-2"), "aucun produit d'un autre catalogue du tenant");

  const trips = await (await request("/trips-a/quiz-generation/context")).json();
  assert.deepEqual(trips.catalog, { id: "catalog-voyages", name: "Voyages" });
  assert.deepEqual(trips.products.map((p: Row) => p.id).sort(), ["trip-1", "trip-2"]);

  const mixed = await request("/draft-a/quiz-generation", "POST", { ...generateInput, productIds: ["prod-1", "trip-1"] });
  assert.equal(mixed.status, 400);
  assert.match((await mixed.json()).error, /catalogue du quiz/);
  assert.equal((await request("/draft-a/quiz-generation/preview", "POST", {
    draft: manualDraft({ productIds: ["prod-1", "trip-1"] }), answers: [0, 0],
  })).status, 400);
  assert.equal((await request("/draft-a/quiz-generation/save", "POST", {
    draft: manualDraft({ productIds: ["prod-1", "trip-1"] }), attachToCampaign: false,
  })).status, 400);
  assert.equal(aiCalls.length, 0);
  assert.deepEqual(writes, []);

  const saved = await request("/trips-a/quiz-generation/save", "POST", {
    draft: manualDraft({ productIds: ["trip-1", "trip-2"] }), attachToCampaign: false,
  });
  assert.equal(saved.status, 201, await saved.clone().text());
  assert.equal(createdQuizzes[0].catalogId, "catalog-voyages");
});
