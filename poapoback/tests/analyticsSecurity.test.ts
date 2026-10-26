import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { prisma } from "../src/lib/prisma";
import quizRouter from "../src/routes/quiz";
import metricsRouter from "../src/routes/metrics";
import { quizErrorHandler } from "../src/services/quizzes";
import { signFeedbackToken, validateTrackEvent } from "../src/services/analyticsEvents";
import { buildSteps, buildVariants, computeIndicators } from "../src/services/quizMetrics";
import { createAbandonTracker, type AbandonPayload } from "../../poapofront/src/lib/abandonTracker";

const quizzes = [
  { id: "quiz-a", tenantId: "tenant-a", active: true },
  { id: "quiz-a2", tenantId: "tenant-a", active: true },
  { id: "quiz-b", tenantId: "tenant-b", active: true },
];
const sessions = [
  { id: "session-a", tenantId: "tenant-a", quizId: "quiz-a", feedback: null as string | null },
  { id: "session-b", tenantId: "tenant-b", quizId: "quiz-b", feedback: null as string | null },
];
const created: unknown[] = [];
let countCalls = 0;
let server: Server;
let base: string;
const restores: (() => void)[] = [];
const originalSecret = process.env.JWT_SECRET;

function stub<T extends object>(target: T, key: keyof T, implementation: unknown) {
  const previous = target[key];
  assert.ok(Reflect.set(target, key, implementation));
  restores.push(() => { Reflect.set(target, key, previous); });
}

