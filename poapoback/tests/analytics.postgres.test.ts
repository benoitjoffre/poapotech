import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import type { QuizMetricsResponse } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import quizRouter from "../src/routes/quiz";
import { quizErrorHandler } from "../src/services/quizzes";
import { signFeedbackToken } from "../src/services/analyticsEvents";

test("PostgreSQL : agrégats métriques, abandons fiables/anciens, feedback et isolation tenant", {
  skip: process.env.POAPO_TEST_ANALYTICS_DB !== "1",
}, async () => {
  const id = `analytics-${randomUUID()}`;
  const other = `${id}-other`;
  const secret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "analytics-db-test-only";
  let server: Server | undefined;
  try {
    for (const tenantId of [id, other]) await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test`, name: tenantId } });
    const catalogs = await Promise.all([id, other].map((tenantId) => prisma.catalog.create({ data: { tenantId, name: "Principal" } })));
    const [quiz, foreign] = await Promise.all([id, other].map((tenantId, index) => prisma.quiz.create({
      data: { tenantId, catalogId: catalogs[index].id, name: "Quiz", quizTitle: "Titre", ctaText: "Voir", active: true },
    })));
    const product = await prisma.product.create({ data: { tenantId: id, catalogId: catalogs[0].id, name: "Produit", tags: [] } });
    const metric = (tenantId: string, quizId: string, type: "quiz_start" | "quiz_complete" | "quiz_abandon" | "step_view" | "step_answer" | "buy_click", payload: object) =>
      ({ tenantId, quizId, type, payload });
    await prisma.metric.createMany({ data: [
      metric(id, quiz.id, "quiz_start", { abVariant: "A" }), metric(id, quiz.id, "quiz_start", { abVariant: "A" }),
      metric(id, quiz.id, "quiz_start", {}), metric(id, quiz.id, "quiz_complete", { abVariant: "A" }),
      metric(id, quiz.id, "step_view", { step: "q1", stepIndex: 0, questionId: "q1" }),
      metric(id, quiz.id, "step_view", { step: "q1", stepIndex: 0, questionId: "q1" }),
      metric(id, quiz.id, "step_answer", { step: "q1", questionId: "q1", answerId: "a1" }),
      metric(id, quiz.id, "quiz_abandon", { stepIndex: 1, at: "2026-01-01T00:00:00Z" }),
      metric(id, quiz.id, "quiz_abandon", { stepIndex: 1, reason: "pagehide" }),
      metric(id, quiz.id, "buy_click", { productId: product.id, abVariant: "A" }),
      metric(other, foreign.id, "quiz_start", { abVariant: "Z" }), metric(other, foreign.id, "step_view", { step: "q9" }),
    ] });
    await prisma.quizSession.create({ data: { tenantId: id, quizId: quiz.id, answers: [], resultProductId: product.id, completedAt: new Date() } });

    const app = express();
    app.use(express.json());
    app.use("/api/quiz", quizRouter);
    app.use(quizErrorHandler);
    server = await new Promise<Server>((resolve) => { const l = app.listen(0, "127.0.0.1", () => resolve(l)); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/quiz`;
    const auth = (tenantId: string) => ({ Authorization: `Bearer ${jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET!)}` });

    const res = await fetch(`${url}/metrics?quizId=${quiz.id}`, { headers: auth(id) });
    assert.equal(res.status, 200, await res.clone().text());
    const data = await res.json() as QuizMetricsResponse;
    assert.deepEqual(data.steps, [{ step: "q1", views: 2, answers: 1, dropOffRate: 50 }]);
    assert.deepEqual(data.variants.map((v) => [v.variant, v.started, v.completed, v.clicks]), [["A", 2, 1, 1], ["standard", 1, 0, 0]]);
    assert.equal(data.funnel.abandoned, 1);
    assert.equal(data.funnel.legacyAbandonEvents, 1);
    assert.equal(data.indicators?.recommendations, 1);
    assert.equal(data.indicators?.completionRate.value, 33.3);
    assert.equal(data.indicators?.clicksPer100Recommendations.reliable, false);

    // Isolation : le quiz d'un autre tenant est introuvable, ses événements ne fuient pas.
    assert.equal((await fetch(`${url}/metrics?quizId=${foreign.id}`, { headers: auth(id) })).status, 404);
    const foreignData = await (await fetch(`${url}/metrics?quizId=${foreign.id}`, { headers: auth(other) })).json() as QuizMetricsResponse;
    assert.deepEqual(foreignData.steps.map((s) => s.step), ["q9"]);
    assert.deepEqual(foreignData.variants.map((v) => v.variant), ["Z"]);

    // Feedback : jeton requis et lié au tenant + quiz + session.
    const session = await prisma.quizSession.findFirstOrThrow({ where: { tenantId: id } });
    const feedback = (body: object) => fetch(`${url}/feedback`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: id, quizId: quiz.id, sessionId: session.id, feedback: "positive", ...body }),
    });
    assert.equal((await feedback({})).status, 403);
    assert.equal((await feedback({ feedbackToken: signFeedbackToken(session.id, other, quiz.id) })).status, 403);
    assert.equal((await prisma.quizSession.findUniqueOrThrow({ where: { id: session.id } })).feedback, null);
    assert.equal((await feedback({ feedbackToken: signFeedbackToken(session.id, id, quiz.id), reasons: ["prix"] })).status, 200);
    assert.equal((await prisma.quizSession.findUniqueOrThrow({ where: { id: session.id } })).feedback, "positive");

    // Track : écriture validée dans le bon tenant/quiz uniquement.
    const before = await prisma.metric.count({ where: { tenantId: id } });
    const track = (body: object) => fetch(`${url}/track`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: id, quizId: quiz.id, ...body }),
    });
    assert.equal((await track({ type: "step_view", payload: { huge: "x".repeat(5000) } })).status, 400);
    assert.equal((await track({ type: "quiz_abandon", payload: { stepIndex: 2, reason: "unmount", abVariant: "A" } })).status, 200);
    assert.equal(await prisma.metric.count({ where: { tenantId: id } }), before + 1);
    assert.equal((await fetch(`${url}/track`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: id, quizId: foreign.id, type: "quiz_start" }),
    })).status, 404);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve()));
    await prisma.tenant.deleteMany({ where: { id: { in: [id, other] } } });
    await prisma.$disconnect();
    if (secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = secret;
  }
});
