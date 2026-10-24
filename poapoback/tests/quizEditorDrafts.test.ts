import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { QuizEditorDraft, QuizEditorDraftResponse } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import quizzesRouter from "../src/routes/quizzes";
import builderRouter from "../src/routes/quizBuilder";
import embedRouter from "../src/routes/embed";
import quizRouter from "../src/routes/quiz";
import authRouter from "../src/routes/auth";
import adminTenantsRouter from "../src/routes/adminTenants";
import { quizErrorHandler } from "../src/services/quizzes";

const quiz = {
  id: "quiz-a", tenantId: "tenant-a", catalogId: "catalog-a", name: "Quiz public",
  industry: "voyage", axes: [{ key: "pace", label: "Rythme" }],
  quizTitle: "Votre voyage", ctaText: "Découvrir", active: true, useAllProducts: false,
  products: [{ productId: "product-a" }], isDefault: false,
};
const questions = [{
  id: "question-a", tenantId: quiz.tenantId, quizId: quiz.id, text: "Quel rythme ?",
  helpText: null, imageUrl: null, type: "single", active: true, order: 0,
  conditionAnswerId: null, abVariant: "A",
  answers: [{
    id: "answer-a", questionId: "question-a", text: "Calme", emoji: null,
    imageUrl: null, order: 0, active: true, impacts: { pace: -0.2 },
  }],
}, {
  id: "question-b", tenantId: quiz.tenantId, quizId: quiz.id, text: "Vos activités ?",
  helpText: "Plusieurs choix", imageUrl: null, type: "multi", active: false, order: 1,
  conditionAnswerId: "answer-a", abVariant: "A", answers: [],
}];
type DraftRow = { quizId: string; tenantId: string; revision: number; content: unknown; updatedAt: Date };
let row: DraftRow | null = null;
let server: Server;
let base: string;
let publishedWrites = 0;
const restores: (() => void)[] = [];

