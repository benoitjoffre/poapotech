import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import type { QuizEditorDraftResponse, QuizResult } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import quizzesRouter from "../src/routes/quizzes";
import quizRouter from "../src/routes/quiz";
import { quizErrorHandler } from "../src/services/quizzes";

test("PostgreSQL + Python : aperçu sans écritures, catalogue local et parité publique", {
  skip: process.env.POAPO_TEST_PREVIEW_ENGINE !== "1",
}, async () => {
  const id = `preview-engine-${randomUUID()}`;
  let server: Server | undefined;
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "preview-engine-test";
  try {
    await prisma.tenant.create({ data: { id, email: `${id}@example.test` } });
    const catalog = await prisma.catalog.create({ data: { tenantId: id, name: "Odyssey test" } });
    const otherCatalog = await prisma.catalog.create({ data: { tenantId: id, name: "Autre catalogue" } });
    const product = await prisma.product.create({ data: {
      tenantId: id, catalogId: catalog.id, name: "Voyage calme", tags: [], attributes: { pace: 0.3 },
    } });
    const otherProduct = await prisma.product.create({ data: {
      tenantId: id, catalogId: otherCatalog.id, name: "Autre voyage", tags: [], attributes: { pace: 0.3 },
    } });
    const quiz = await prisma.quiz.create({ data: {
      tenantId: id, catalogId: catalog.id, name: "Voyage", quizTitle: "Votre voyage", ctaText: "Découvrir",
      axes: [{ key: "pace", label: "Rythme", lowLabel: "Calme", highLabel: "Intense" }],
      useAllProducts: false, products: { create: { productId: product.id } },
    } });
    const question = await prisma.question.create({ data: {
      tenantId: id, quizId: quiz.id, text: "Votre rythme ?", order: 0,
      answers: { create: { text: "Calme", order: 0, impacts: { pace: -0.2 } } },
    }, include: { answers: true } });
    const app = express();
    app.use(express.json());
    app.use("/api/quizzes", quizzesRouter);
    app.use("/api/quiz", quizRouter);
    app.use(quizErrorHandler);
    server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const token = jwt.sign({ tenantId: id, email: `${id}@example.test` }, process.env.JWT_SECRET!);
    const request = (path: string, body?: unknown, authorization: string | null = token) => fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(authorization && { Authorization: `Bearer ${authorization}` }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const prefix = `/api/quizzes/${quiz.id}`;
    const initial = await request(prefix + "/draft");
    assert.equal(initial.status, 200);
    const { draft } = await initial.json() as QuizEditorDraftResponse;
    const answers = [{ questionId: question.id, answerId: question.answers[0].id }];
    const snapshot = async () => ({
      sessions: await prisma.quizSession.count({ where: { tenantId: id } }),
      metrics: await prisma.metric.count({ where: { tenantId: id } }),
      drafts: await prisma.quizEditorDraft.findMany({ where: { tenantId: id } }),
      quiz: await prisma.quiz.findUnique({ where: { id: quiz.id }, include: { products: true, questions: { include: { answers: true } } } }),
    });
    const before = await snapshot();
    draft.theme = { primaryColor: "#123456", bodyFont: "georgia" };
    assert.equal((await request(prefix + "/preview", { draft }, null)).status, 401);
    const foreign = jwt.sign({ tenantId: "foreign", email: "foreign@example.test" }, process.env.JWT_SECRET!);
    assert.equal((await request(prefix + "/preview", { draft }, foreign)).status, 404);
    const prepared = await request(prefix + "/preview", { draft });
    assert.equal(prepared.status, 200);
    assert.deepEqual((await prepared.json()).draft.theme, draft.theme);
    const preview = await request(prefix + "/preview/recommendations", { draft, answers });
    assert.equal(preview.status, 200, await preview.clone().text());
    const previewResult = await preview.json() as QuizResult;
    assert.equal(previewResult.product.id, product.id);
    assert.deepEqual(await snapshot(), before);
    const publicResponse = await request("/api/quiz/submit", { clientId: id, quizId: quiz.id, answers });
    assert.equal(publicResponse.status, 200, await publicResponse.clone().text());
    const { sessionId, feedbackToken, ...publicResult } = await publicResponse.json();
    assert.ok(sessionId && feedbackToken);
    assert.deepEqual(publicResult, previewResult);
    assert.equal(await prisma.quizSession.count({ where: { tenantId: id } }), 1);
    assert.equal(await prisma.metric.count({ where: { tenantId: id } }), 0);
    await prisma.quiz.update({ where: { id: quiz.id }, data: { active: false } });
    const inactiveBefore = await snapshot();
    assert.equal((await request(prefix + "/preview/recommendations", { draft, answers })).status, 200);
    assert.deepEqual(await snapshot(), inactiveBefore);
    // A local catalogue switch and product selection never cross the server-validated scope.
    draft.config.catalogId = otherCatalog.id;
    draft.config.productIds = [otherProduct.id];
    const switched = await request(prefix + "/preview/recommendations", { draft, answers });
    assert.equal(switched.status, 200, await switched.clone().text());
    assert.equal((await switched.json()).product.id, otherProduct.id);
    assert.deepEqual(await snapshot(), inactiveBefore);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((e) => e ? reject(e) : resolve()));
    await prisma.tenant.deleteMany({ where: { id } });
    await prisma.$disconnect();
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});
