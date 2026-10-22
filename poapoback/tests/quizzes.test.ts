import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { prisma } from "../src/lib/prisma";
import quizzesRouter from "../src/routes/quizzes";
import quizRouter from "../src/routes/quiz";
import builderRouter from "../src/routes/quizBuilder";
import embedRouter from "../src/routes/embed";
import { quizErrorHandler } from "../src/services/quizzes";

const DEFAULT_CATALOG = "catalog_tenant-a";
const catalogs = [
  { id: DEFAULT_CATALOG, tenantId: "tenant-a", name: "Catalogue principal", isDefault: true },
  { id: "catalog-voyages", tenantId: "tenant-a", name: "Voyages", isDefault: false },
  { id: "catalog-b", tenantId: "tenant-b", name: "Catalogue B", isDefault: true },
];
const products = [
  { id: "coffee-product", tenantId: "tenant-a", catalogId: DEFAULT_CATALOG },
  { id: "trip-product", tenantId: "tenant-a", catalogId: "catalog-voyages" },
  { id: "foreign-product", tenantId: "tenant-b", catalogId: "catalog-b" },
];
const defaultQuiz = {
  id: "default_tenant-a", tenantId: "tenant-a", catalogId: DEFAULT_CATALOG, name: "Historique", industry: "",
  axes: [] as unknown[], quizTitle: "Mon quiz", ctaText: "Acheter", active: true, isDefault: true, useAllProducts: true,
  products: [], createdAt: new Date(), updatedAt: new Date(),
};
const coffeeQuiz = {
  ...defaultQuiz, id: "coffee", name: "Mon café", industry: "Café", quizTitle: "Mon café",
  axes: [{ key: "body", label: "Corps", lowLabel: "Léger", highLabel: "Corsé" }] as unknown[],
  isDefault: false, useAllProducts: false, products: [{ productId: "coffee-product" }],
};
let server: Server;
let base: string;
let savedQuestion: unknown;
let savedMetric: unknown;
let lastQuestionWhere: unknown;
let lastQuizListWhere: unknown;
let lastProductFindFirstWhere: unknown;
const writes: string[] = [];
let aiPayload: Record<string, unknown>;
let recommendedId = "coffee-product";
const metricScopes: { tenantId?: string; quizId?: string }[] = [];
const originalFetch = globalThis.fetch;
const restores: (() => void)[] = [];

function stub<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const previous = target[key];
  target[key] = value;
  restores.push(() => { target[key] = previous; });
}

