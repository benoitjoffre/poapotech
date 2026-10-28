import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import type { ResultsExperienceDetail, ResultsSummary } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import resultsRouter from "../src/routes/results";
import { quizErrorHandler } from "../src/services/quizzes";

test("PostgreSQL : résultats par expérience, quiz partagé, périodes, catalogues et isolation tenant", {
  skip: process.env.POAPO_TEST_RESULTS_DB !== "1",
}, async () => {
  const id = `results-${randomUUID()}`;
  const other = `${id}-other`;
  const empty = `${id}-empty`;
  const secret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "results-db-test-only";
  let server: Server | undefined;
  try {
    for (const tenantId of [id, other, empty]) {
      await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test`, name: tenantId } });
      await prisma.subscription.create({ data: { tenantId: tenantId, plan: "BUSINESS", source: "LEGACY" } }); // fixtures : hors quotas
    }
    const [catA, catB, catOther] = await Promise.all([
      prisma.catalog.create({ data: { tenantId: id, name: "Voyage" } }),
      prisma.catalog.create({ data: { tenantId: id, name: "Café" } }),
      prisma.catalog.create({ data: { tenantId: other, name: "Autre" } }),
    ]);
    const mkQuiz = (tenantId: string, catalogId: string, name: string) =>
      prisma.quiz.create({ data: { tenantId, catalogId, name, quizTitle: name, ctaText: "Voir", active: true } });
    const [shared, solo, foreign] = await Promise.all([mkQuiz(id, catA.id, "Partagé"), mkQuiz(id, catB.id, "Sans campagne"), mkQuiz(other, catOther.id, "Étranger")]);
    // Deux campagnes sur le même quiz : ne doit jamais doubler les compteurs.
    for (const name of ["Noël", "Soldes"]) {
      await prisma.campaign.create({ data: { tenantId: id, quizId: shared.id, name, occasion: "CUSTOM", occasionLabel: name, objectives: [] } });
    }
    const product = await prisma.product.create({ data: { tenantId: id, catalogId: catA.id, name: "Séjour Bali", tags: [] } });
    const question = await prisma.question.create({ data: { tenantId: id, quizId: shared.id, text: "Quelle destination ?" } });
    const answer = await prisma.answer.create({ data: { questionId: question.id, text: "Plage" } });

    const day = (offset: number) => new Date(Date.now() - offset * 24 * 3600 * 1000);
    const metric = (tenantId: string, quizId: string, type: "quiz_start" | "quiz_complete" | "buy_click" | "step_view" | "step_answer", payload: object, createdAt: Date) =>
      ({ tenantId, quizId, type, payload, createdAt });
    await prisma.metric.createMany({ data: [
      metric(id, shared.id, "quiz_start", {}, day(2)), metric(id, shared.id, "quiz_start", {}, day(2)), metric(id, shared.id, "quiz_start", {}, day(3)),
      metric(id, shared.id, "quiz_complete", {}, day(2)), metric(id, shared.id, "buy_click", { productId: product.id }, day(1)),
      metric(id, shared.id, "step_view", { step: question.id, questionId: question.id }, day(2)),
      metric(id, shared.id, "step_answer", { step: question.id, questionId: question.id, answerId: answer.id }, day(2)),
      metric(id, shared.id, "step_view", { step: "old-step" }, day(2)),
      metric(id, shared.id, "quiz_start", {}, day(45)), // période précédente (30 j)
      metric(id, solo.id, "quiz_start", {}, day(5)),
      metric(other, foreign.id, "quiz_start", {}, day(1)),
    ] });
    await prisma.quizSession.create({ data: { tenantId: id, quizId: shared.id, answers: [], resultProductId: product.id, completedAt: day(2) } });

    const app = express();
    app.use("/api/results", resultsRouter);
    app.use(quizErrorHandler);
    server = await new Promise<Server>((resolve) => { const l = app.listen(0, "127.0.0.1", () => resolve(l)); });
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/results`;
    const auth = (tenantId: string) => ({ Authorization: `Bearer ${jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET!)}` });

    const summary = await (await fetch(`${url}/summary`, { headers: auth(id) })).json() as ResultsSummary;
    const row = (quizId: string) => summary.experiences.find((e) => e.id === quizId)!;
    assert.equal(summary.experiences.length, 2);
    assert.deepEqual([row(shared.id).started, row(shared.id).completed, row(shared.id).recommendations, row(shared.id).productClicks], [3, 1, 1, 1]);
    assert.equal(row(solo.id).started, 1);
    assert.equal(summary.totals.started, 4, "le quiz partagé par deux campagnes n'est compté qu'une fois");
    assert.equal(summary.previous.started, 1);
    assert.equal(summary.daily.length, 30, "30 jours = 30 jours UTC exactement");
    assert.equal(summary.period.days, 30);
    assert.equal(summary.period.to, new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1)).toISOString());
    for (const n of [7, 90]) {
      const to = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1));
      const r = await (await fetch(`${url}/summary?from=${new Date(to.getTime() - n * 86400000).toISOString()}&to=${to.toISOString()}`, { headers: auth(id) })).json() as ResultsSummary;
      assert.equal(r.daily.length, n);
      assert.equal(r.daily.reduce((a, d) => a + d.started, 0), r.totals.started, `série et total alignés sur ${n} jours`);
    }
    assert.equal(summary.daily.reduce((n, d) => n + d.started, 0), 4);
    assert.deepEqual(summary.catalogs.map((c) => c.name), ["Café", "Voyage"]);

    const byCatalog = await (await fetch(`${url}/summary?catalogId=${catB.id}`, { headers: auth(id) })).json() as ResultsSummary;
    assert.deepEqual(byCatalog.experiences.map((e) => e.id), [solo.id]);
    assert.equal(byCatalog.totals.started, 1);
    const narrow = await (await fetch(`${url}/summary?from=${new Date(Date.UTC(day(1).getUTCFullYear(), day(1).getUTCMonth(), day(1).getUTCDate())).toISOString()}&to=${new Date().toISOString()}`, { headers: auth(id) })).json() as ResultsSummary;
    assert.equal(narrow.totals.started, 0);
    assert.equal(narrow.totals.productClicks, 1);
    assert.equal((await fetch(`${url}/summary?from=bad`, { headers: auth(id) })).status, 400);

    const none = await (await fetch(`${url}/summary`, { headers: auth(empty) })).json() as ResultsSummary;
    assert.equal(none.experiences.length, 0);
    assert.equal(none.totals.started, 0);
    const foreignView = await (await fetch(`${url}/summary?quizId=${foreign.id}`, { headers: auth(id) })).json() as ResultsSummary;
    assert.equal(foreignView.experiences.length, 0, "un quiz d'un autre tenant n'est jamais visible");
    assert.equal((await fetch(`${url}/summary`)).status, 401);

    const detail = await (await fetch(`${url}/experiences/${shared.id}`, { headers: auth(id) })).json() as ResultsExperienceDetail;
    assert.equal(detail.experience.catalogName, "Voyage");
    assert.equal(detail.questions[0].label, "Quelle destination ?");
    assert.equal(detail.questions[0].options[0].label, "Plage");
    assert.equal(detail.unmatchedSteps, 1);
    assert.equal(detail.topProducts[0].name, "Séjour Bali");
    assert.equal(detail.clickedProducts[0].count, 1);
    assert.equal((await fetch(`${url}/experiences/${foreign.id}`, { headers: auth(id) })).status, 404);
  } finally {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    await prisma.tenant.deleteMany({ where: { id: { in: [id, other, empty] } } });
    if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret;
    await prisma.$disconnect();
  }
});
