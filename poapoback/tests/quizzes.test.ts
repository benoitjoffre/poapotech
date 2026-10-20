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

const defaultQuiz = {
  id: "default_tenant-a", tenantId: "tenant-a", name: "Historique", industry: "perfume",
  quizTitle: "Mon parfum", ctaText: "Acheter", active: true, isDefault: true, useAllProducts: true,
  products: [], createdAt: new Date(), updatedAt: new Date(),
};
const coffeeQuiz = {
  ...defaultQuiz, id: "coffee", name: "Mon café", industry: "coffee", quizTitle: "Mon café",
  isDefault: false, useAllProducts: false, products: [{ productId: "coffee-product" }],
};
let server: Server;
let base: string;
let savedQuestion: unknown;
let savedMetric: unknown;
let lastQuestionWhere: unknown;
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
    id: "tenant-a", industry: "perfume", active: true, quizTitle: "Mon parfum", ctaText: "Acheter",
  })) as typeof prisma.tenant.findUnique);
  stub(prisma.quiz, "upsert", (async () => defaultQuiz) as typeof prisma.quiz.upsert);
  stub(prisma.quiz, "findFirst", (async ({ where }: { where: { id: string; tenantId: string } }) =>
    where.tenantId === "tenant-a" && where.id === "coffee" ? coffeeQuiz : null
  ) as typeof prisma.quiz.findFirst);
  stub(prisma.quiz, "findMany", (async () => [defaultQuiz, coffeeQuiz]) as typeof prisma.quiz.findMany);
  stub(prisma.quiz, "create", (async ({ data }: { data: Record<string, unknown> }) => ({
    ...coffeeQuiz, ...data, id: "new-quiz",
  })) as typeof prisma.quiz.create);
  stub(prisma.quiz, "update", (async ({ data }: { data: Record<string, unknown> }) => ({
    ...coffeeQuiz, ...data,
  })) as typeof prisma.quiz.update);
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
    id: "answer-coffee", questionId: "question-coffee", impacts: { body: 0.2 },
    question: { type: "single" },
  }]) as typeof prisma.answer.findMany);
  stub(prisma.product, "findMany", (async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.includes("coffee-product") ? [{ id: "coffee-product" }] : []
  ) as typeof prisma.product.findMany);
  stub(prisma.product, "findFirst", (async ({ where }: { where: { id: string } }) =>
    where.id === "coffee-product" ? { id: "coffee-product" } : null
  ) as typeof prisma.product.findFirst);
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

async function request(path: string, method = "GET", body?: unknown) {
  return originalFetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt.sign({ tenantId: "tenant-a", email: "test@example.test" }, process.env.JWT_SECRET!)}`,
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
  assert.equal((await res.json()).industry, "coffee");
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

test("coffee recommendation passes selected product IDs to AI", async () => {
  const res = await request("/api/quiz/submit", "POST", {
    clientId: "tenant-a", quizId: "coffee",
    answers: [{ questionId: "question-coffee", answerId: "answer-coffee" }],
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).quizId, "coffee");
  assert.deepEqual(aiPayload.productIds, ["coffee-product"]);
  assert.equal(aiPayload.industry, "coffee");
});

test("quiz settings reject invalid sectors and foreign product selections", async () => {
  assert.equal((await request("/api/quizzes", "POST", { name: "X", industry: "invalid" })).status, 400);
  assert.equal((await request("/api/quizzes", "POST", {
    name: "X", industry: "coffee", useAllProducts: false, productIds: ["foreign-product"],
  })).status, 400);
});

test("create, read and disable a quiz without modifying the default", async () => {
  const created = await request("/api/quizzes", "POST", {
    name: "Campagne café", industry: "coffee", useAllProducts: false, productIds: ["coffee-product"],
  });
  assert.equal(created.status, 201);
  const data = await created.json();
  assert.equal(data.quizTitle, "Trouve ton café idéal");
  assert.equal(data.useAllProducts, false);
  assert.deepEqual(data.products.create, [{ productId: "coffee-product" }]);
  assert.equal((await request("/api/quizzes/coffee")).status, 200);
  const updated = await request("/api/quizzes/coffee", "PUT", { active: false });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).active, false);
  assert.equal(defaultQuiz.active, true);
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