before(async () => {
  process.env.JWT_SECRET = "multi-quiz-tests-only";
  process.env.AI_SERVICE_URL = "http://ai.test";
  stub(prisma.tenant, "findUnique", (async () => ({
    id: "tenant-a", industry: "", active: true, quizTitle: "Mon quiz", ctaText: "Acheter",
  })) as typeof prisma.tenant.findUnique);
  stub(prisma.quiz, "upsert", (async () => defaultQuiz) as typeof prisma.quiz.upsert);
  stub(prisma.quiz, "findUnique", (async ({ where }: { where: { id: string } }) =>
    where.id === defaultQuiz.id ? defaultQuiz : null
  ) as typeof prisma.quiz.findUnique);
  stub(prisma.catalog, "findFirst", (async ({ where }: { where: { id?: string; tenantId: string; isDefault?: boolean } }) =>
    catalogs.find((catalog) => catalog.tenantId === where.tenantId &&
      (where.id === undefined || catalog.id === where.id) &&
      (where.isDefault === undefined || catalog.isDefault === where.isDefault)) ?? null
  ) as unknown as typeof prisma.catalog.findFirst);
  stub(prisma.catalog, "upsert", (async () => catalogs[0]) as unknown as typeof prisma.catalog.upsert);
  stub(prisma, "$transaction", (async (fn: (tx: typeof prisma) => unknown) => fn(prisma)) as unknown as typeof prisma.$transaction);
  stub(prisma.quizProduct, "deleteMany", (async () => {
    writes.push("quizProduct.deleteMany");
    return { count: 1 };
  }) as unknown as typeof prisma.quizProduct.deleteMany);
  stub(prisma.quiz, "findFirst", (async ({ where }: { where: { id: string; tenantId: string } }) =>
    where.tenantId === "tenant-a" && where.id === "coffee" ? coffeeQuiz : null
  ) as typeof prisma.quiz.findFirst);
  stub(prisma.quiz, "findMany", (async ({ where }: { where: unknown }) => {
    lastQuizListWhere = where;
    return [defaultQuiz, coffeeQuiz];
  }) as typeof prisma.quiz.findMany);
  stub(prisma.quiz, "create", (async ({ data }: { data: Record<string, unknown> }) => ({
    ...coffeeQuiz, ...data, id: "new-quiz",
  })) as typeof prisma.quiz.create);
  stub(prisma.quiz, "update", (async ({ data }: { data: Record<string, unknown> }) => {
    writes.push("quiz.update");
    return { ...coffeeQuiz, ...data };
  }) as typeof prisma.quiz.update);
  stub(prisma.question, "findMany", (async ({ where }: { where: unknown }) => {
    lastQuestionWhere = where;
    return [];
  }) as typeof prisma.question.findMany);
  stub(prisma.question, "aggregate", (async () => ({ _max: { order: 0 } })) as typeof prisma.question.aggregate);
  stub(prisma.question, "create", (async ({ data }: { data: unknown }) => {
    savedQuestion = data;
    return data;
  }) as typeof prisma.question.create);
  stub(prisma.question, "findFirst", (async () => null) as typeof prisma.question.findFirst);
  stub(prisma.answer, "findFirst", (async () => null) as typeof prisma.answer.findFirst);
  stub(prisma.answer, "findMany", (async () => [{
    id: "answer-coffee", questionId: "question-coffee", impacts: { body: 0.2, removedAxis: 0.4 },
    question: { type: "single" },
  }]) as typeof prisma.answer.findMany);
  stub(prisma.product, "findMany", (async ({ where }: { where: { tenantId: string; id: { in: string[] } } }) =>
    products
      .filter((product) => product.tenantId === where.tenantId && where.id.in.includes(product.id))
      .map(({ id, catalogId }) => ({ id, catalogId }))
  ) as unknown as typeof prisma.product.findMany);
  stub(prisma.product, "findFirst", (async ({ where }: { where: { id: string; catalogId?: string } }) => {
    lastProductFindFirstWhere = where;
    const product = products.find((item) => item.id === where.id && (!where.catalogId || item.catalogId === where.catalogId));
    return product ? { id: product.id } : null;
  }) as unknown as typeof prisma.product.findFirst);
  stub(prisma.metric, "create", (async ({ data }: { data: unknown }) => {
    savedMetric = data;
    return data;
  }) as typeof prisma.metric.create);
  stub(prisma.quizSession, "create", (async () => ({ id: "session-coffee" })) as typeof prisma.quizSession.create);
  stub(prisma.metric, "count", (async ({ where }: { where: { quizId?: string } }) => {
    metricScopes.push(where);
    return 2;
  }) as typeof prisma.metric.count);
  stub(prisma.metric, "findMany", (async ({ where }: { where: { quizId?: string } }) => {
    metricScopes.push(where);
    return [];
  }) as typeof prisma.metric.findMany);
  stub(prisma.quizSession, "groupBy", (async ({ where }: { where: { quizId?: string } }) => {
    metricScopes.push(where);
    return [];
  }) as typeof prisma.quizSession.groupBy);
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("http://ai.test")) {
      aiPayload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ productId: recommendedId, explanation: [], profileSummary: {} }));
    }
    return originalFetch(url, init);
  };
  const app = express();
  app.use(express.json());
  app.use("/api/quizzes", quizzesRouter);
  app.use("/api/quiz/builder", builderRouter);
  app.use("/api/quiz", quizRouter);
  app.use("/api/embed", embedRouter);
  app.use(quizErrorHandler);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  for (const restore of restores.reverse()) restore();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await prisma.$disconnect();
});

async function request(path: string, method = "GET", body?: unknown, token: Record<string, unknown> = { tenantId: "tenant-a", email: "test@example.test" }) {
  return originalFetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt.sign(token, process.env.JWT_SECRET!)}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("legacy clientId resolves the historical default quiz", async () => {
  const res = await request("/api/embed/config?clientId=tenant-a");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).quizId, defaultQuiz.id);
});

test("explicit quiz controls configuration and question scope", async () => {
  const res = await request("/api/embed/config?clientId=tenant-a&quizId=coffee");
  assert.equal(res.status, 200);
  const config = await res.json();
  assert.equal(config.industry, "Café");
  assert.deepEqual(config.axes, coffeeQuiz.axes);
  assert.equal((await request("/api/quiz/questions?clientId=tenant-a&quizId=coffee")).status, 200);
  assert.deepEqual(lastQuestionWhere, { tenantId: "tenant-a", quizId: "coffee", active: true });
});

test("unknown or foreign quiz never falls back to default", async () => {
  assert.equal((await request("/api/embed/config?clientId=tenant-a&quizId=foreign")).status, 404);
  assert.equal((await request("/api/quiz/builder/questions?quizId=foreign")).status, 404);
});

test("list includes independent quizzes", async () => {
  const res = await request("/api/quizzes");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).length, 2);
});

