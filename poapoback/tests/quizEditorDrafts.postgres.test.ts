import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import quizzesRouter from "../src/routes/quizzes";
import embedRouter from "../src/routes/embed";
import quizRouter from "../src/routes/quiz";
import { quizErrorHandler } from "../src/services/quizzes";
import type { QuizEditorDraftResponse } from "@poapo/types";

test("PostgreSQL : API des brouillons, CAS concurrent, FK tenant, abandon et contenu public inchangé", {
  skip: process.env.POAPO_TEST_POSTGRES !== "1",
}, async () => {
  const id = `draft-test-${randomUUID()}`;
  let server: Server | undefined;
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "isolated-postgres-draft-test";
  try {
    const tenant = await prisma.tenant.create({ data: { id, email: `${id}@example.test` } });
    await prisma.subscription.create({ data: { tenantId: id, plan: "BUSINESS", source: "LEGACY" } }); // fixtures : hors quotas
    const catalog = await prisma.catalog.create({ data: { tenantId: id, name: "Catalogue test", isDefault: true } });
    const product = await prisma.product.create({ data: {
      tenantId: id, catalogId: catalog.id, name: "Produit test", tags: [], attributes: { pace: 0.4 },
    } });
    const quiz = await prisma.quiz.create({ data: {
      id: `default_${id}`, tenantId: id, catalogId: catalog.id, name: "Quiz test", isDefault: true,
      quizTitle: "Titre public", ctaText: "Découvrir", axes: [{ key: "pace", label: "Rythme" }],
      useAllProducts: false, products: { create: { productId: product.id } },
    } });
    const q = await prisma.question.create({ data: {
      tenantId: id, quizId: quiz.id, text: "Question publique", order: 0, abVariant: "A",
      answers: { create: { text: "Réponse publique", order: 0, impacts: { pace: -0.2 } } },
    }, include: { answers: true } });
    await prisma.question.create({ data: {
      tenantId: id, quizId: quiz.id, text: "Question conditionnelle", type: "multi", order: 1,
      conditionAnswerId: q.answers[0].id, abVariant: "A",
    } });
    const otherQuiz = await prisma.quiz.create({ data: {
      tenantId: id, catalogId: catalog.id, name: "Autre quiz", quizTitle: "Autre titre", ctaText: "Découvrir",
    } });
    await prisma.campaign.create({ data: {
      tenantId: id, quizId: quiz.id, name: "Campagne inchangée", occasion: "PERMANENT", objectives: [],
    } });
    const publicSnapshot = () => prisma.quiz.findUnique({ where: { id: quiz.id }, include: {
      questions: { orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } } } },
      products: true, campaigns: true,
    } });
    const before = await publicSnapshot();
    const app = express();
    app.use(express.json());
    app.use("/api/quizzes", quizzesRouter);
    app.use("/api/embed", embedRouter);
    app.use("/api/quiz", quizRouter);
    app.use(quizErrorHandler);
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const token = jwt.sign({ tenantId: tenant.id, email: tenant.email }, process.env.JWT_SECRET!);
    const endpoint = `${base}/api/quizzes/${quiz.id}/draft`;
    const request = (method: string, body?: unknown) => fetch(endpoint, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const get = async () => {
      const response = await request("GET");
      assert.equal(response.status, 200);
      return response.json() as Promise<QuizEditorDraftResponse>;
    };
    const initial = await get();
    assert.equal(initial.revision, 0);
    assert.equal(await prisma.quizEditorDraft.count({ where: { tenantId: id } }), 0);
    await assert.rejects(prisma.quizEditorDraft.create({ data: {
      tenantId: "foreign-tenant", quizId: quiz.id, revision: 1,
    } }), (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003");
    initial.draft.questions[0].text = "Question préparatoire";
    initial.draft.config.quizTitle = "Titre préparatoire";
    initial.draft.theme = { primaryColor: "#123456", headingFont: "georgia", nextLabel: "Continuer" };
    const writes = await Promise.all([0, 0].map((revision) => request("PUT", { revision, draft: initial.draft })));
    assert.deepEqual(writes.map((r) => r.status).sort(), [200, 409]);
    assert.deepEqual((await get()).draft, initial.draft);
    const updated = await Promise.all([1, 1].map((revision) => request("PUT", { revision, draft: initial.draft })));
    assert.deepEqual(updated.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await get()).revision, 2);
    assert.deepEqual(await publicSnapshot(), before);
    const otherDraftResponse = await fetch(`${base}/api/quizzes/${otherQuiz.id}/draft`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(otherDraftResponse.status, 200);
    const otherDraft = await otherDraftResponse.json() as QuizEditorDraftResponse;
    assert.equal(otherDraft.revision, 0);
    assert.equal(otherDraft.draft.theme, undefined);
    otherDraft.draft.theme = { primaryColor: "#654321", bodyFont: "verdana" };
    const otherSave = await fetch(`${base}/api/quizzes/${otherQuiz.id}/draft`, {
      method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 0, draft: otherDraft.draft }),
    });
    assert.equal(otherSave.status, 200);
    assert.deepEqual((await otherSave.json()).draft.theme, otherDraft.draft.theme);
    assert.deepEqual((await get()).draft.theme, initial.draft.theme);
    const otherPublic = await fetch(`${base}/api/embed/config?clientId=${id}&quizId=${otherQuiz.id}`);
    assert.equal((await otherPublic.json()).primaryColor, tenant.primaryColor);
    const historicalConfig = await fetch(`${base}/api/embed/config?clientId=${id}`);
    assert.equal(historicalConfig.status, 200);
    assert.equal((await historicalConfig.json()).quizTitle, "Titre public");
    const publicQuestions = await fetch(`${base}/api/quiz/questions?clientId=${id}`);
    assert.equal(publicQuestions.status, 200);
    assert.equal((await publicQuestions.json())[0].text, "Question publique");
    assert.equal((await request("DELETE", { revision: 1 })).status, 409);
    assert.equal((await request("DELETE", { revision: 2 })).status, 200);
    const reset = await get();
    assert.equal(reset.revision, 3);
    assert.equal(reset.hasChanges, false);
    assert.equal(reset.draft.config.quizTitle, "Titre public");
    assert.equal(reset.draft.theme, undefined);
    assert.equal((await request("PUT", { revision: 0, draft: initial.draft })).status, 409);
    assert.deepEqual(await publicSnapshot(), before);
    await prisma.quiz.update({ where: { id: quiz.id }, data: { active: false } });
    assert.equal((await request("PUT", { revision: 3, draft: initial.draft })).status, 200);
    assert.equal((await fetch(`${base}/api/embed/config?clientId=${id}`)).status, 403);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve()));
    // Only the unique tenant created by this test is removed, together with its own fixtures.
    await prisma.tenant.deleteMany({ where: { id } });
    await prisma.$disconnect();
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});
