import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import type { Prisma } from "@prisma/client";
import type { QuizAxis } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import builderRouter from "../src/routes/quizBuilder";
import { quizErrorHandler } from "../src/services/quizzes";
import { computeProfile } from "../src/services/scoring";
import { createQuestionsWithAnswers, MANUAL_IMPACT_LIMIT, parseScoringImpacts } from "../src/services/questions";

type Row = Record<string, unknown>;
const restores: (() => void)[] = [];
let server: Server;
let base: string;
let createdQuestions: Row[] = [];
let createdAnswers: Row[] = [];

function stub<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const previous = target[key];
  target[key] = value;
  restores.push(() => { target[key] = previous; });
}

function fakeTx() {
  return {
    question: {
      create: async ({ data }: { data: Row }) => {
        const row = { ...data, id: `q${createdQuestions.length + 1}` };
        createdQuestions.push(row);
        return row;
      },
    },
    answer: {
      create: async ({ data }: { data: Row }) => {
        createdAnswers.push(data);
        return data;
      },
    },
  } as unknown as Prisma.TransactionClient;
}

const axes: QuizAxis[] = [
  { key: "body", label: "Corps", lowLabel: null, highLabel: null },
  { key: "acidity", label: "Acidité", lowLabel: null, highLabel: null },
];

/** Copie de l'ancien calcul inline de POST /api/quiz/submit, conservée comme référence. */
function legacyProfile(quizAxes: QuizAxis[], answerDocs: { impacts: unknown }[]) {
  const profile: Record<string, number> = Object.fromEntries(quizAxes.map((axis) => [axis.key, 0.5]));
  for (const ans of answerDocs) {
    const impacts = ans.impacts as Record<string, unknown>;
    for (const [axis, impact] of Object.entries(impacts)) {
      if (!(axis in profile) || typeof impact !== "number" || !Number.isFinite(impact)) continue;
      profile[axis] = Math.max(0, Math.min(1, profile[axis] + impact));
    }
  }
  return profile;
}

before(async () => {
  process.env.JWT_SECRET = "multi-quiz-tests-only";
  stub(prisma.tenant, "findUnique", (async () => ({ id: "tenant-a" })) as unknown as typeof prisma.tenant.findUnique);
  stub(prisma.quiz, "findFirst", (async ({ where }: { where: { id: string; tenantId: string } }) =>
    where.tenantId === "tenant-a" && where.id === "coffee"
      ? { id: "coffee", tenantId: "tenant-a", axes, products: [] }
      : null) as unknown as typeof prisma.quiz.findFirst);
  stub(prisma.question, "aggregate", (async () => ({ _max: { order: 4 } })) as unknown as typeof prisma.question.aggregate);
  stub(prisma, "$transaction", (async (fn: (tx: Prisma.TransactionClient) => unknown) => fn(fakeTx())) as unknown as typeof prisma.$transaction);

  const app = express();
  app.use(express.json());
  app.use("/api/quiz/builder", builderRouter);
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

test("computeProfile reproduit exactement l'ancien calcul de /submit", () => {
  const cases: unknown[][] = [
    [],
    [{ body: 0.2 }, { body: 0.2 }, { body: 0.2 }],
    [{ body: 0.9 }, { body: -0.3 }],
    [{ body: -0.8 }, { acidity: 1, unknown: 0.4 }],
    [{ body: "0.3", acidity: Number.NaN }, { body: Infinity }, { acidity: -0.15 }],
  ];
  for (const impacts of cases) {
    assert.deepEqual(
      computeProfile(axes, impacts),
      legacyProfile(axes, impacts.map((value) => ({ impacts: value }))),
    );
  }
  // Le bornage s'applique après chaque réponse : 0.5 + 0.9 → 1, puis 1 - 0.3 → 0.7.
  assert.deepEqual(computeProfile(axes, [{ body: 0.9 }, { body: -0.3 }]), { body: 0.7, acidity: 0.5 });
  assert.deepEqual(computeProfile([], [{ body: 0.2 }]), {});
});

test("parseScoringImpacts conserve la borne manuelle ±1 et ignore les axes inconnus", () => {
  assert.equal(MANUAL_IMPACT_LIMIT, 1);
  assert.deepEqual(
    parseScoringImpacts({ body: 3, acidity: "-0.4", other: 0.5, zero: 0 }, axes),
    { body: 1, acidity: -0.4 },
  );
  assert.deepEqual(parseScoringImpacts({ body: 0, acidity: "" }, axes), {});
  assert.deepEqual(parseScoringImpacts(null, axes), {});
});

test("createQuestionsWithAnswers numérote les questions et ignore les réponses vides", async () => {
  createdQuestions = [];
  createdAnswers = [];
  const result = await createQuestionsWithAnswers(fakeTx(), { tenantId: "tenant-a", quizId: "coffee", startOrder: 3 }, [
    { text: "Q1", type: "single", answers: [{ text: " A ", emoji: " ☕ ", impacts: { body: 0.1 } }, { text: "  ", impacts: {} }, { text: "B", emoji: "", impacts: {} }] },
    { text: "Q2", helpText: "aide", type: "single", active: false, answers: [{ text: "C", impacts: { acidity: -0.1 } }] },
  ]);
  assert.deepEqual(result, { createdQuestions: 2, createdAnswers: 3 });
  assert.deepEqual(createdQuestions.map((q) => [q.order, q.tenantId, q.quizId, q.helpText, q.active]), [
    [3, "tenant-a", "coffee", null, true],
    [4, "tenant-a", "coffee", "aide", false],
  ]);
  assert.deepEqual(createdAnswers.map((a) => [a.questionId, a.text, a.emoji, a.order, a.impacts]), [
    ["q1", "A", "☕", 0, { body: 0.1 }],
    ["q1", "B", null, 1, {}],
    ["q2", "C", null, 0, { acidity: -0.1 }],
  ]);
});

test("l'import CSV historique sans révision ne peut pas écrire sur le contenu publié", async () => {
  createdQuestions = [];
  createdAnswers = [];
  const csv = [
    "question,answer,emoji,body,impact_acidity,answerActive",
    "Quel café ?,Corsé,☕,\"0,4\",,",
    "Quel café ?,Léger,,-2,0.1,non",
    "Quel café ?,,,0.1,,",
    "Moment ?,Matin,,0.2,,",
  ].join("\n");
  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "quiz.csv");
  const token = jwt.sign({ tenantId: "tenant-a", email: "a@example.test" }, process.env.JWT_SECRET!);
  const response = await fetch(`${base}/api/quiz/builder/questions/import-csv?quizId=coffee`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Révision/);
  assert.deepEqual(createdQuestions, []);
  assert.deepEqual(createdAnswers, []);
});