test("builder creates within selected quiz and blocks foreign conditions", async () => {
  const res = await request("/api/quiz/builder/questions?quizId=coffee", "POST", { text: "Quel café ?" });
  assert.equal(res.status, 201);
  assert.equal((savedQuestion as { quizId: string }).quizId, "coffee");
  const invalid = await request("/api/quiz/builder/questions?quizId=coffee", "POST", {
    text: "Question", conditionAnswerId: "answer-in-other-quiz",
  });
  assert.equal(invalid.status, 400);
});

test("builder cannot modify a question in a different quiz", async () => {
  const res = await request("/api/quiz/builder/questions/foreign-question?quizId=coffee", "PUT", { text: "Changed" });
  assert.equal(res.status, 404);
});

test("tracking persists quiz identity", async () => {
  const res = await request("/api/quiz/track", "POST", {
    clientId: "tenant-a", quizId: "coffee", type: "quiz_start", payload: { abVariant: "B" },
  });
  assert.equal(res.status, 200);
  assert.equal((savedMetric as { quizId: string }).quizId, "coffee");
});

test("submit validates answer/question association and duplicate answers", async () => {
  for (const answers of [
    [{ questionId: "wrong", answerId: "answer-coffee" }],
    [{ questionId: "question-coffee", answerId: "answer-coffee" }, { questionId: "question-coffee", answerId: "answer-coffee" }],
  ]) {
    const res = await request("/api/quiz/submit", "POST", { clientId: "tenant-a", quizId: "coffee", answers });
    assert.equal(res.status, 400);
  }
});

test("recommendation sends the quiz axes, selected products and an axis-only profile to AI", async () => {
  const res = await request("/api/quiz/submit", "POST", {
    clientId: "tenant-a", quizId: "coffee",
    answers: [{ questionId: "question-coffee", answerId: "answer-coffee" }],
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).quizId, "coffee");
  assert.deepEqual(aiPayload.productIds, ["coffee-product"]);
  assert.equal(aiPayload.industry, "Café");
  assert.deepEqual(aiPayload.axes, coffeeQuiz.axes);
  assert.deepEqual(aiPayload.profile, { body: 0.7 });
});

test("quiz settings reject invalid activities, axes and foreign product selections", async () => {
  assert.equal((await request("/api/quizzes", "POST", { name: "X", industry: 42 })).status, 400);
  for (const axes of [
    [{ key: "1bad", label: "Mauvaise clé" }],
    [{ key: "body", label: "Corps" }, { key: "body", label: "Doublon" }],
    [{ key: "body", label: " " }],
    "body",
  ]) {
    assert.equal((await request("/api/quizzes", "POST", { name: "X", axes })).status, 400);
  }
  assert.equal((await request("/api/quizzes", "POST", {
    name: "X", industry: "Café", useAllProducts: false, productIds: ["foreign-product"],
  })).status, 400);
});

test("create, read and disable a quiz without modifying the default", async () => {
  const created = await request("/api/quizzes", "POST", {
    name: "Campagne café", industry: " Café ", useAllProducts: false, productIds: ["coffee-product"],
    axes: [{ key: "acidity", label: " Acidité ", highLabel: "Vive" }],
  });
  assert.equal(created.status, 201);
  const data = await created.json();
  assert.equal(data.quizTitle, "Trouve ton produit idéal");
  assert.equal(data.industry, "Café");
  assert.deepEqual(data.axes, [{ key: "acidity", label: "Acidité", lowLabel: null, highLabel: "Vive" }]);
  assert.equal(data.useAllProducts, false);
  assert.deepEqual(data.products.create, [{ productId: "coffee-product" }]);
  assert.equal((await request("/api/quizzes/coffee")).status, 200);
  const updated = await request("/api/quizzes/coffee", "PUT", { active: false });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).active, false);
  assert.equal(defaultQuiz.active, true);
});

test("super-admin creates quizzes for the tenant sharing its email", async () => {
  const created = await request("/api/quizzes", "POST", { name: "Campagne admin" }, {
    tenantId: "super-admin", email: "test@example.test", isSuperAdmin: true,
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).tenantId, "tenant-a");
});

test("disabled quiz cannot be opened or tracked", async () => {
  coffeeQuiz.active = false;
  try {
    assert.equal((await request("/api/embed/config?clientId=tenant-a&quizId=coffee")).status, 403);
    assert.equal((await request("/api/quiz/track", "POST", {
      clientId: "tenant-a", quizId: "coffee", type: "quiz_start",
    })).status, 403);
  } finally {
    coffeeQuiz.active = true;
  }
});