before(async () => {
  process.env.JWT_SECRET = "analytics-security-tests";
  stub(prisma.quiz, "findFirst", async ({ where }: { where: { id: string; tenantId: string } }) =>
    quizzes.find((quiz) => quiz.id === where.id && quiz.tenantId === where.tenantId) ?? null);
  stub(prisma.tenant, "findUnique", async () => ({ active: true }));
  stub(prisma.metric, "create", async ({ data }: { data: unknown }) => { created.push(data); return data; });
  stub(prisma.metric, "count", async () => { countCalls++; return 7; });
  stub(prisma.metric, "groupBy", async () => [{ tenantId: "tenant-b", _count: 7 }]);
  stub(prisma.quizSession, "updateMany", async ({ where, data }: { where: { id: string; tenantId: string; quizId: string }; data: { feedback: string } }) => {
    const hit = sessions.filter((s) => s.id === where.id && s.tenantId === where.tenantId && s.quizId === where.quizId);
    hit.forEach((s) => { s.feedback = data.feedback; });
    return { count: hit.length };
  });
  const app = express();
  app.use(express.json());
  app.use("/api/quiz", quizRouter);
  app.use("/api/metrics", metricsRouter);
  app.use(quizErrorHandler);
  server = await new Promise<Server>((resolve) => { const l = app.listen(0, "127.0.0.1", () => resolve(l)); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  for (const restore of restores.reverse()) restore();
  process.env.JWT_SECRET = originalSecret;
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await prisma.$disconnect();
});

const post = (path: string, body: unknown) => fetch(`${base}${path}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const bearer = (claims: Record<string, unknown>) => ({ Authorization: `Bearer ${jwt.sign(claims, process.env.JWT_SECRET!)}` });

test("/api/metrics/count : réservé au super-admin", async () => {
  assert.equal((await fetch(`${base}/api/metrics/count`)).status, 401);
  const merchant = await fetch(`${base}/api/metrics/count`, { headers: bearer({ tenantId: "tenant-a", email: "a@example.test" }) });
  assert.equal(merchant.status, 403);
  assert.equal(countCalls, 0);
  const admin = await fetch(`${base}/api/metrics/count`, { headers: bearer({ tenantId: "super-admin", email: "root@example.test", isSuperAdmin: true }) });
  assert.equal(admin.status, 200);
  assert.equal((await admin.json()).total, 7);
});

test("/api/metrics/cleanup reste réservé au super-admin", async () => {
  const res = await fetch(`${base}/api/metrics/cleanup`, {
    method: "POST", headers: { "Content-Type": "application/json", ...bearer({ tenantId: "tenant-a", email: "a@example.test" }) },
    body: JSON.stringify({ all: true }),
  });
  assert.equal(res.status, 403);
});

test("feedback : refusé sans jeton, avec un faux jeton ou avec le jeton d'un autre tenant/quiz", async () => {
  const body = { clientId: "tenant-a", quizId: "quiz-a", sessionId: "session-a", feedback: "positive" };
  assert.equal((await post("/api/quiz/feedback", body)).status, 403);
  assert.equal((await post("/api/quiz/feedback", { ...body, feedbackToken: "forged" })).status, 403);
  // Jeton valide pour la session d'un autre tenant, rejoué sur une session du tenant A.
  assert.equal((await post("/api/quiz/feedback", { ...body, feedbackToken: signFeedbackToken("session-b", "tenant-b", "quiz-b") })).status, 403);
  // Jeton valide mais quiz différent du même tenant.
  assert.equal((await post("/api/quiz/feedback", { ...body, feedbackToken: signFeedbackToken("session-a", "tenant-a", "quiz-a2") })).status, 403);
  assert.equal(sessions[0].feedback, null);
});

test("feedback : tenant étranger ou session d'un autre quiz → aucune écriture", async () => {
  const cross = await post("/api/quiz/feedback", {
    clientId: "tenant-a", quizId: "quiz-a", sessionId: "session-b", feedback: "negative",
    feedbackToken: signFeedbackToken("session-b", "tenant-a", "quiz-a"),
  });
  assert.equal(cross.status, 404);
  assert.equal(sessions[1].feedback, null);
  assert.equal((await post("/api/quiz/feedback", {
    clientId: "tenant-b", quizId: "quiz-a", sessionId: "session-a", feedback: "negative",
    feedbackToken: signFeedbackToken("session-a", "tenant-b", "quiz-a"),
  })).status, 404);
  assert.equal(sessions[0].feedback, null);
});

test("feedback : jeton valide → écrit sur la bonne session ; valeurs invalides refusées", async () => {
  const feedbackToken = signFeedbackToken("session-a", "tenant-a", "quiz-a");
  const base64 = { clientId: "tenant-a", quizId: "quiz-a", sessionId: "session-a", feedbackToken };
  assert.equal((await post("/api/quiz/feedback", { ...base64, feedback: "meh" })).status, 400);
  assert.equal((await post("/api/quiz/feedback", { ...base64, feedback: "positive", reasons: "x" })).status, 400);
  assert.equal((await post("/api/quiz/feedback", { ...base64, feedback: "positive", reasons: Array(11).fill("a") })).status, 400);
  assert.equal((await post("/api/quiz/feedback", { ...base64, feedback: "positive", reasons: ["prix"] })).status, 200);
  assert.equal(sessions[0].feedback, "positive");
});

test("track : types non émis, clés inconnues et payloads excessifs refusés ; widget compatible", async () => {
  created.length = 0;
  const send = (type: string, payload?: unknown) => post("/api/quiz/track", { clientId: "tenant-a", quizId: "quiz-a", type, payload });
  for (const [type, payload] of [
    ["feedback", {}], ["decision_time", {}], ["unknown", {}],
    ["quiz_start", { abVariant: "A", extra: 1 }],
    ["quiz_start", "texte"], ["quiz_start", [1]],
    ["quiz_start", { abVariant: "x".repeat(41) }],
    ["step_view", { step: "q1" }],
    ["step_view", { step: "q1", stepIndex: -1, questionId: "q1" }],
    ["step_answer", { step: "q1", questionId: "q1", answerId: "a".repeat(101) }],
    ["quiz_abandon", { stepIndex: 1, reason: "navigation" }],
    ["buy_click", { productId: { nested: true } }],
  ] as const) {
    assert.equal((await send(type, payload)).status, 400, `${type} ${JSON.stringify(payload)}`);
  }
  assert.equal(created.length, 0);

  for (const [type, payload] of [
    ["quiz_start", { abVariant: "standard" }], ["quiz_start", undefined],
    ["step_view", { step: "q1", stepIndex: 0, questionId: "q1" }],
    ["step_answer", { step: "q1", questionId: "q1", answerId: "a1" }],
    ["quiz_complete", { abVariant: "B" }],
    ["quiz_abandon", { stepIndex: 2, reason: "pagehide", abVariant: "A" }],
    ["buy_click", { productId: "p1", abVariant: "A" }],
  ] as const) {
    assert.equal((await send(type, payload)).status, 200, `${type}`);
  }
  assert.equal(created.length, 7);
  assert.ok((created as { tenantId: string; quizId: string }[]).every((m) => m.tenantId === "tenant-a" && m.quizId === "quiz-a"));
});

test("track : quiz d'un autre tenant introuvable, pas d'écriture", async () => {
  created.length = 0;
  const res = await post("/api/quiz/track", { clientId: "tenant-a", quizId: "quiz-b", type: "quiz_start" });
  assert.equal(res.status, 404);
  assert.equal(created.length, 0);
});

test("validateTrackEvent ne conserve que les champs connus", () => {
  assert.deepEqual(validateTrackEvent("buy_click", { productId: "p", abVariant: undefined }), { ok: true, payload: { productId: "p" } });
  assert.equal(validateTrackEvent("quiz_start", { abVariant: "   " }).ok, false);
});

test("indicateurs : taux masqués plutôt que plafonnés, clics jamais présentés comme taux par session", () => {
  const normal = computeIndicators({ started: 10, completed: 4, recommendations: 4, productClicks: 6 });
  assert.equal(normal.completionRate.value, 40);
  assert.equal(normal.completionRate.reliable, true);
  assert.equal(normal.consistency.consistent, true);
  assert.equal(normal.clicksPer100Recommendations.reliable, false);
  assert.match(normal.clicksPer100Recommendations.reason ?? "", /session/);

  const inconsistent = computeIndicators({ started: 3, completed: 5, recommendations: 4, productClicks: 0 });
  assert.equal(inconsistent.completionRate.value, null);
  assert.equal(inconsistent.completionRate.reliable, false);
  assert.equal(inconsistent.started, 3);
  assert.equal(inconsistent.completed, 5);
  assert.deepEqual(inconsistent.consistency, { completedMinusRecommendations: 1, consistent: false });

  const empty = computeIndicators({ started: 0, completed: 0, recommendations: 0, productClicks: 0 });
  assert.equal(empty.completionRate.value, null);
  assert.equal(empty.clicksPer100Recommendations.value, null);
});

test("agrégats par étape et par variante identiques à l'ancien calcul en mémoire", () => {
  assert.deepEqual(buildSteps([
    { step: "q1", type: "step_view", count: 10 }, { step: "q1", type: "step_answer", count: 8 },
    { step: "q2", type: "step_view", count: 8 }, { step: "orphan", type: "step_answer", count: 1 },
  ]), [
    { step: "q1", views: 10, answers: 8, dropOffRate: 20 },
    { step: "q2", views: 8, answers: 0, dropOffRate: 100 },
    { step: "orphan", views: 0, answers: 1, dropOffRate: 0 },
  ]);
  assert.deepEqual(buildVariants([
    { variant: "A", type: "quiz_start", count: 4 }, { variant: "A", type: "quiz_complete", count: 2 }, { variant: "A", type: "buy_click", count: 1 },
    { variant: "standard", type: "quiz_start", count: 6 },
  ]), [
    { variant: "standard", started: 6, completed: 0, clicks: 0, completionRate: 0, clickThroughRate: 0 },
    { variant: "A", started: 4, completed: 2, clicks: 1, completionRate: 50, clickThroughRate: 50 },
  ]);
});

test("abandon : jamais sur changement de question, re-rendu, complétion ou redémarrage ; une seule émission", () => {
  const sent: AbandonPayload[] = [];
  const tracker = createAbandonTracker((payload) => sent.push(payload));

  tracker.leave("unmount"); // jamais démarré (ex. double montage StrictMode)
  tracker.start();
  tracker.setStep(1); tracker.setStep(2); tracker.setStep(2);
  assert.deepEqual(sent, []);

  tracker.complete();
  tracker.leave("pagehide"); // quiz terminé
  assert.deepEqual(sent, []);

  tracker.reset(); // redémarrage volontaire
  tracker.leave("unmount");
  assert.deepEqual(sent, []);

  tracker.start();
  tracker.setStep(3);
  tracker.leave("pagehide");
  tracker.leave("unmount"); // pagehide puis démontage : pas de doublon
  assert.deepEqual(sent, [{ stepIndex: 3, reason: "pagehide" }]);

  tracker.reopen(); // retour depuis le bfcache
  tracker.leave("pagehide");
  assert.equal(sent.length, 2);
});
