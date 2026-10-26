import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { recommendQuiz } from "../src/services/quizRecommendations";
import { QuizError } from "../src/services/quizzes";
import { buildQuestionStats } from "../src/services/resultsDetail";
import { validateTrackEvent } from "../src/services/analyticsEvents";

const input = { tenantId: "t", catalogId: "c", industry: "Café", axes: [], impacts: [] };
const realFetch = globalThis.fetch;
const realUrl = process.env.AI_SERVICE_URL;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realUrl === undefined) delete process.env.AI_SERVICE_URL; else process.env.AI_SERVICE_URL = realUrl;
});

async function failure(fetchImpl: typeof fetch): Promise<QuizError> {
  process.env.AI_SERVICE_URL = "http://ai.invalid";
  globalThis.fetch = fetchImpl;
  const originalError = console.error;
  console.error = () => undefined;
  try {
    await recommendQuiz(input);
  } catch (err) {
    assert.ok(err instanceof QuizError);
    return err;
  } finally {
    console.error = originalError;
  }
  assert.fail("recommendQuiz aurait dû échouer");
}

test("service IA injoignable : 503 explicite", async () => {
  const err = await failure((async () => { throw new TypeError("fetch failed"); }) as typeof fetch);
  assert.equal(err.status, 503);
  assert.match(err.message, /indisponible/);
});

test("timeout : 504 explicite", async () => {
  const err = await failure((async () => { throw new DOMException("timeout", "TimeoutError"); }) as typeof fetch);
  assert.equal(err.status, 504);
});

test("service en chargement (503) ou en erreur : jamais un 500 opaque", async () => {
  assert.equal((await failure((async () => new Response("{}", { status: 503 })) as typeof fetch)).status, 503);
  assert.equal((await failure((async () => new Response("{}", { status: 500 })) as typeof fetch)).status, 502);
});

test("choix multiple : événement step_answer identique au choix unique, payload strict", () => {
  const ok = validateTrackEvent("step_answer", { step: "q", questionId: "q", answerId: "a1" });
  assert.deepEqual(ok, { ok: true, payload: { step: "q", questionId: "q", answerId: "a1" } });
  assert.equal(validateTrackEvent("step_answer", { step: "q", questionId: "q", answerId: "a1", extra: 1 }).ok, false);
  assert.equal(validateTrackEvent("step_answer", { step: "q", questionId: "q" }).ok, false);
});

test("choix multiple : compté par option, marqué partiel tant que le suivi n'a pas couvert la période", () => {
  const questions = [
    { id: "s", text: "Unique", type: "single", answers: [{ id: "s1", text: "A" }] },
    { id: "m", text: "Multiple", type: "multi", answers: [{ id: "m1", text: "Fruité" }, { id: "m2", text: "Chocolat" }] },
  ];
  const rows = [
    { questionId: "m", answerId: null, type: "step_view", count: 5 },
    { questionId: "m", answerId: "m1", type: "step_answer", count: 3 },
    { questionId: "m", answerId: "m2", type: "step_answer", count: 2 },
    { questionId: "s", answerId: "s1", type: "step_answer", count: 1 },
  ];
  const from = new Date("2026-10-01");
  const before = buildQuestionStats(rows, questions, { from, firstAt: new Date("2026-10-20") }).questions;
  assert.equal(before.find((q) => q.questionId === "m")?.answers, 5);
  assert.equal(before.find((q) => q.questionId === "m")?.partial, true);
  assert.equal(before.find((q) => q.questionId === "s")?.partial, undefined);
  const never = buildQuestionStats(rows, questions, { from, firstAt: null }).questions;
  assert.equal(never.find((q) => q.questionId === "m")?.partial, true);
  const covered = buildQuestionStats(rows, questions, { from, firstAt: new Date("2026-09-15") }).questions;
  assert.equal(covered.find((q) => q.questionId === "m")?.partial, undefined);
});