test("empty product selection and out-of-selection AI result are rejected", async () => {
  const products = coffeeQuiz.products;
  const body = {
    clientId: "tenant-a", quizId: "coffee",
    answers: [{ questionId: "question-coffee", answerId: "answer-coffee" }],
  };
  coffeeQuiz.products = [];
  try {
    assert.equal((await request("/api/quiz/submit", "POST", body)).status, 422);
  } finally {
    coffeeQuiz.products = products;
  }
  recommendedId = "foreign-product";
  try {
    assert.equal((await request("/api/quiz/submit", "POST", body)).status, 502);
  } finally {
    recommendedId = "coffee-product";
  }
});

test("metrics and AI insights query only the selected quiz", async () => {
  metricScopes.length = 0;
  for (const endpoint of ["/api/quiz/metrics", "/api/quiz/metrics/ai-insights"]) {
    const res = await request(`${endpoint}?quizId=coffee`);
    assert.equal(res.status, 200);
  }
  assert.ok(metricScopes.length > 10);
  assert.ok(metricScopes.every((where) => where.tenantId === "tenant-a" && where.quizId === "coffee"));
});

test("question reorder route is reachable and rejects foreign questions", async () => {
  const res = await request("/api/quiz/builder/questions/reorder?quizId=coffee", "PUT", {
    order: [{ id: "foreign-question", order: 0 }],
  });
  assert.equal(res.status, 403);
});

test("multi-catalogue : sans catalogId, le quiz est créé dans le catalogue par défaut", async () => {
  const created = await request("/api/quizzes", "POST", { name: "Sans catalogue" });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).catalogId, DEFAULT_CATALOG);
});

test("multi-catalogue : la sélection d'un quiz est limitée aux produits de son catalogue", async () => {
  const mixed = await request("/api/quizzes", "POST", {
    name: "Voyages", catalogId: "catalog-voyages", useAllProducts: false, productIds: ["coffee-product"],
  });
  assert.equal(mixed.status, 400);
  assert.match((await mixed.json()).error, /catalogue de ce quiz/);

  const created = await request("/api/quizzes", "POST", {
    name: "Voyages", catalogId: "catalog-voyages", useAllProducts: false, productIds: ["trip-product", "trip-product"],
  });
  assert.equal(created.status, 201);
  const data = await created.json();
  assert.equal(data.catalogId, "catalog-voyages");
  assert.deepEqual(data.products.create, [{ productId: "trip-product" }]);
});

test("multi-catalogue : catalogue d'un autre tenant introuvable, catalogId invalide refusé", async () => {
  assert.equal((await request("/api/quizzes", "POST", { name: "X", catalogId: "catalog-b" })).status, 404);
  assert.equal((await request("/api/quizzes", "POST", { name: "X", catalogId: 42 })).status, 400);
  assert.equal((await request("/api/quizzes/coffee", "PUT", { catalogId: "catalog-b", productIds: [] })).status, 404);
});

test("multi-catalogue : la liste des quiz se filtre par catalogue, toujours dans le tenant", async () => {
  assert.equal((await request("/api/quizzes?catalogId=catalog-voyages")).status, 200);
  assert.deepEqual(lastQuizListWhere, { tenantId: "tenant-a", catalogId: "catalog-voyages" });
  assert.equal((await request("/api/quizzes")).status, 200);
  assert.deepEqual(lastQuizListWhere, { tenantId: "tenant-a" });
});

test("multi-catalogue : changer le catalogue d'un quiz exige une nouvelle sélection", async () => {
  const refused = await request("/api/quizzes/coffee", "PUT", { catalogId: "catalog-voyages" });
  assert.equal(refused.status, 409);

  assert.equal((await request("/api/quizzes/coffee", "PUT", {
    catalogId: "catalog-voyages", productIds: ["coffee-product"],
  })).status, 400);

  writes.length = 0;
  const moved = await request("/api/quizzes/coffee", "PUT", { catalogId: "catalog-voyages", productIds: ["trip-product"] });
  assert.equal(moved.status, 200);
  const data = await moved.json();
  assert.equal(data.catalogId, "catalog-voyages");
  assert.deepEqual(data.products.create, [{ productId: "trip-product" }]);
  assert.deepEqual(writes, ["quizProduct.deleteMany", "quiz.update"], "l'ancienne sélection est retirée avant le changement");
});

test("multi-catalogue : /submit limite le moteur et le produit recommandé au catalogue du quiz", async () => {
  const res = await request("/api/quiz/submit", "POST", {
    clientId: "tenant-a", quizId: "coffee",
    answers: [{ questionId: "question-coffee", answerId: "answer-coffee" }],
  });
  assert.equal(res.status, 200);
  assert.equal(aiPayload.catalogId, DEFAULT_CATALOG);
  assert.equal((lastProductFindFirstWhere as { catalogId: string }).catalogId, DEFAULT_CATALOG);
});