// Prisma delegates are proxies, without the method descriptors required by mock.method.
function stub<T extends object>(target: T, key: keyof T, implementation: (...args: never[]) => unknown) {
  const original = target[key];
  assert.ok(Reflect.set(target, key, implementation));
  restores.push(() => { assert.ok(Reflect.set(target, key, original)); });
}
before(async () => {
  process.env.JWT_SECRET = "draft-tests-only";
  stub(prisma, "$transaction", async (fn: (db: typeof prisma) => Promise<unknown>) => fn(prisma));
  stub(prisma.quiz, "findFirst", async ({ where }: Prisma.QuizFindFirstArgs = {}) =>
    where?.id === quiz.id && where.tenantId === quiz.tenantId ? quiz : null
  );
  stub(prisma.tenant, "findUnique", async () => ({ id: "tenant-a", active: true }));
  stub(prisma.question, "findMany", async () => structuredClone(questions));
  stub(prisma.answer, "findMany", async () => []);
  stub(prisma.catalog, "findFirst", async ({ where }: Prisma.CatalogFindFirstArgs = {}) =>
    where?.tenantId === "tenant-a" && ["catalog-a", "catalog-other"].includes(String(where.id))
      ? { id: where.id, tenantId: "tenant-a" } : null
  );
  stub(prisma.product, "findMany", async ({ where }: Prisma.ProductFindManyArgs = {}) => {
    const ids = where?.id && typeof where.id === "object" ? where.id.in : [];
    return Array.isArray(ids) ? ids.filter((id) => ["product-a", "product-other"].includes(id))
      .map((id) => ({ id, catalogId: id === "product-a" ? "catalog-a" : "catalog-other" })) : [];
  });
  stub(prisma.quizEditorDraft, "findFirst", async ({ where }: Prisma.QuizEditorDraftFindFirstArgs = {}) =>
    row && where?.tenantId === row.tenantId && where.quizId === row.quizId ? structuredClone(row) : null
  );
  stub(prisma.quizEditorDraft, "create", async ({ data }: { data: Prisma.QuizEditorDraftUncheckedCreateInput }) => {
    if (row) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
    row = {
      quizId: data.quizId, tenantId: data.tenantId, revision: data.revision ?? 1,
      content: data.content === Prisma.DbNull ? null : data.content,
      updatedAt: data.updatedAt instanceof Date ? data.updatedAt : new Date(),
    };
    return structuredClone(row);
  });
  stub(prisma.quizEditorDraft, "updateMany", async ({ where, data }: {
    where: { revision: number; tenantId: string; quizId: string };
    data: { content: unknown; updatedAt: Date };
  }) => {
    if (!row || where.revision !== row.revision || where.tenantId !== row.tenantId || where.quizId !== row.quizId) return { count: 0 };
    row = { ...row, revision: row.revision + 1, content: data.content === Prisma.DbNull ? null : data.content, updatedAt: data.updatedAt };
    return { count: 1 };
  });
  stub(prisma.quiz, "update", async () => { publishedWrites++; return quiz; });
  stub(prisma.question, "create", async () => { publishedWrites++; });
  const app = express();
  app.use(express.json());
  app.use("/api/quizzes", quizzesRouter);
  app.use("/api/quiz/builder", builderRouter);
  app.use("/api/quiz", quizRouter);
  app.use("/api/embed", embedRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin/tenants", adminTenantsRouter);
  app.use(quizErrorHandler);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => { row = null; publishedWrites = 0; });
after(async () => {
  for (const restore of restores.reverse()) restore();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await prisma.$disconnect();
});

async function request(path: string, method = "GET", body?: unknown, tenantId: string | null = "tenant-a") {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(tenantId && { Authorization: `Bearer ${jwt.sign({ tenantId, email: "test@example.test" }, process.env.JWT_SECRET!)}` }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}
const endpoint = "/api/quizzes/quiz-a/draft";
async function read(): Promise<QuizEditorDraftResponse> {
  const response = await request(endpoint);
  assert.equal(response.status, 200);
  return response.json();
}
async function save(draft: QuizEditorDraft, revision: number) {
  return request(endpoint, "PUT", { draft, revision });
}

test("lecture initiale sans écriture, sauvegarde et rechargement persistants, identifiants conservés", async () => {
  const initial = await read();
  assert.equal(initial.revision, 0);
  assert.equal(initial.hasChanges, false);
  assert.equal(row, null);
  assert.equal(initial.draft.questions[0].id, "question-a");
  initial.draft.questions[0].text = "Question préparatoire";
  const response = await save(initial.draft, 0);
  assert.equal(response.status, 200);
  const saved = await response.json() as QuizEditorDraftResponse;
  assert.equal(saved.revision, 1);
  assert.equal(saved.hasChanges, true);
  assert.deepEqual(await read(), saved);
  assert.equal(publishedWrites, 0);
});

test("les conditions, variantes, types, activations et impacts survivent à la sauvegarde", async () => {
  const { draft } = await read();
  draft.questions[0].answers[0].active = false;
  draft.questions[1].type = "scale";
  draft.questions[1].order = 7;
  assert.equal((await save(draft, 0)).status, 200);
  assert.deepEqual((await read()).draft, draft);
});

test("apparence : sauvegarde, récupération, révisions et remise à zéro sans modification publique", async () => {
  const { draft } = await read();
  draft.theme = { primaryColor: "#123456", secondaryColor: "#77C0A0", accentColor: "#FF7700",
    backgroundColor: "#FFFFFF", textColor: "#111111", headingFont: "georgia", bodyFont: "arial",
    buttonShape: "soft", logoUrl: "https://example.test/logo.png", nextLabel: "Continuer" };
  const source = structuredClone(draft.questions);
  const publicBefore = await (await request("/api/embed/config?clientId=tenant-a&quizId=quiz-a")).json();
  assert.equal((await save(draft, 0)).status, 200);
  assert.deepEqual((await read()).draft.theme, draft.theme);
  assert.deepEqual((await read()).draft.questions, source);
  assert.equal((await save({ ...draft, theme: null }, 0)).status, 409);
  assert.equal((await request(endpoint, "PUT", { revision: 1, draft }, "tenant-b")).status, 404);
  assert.deepEqual(await (await request("/api/embed/config?clientId=tenant-a&quizId=quiz-a")).json(), publicBefore);
  assert.equal((await save({ ...draft, theme: null }, 1)).status, 200);
  const reset = await read();
  assert.equal(reset.draft.theme, null);
  assert.deepEqual(reset.draft.questions, source);
  assert.equal(reset.revision, 2);
  assert.equal(publishedWrites, 0);
});

test("apparence : validation serveur, aucun brouillon écrit avec des valeurs interdites", async () => {
  const { draft } = await read();
  for (const theme of [
    { primaryColor: "red" }, { bodyFont: "Comic Sans" }, { logoUrl: "javascript:alert(1)" },
    { css: "body { display: none }" }, { buttonShape: "triangle" }, { nextLabel: "" },
  ]) {
    const response = await request(endpoint, "PUT", { revision: 0, draft: { ...draft, theme } });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error);
    assert.equal((await read()).revision, 0);
  }
});

test("deux premières sauvegardes concurrentes et révisions obsolètes : une seule gagne", async () => {
  const { draft } = await read();
  const responses = await Promise.all([save(draft, 0), save(draft, 0)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await save(draft, 0)).status, 409);
  const next = await Promise.all([save(draft, 1), save(draft, 1)]);
  assert.deepEqual(next.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await read()).revision, 2);
});

test("abandon avec révision, restauration publique et protection contre les anciens écrivains", async () => {
  const { draft } = await read();
  draft.config.quizTitle = "Brouillon";
  await save(draft, 0);
  assert.equal((await request(endpoint, "DELETE", { revision: 0 })).status, 409);
  assert.equal((await request(endpoint, "DELETE", { revision: 1 })).status, 200);
  const reset = await read();
  assert.equal(reset.revision, 2);
  assert.equal(reset.hasChanges, false);
  assert.equal(reset.draft.config.quizTitle, quiz.quizTitle);
  assert.equal((await save(draft, 0)).status, 409);
  assert.equal((await save(draft, 1)).status, 409);
  assert.equal((await save(draft, 2)).status, 200);
});

test("isolation tenant et authentification pour lecture, sauvegarde et abandon", async () => {
  const { draft } = await read();
  for (const method of ["GET", "PUT", "DELETE"]) {
    const body = method === "GET" ? undefined : { revision: 0, draft };
    assert.equal((await request(endpoint, method, body, null)).status, 401);
    assert.equal((await request(endpoint, method, body, "tenant-b")).status, 404);
    assert.equal((await request("/api/quizzes/inconnu/draft", method, body)).status, 404);
  }
  assert.equal(row, null);
});

test("catalogue et produits étrangers ou mélangés refusés ; changement préparatoire de catalogue autorisé", async () => {
  const { draft } = await read();
  draft.config.catalogId = "catalog-b";
  assert.equal((await save(draft, 0)).status, 404);
  draft.config.catalogId = "catalog-other";
  assert.equal((await save(draft, 0)).status, 400);
  draft.config.productIds = ["product-b"];
  assert.equal((await save(draft, 0)).status, 400);
  draft.config.productIds = ["product-other"];
  assert.equal((await save(draft, 0)).status, 200);
  assert.equal(quiz.catalogId, "catalog-a");
});

test("identifiants étrangers, dupliqués, conditions hors brouillon et valeurs invalides refusés", async () => {
  const original = (await read()).draft;
  const invalid: ((draft: QuizEditorDraft) => void)[] = [
    (d) => { d.questions[0].id = "question-foreign"; },
    (d) => { d.questions[0].answers[0].id = "answer-foreign"; },
    (d) => { d.questions.push(structuredClone(d.questions[0])); },
    (d) => { d.questions[1].conditionAnswerId = "answer-foreign"; },
    (d) => { d.questions[0].answers[0].impacts.pace = 2; },
    (d) => { d.questions[0].answers[0].impacts.unknown = 0.2; },
    (d) => { d.questions[0].order = -1; },
  ];
  for (const mutate of invalid) {
    const draft = structuredClone(original);
    mutate(draft);
    assert.equal((await save(draft, 0)).status, 400);
  }
  for (const revision of [undefined, -1, 1.5, "0"]) {
    assert.equal((await request(endpoint, "PUT", { draft: original, revision })).status, 400);
  }
  assert.equal(row, null);
});

test("le contenu public et les anciennes routes ne lisent ni ne modifient le brouillon", async () => {
  const { draft } = await read();
  draft.config.quizTitle = "Titre préparatoire";
  draft.questions[0].text = "Texte préparatoire";
  await save(draft, 0);
  const config = await request("/api/embed/config?clientId=tenant-a&quizId=quiz-a");
  assert.equal(config.status, 200);
  assert.equal((await config.json()).quizTitle, quiz.quizTitle);
  const publicQuestions = await request("/api/quiz/questions?clientId=tenant-a&quizId=quiz-a");
  assert.equal(publicQuestions.status, 200);
  assert.equal((await publicQuestions.json())[0].text, questions[0].text);
  for (const [path, method, body] of [
    ["/api/quiz/builder/questions?quizId=quiz-a", "POST", { text: "Contournement" }],
    ["/api/quiz/builder/questions/question-a?quizId=quiz-a", "PUT", { text: "Contournement" }],
    ["/api/quiz/builder/questions/question-a?quizId=quiz-a", "DELETE", {}],
    ["/api/quiz/builder/questions/reorder?quizId=quiz-a", "PUT", { order: [] }],
    ["/api/quiz/builder/questions/question-a/answers?quizId=quiz-a", "POST", { text: "Réponse" }],
    ["/api/quiz/builder/answers/answer-a?quizId=quiz-a", "PUT", { text: "Réponse" }],
    ["/api/quiz/builder/answers/answer-a?quizId=quiz-a", "DELETE", {}],
    ["/api/quiz/builder/answers/reorder-all?quizId=quiz-a", "PUT", { order: [] }],
    ["/api/quiz/builder/answers/reorder?quizId=quiz-a", "PUT", { order: [] }],
    ["/api/quizzes/quiz-a", "PUT", { quizTitle: "Contournement" }],
  ] as const) {
    assert.equal((await request(path, method, body)).status, 409, path);
  }
  assert.equal(publishedWrites, 0);
});

test("ajouts, suppressions et réorganisation restent exclusivement dans le brouillon", async () => {
  const { draft } = await read();
  const q = structuredClone(draft.questions[0]);
  q.id = `draft_${randomUUID()}`;
  q.answers[0].id = `draft_${randomUUID()}`;
  q.text = "Nouvelle question";
  q.answers[0].order = 3;
  q.order = 0;
  draft.questions[0].order = 1;
  draft.questions.splice(1, 1);
  draft.questions.unshift(q);
  assert.equal((await save(draft, 0)).status, 200);
  assert.deepEqual((await read()).draft, draft);
  assert.equal(publishedWrites, 0);
  assert.equal(questions.length, 2);
});

test("un import CSV avec révision ajoute au brouillon et signale les lignes ignorées", async () => {
  const { draft } = await read();
  draft.theme = { primaryColor: "#123456", headingFont: "georgia" };
  assert.equal((await save(draft, 0)).status, 200);
  const csv = [
    "question,answer,emoji,pace,answerActive",
    'Quel rythme ?,Rapide,,"0,4",',
    "Quel rythme ?,Lent,,-2,non",
    "Quel rythme ?,,,0.1,",
    "Moment ?,Matin,,0.2,",
  ].join("\n");
  const upload = async (revision: string | undefined) => {
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "quiz.csv");
    if (revision !== undefined) form.append("revision", revision);
    return fetch(`${base}/api/quiz/builder/questions/import-csv?quizId=quiz-a`, {
      method: "POST", body: form,
      headers: { Authorization: `Bearer ${jwt.sign({ tenantId: "tenant-a", email: "test@example.test" }, process.env.JWT_SECRET!)}` },
    });
  };
  assert.equal((await upload(undefined)).status, 400);
  const response = await upload("1");
  assert.equal(response.status, 200);
  const result = await response.json() as QuizEditorDraftResponse & {
    createdQuestions: number; createdAnswers: number; skippedRows: number;
  };
  assert.deepEqual([result.createdQuestions, result.createdAnswers, result.skippedRows], [2, 3, 1]);
  assert.equal(result.draft.questions.length, 4);
  assert.deepEqual(result.draft.theme, draft.theme);
  assert.deepEqual(result.draft.questions[2].answers.map((a) => [a.text, a.order, a.active, a.impacts]), [
    ["Rapide", 0, true, { pace: 0.4 }], ["Lent", 1, false, { pace: -1 }],
  ]);
  assert.equal((await upload("0")).status, 409);
  assert.equal(publishedWrites, 0);
});

test("les réglages historiques du branding et du super-admin ne contournent pas les brouillons", async () => {
  assert.equal((await request("/api/auth/me/branding", "PUT", { quizTitle: "Contournement" })).status, 409);
  const token = jwt.sign({ tenantId: "tenant-a", email: "test@example.test", isSuperAdmin: true }, process.env.JWT_SECRET!);
  const response = await fetch(`${base}/api/admin/tenants/tenant-a`, {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ctaText: "Contournement" }),
  });
  assert.equal(response.status, 409);
  assert.equal(publishedWrites, 0);
});
