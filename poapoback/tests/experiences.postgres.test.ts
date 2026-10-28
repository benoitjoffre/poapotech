import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import type { ExperiencesOverview } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import experiencesRouter from "../src/routes/experiences";
import { quizErrorHandler } from "../src/services/quizzes";

test("PostgreSQL : synthèse « Mes expériences » isolée, sans double comptage", {
  skip: process.env.POAPO_TEST_EXPERIENCES_DB !== "1",
}, async (t) => {
  const id = `experiences-${randomUUID()}`;
  const other = `${id}-other`;
  let server: Server | undefined;
  const secret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "experiences-test-only";
  try {
    for (const tenantId of [id, other]) {
      await prisma.tenant.create({
      data: { id: tenantId, email: `${tenantId}@example.test`, name: tenantId },
    });
      await prisma.subscription.create({ data: { tenantId: tenantId, plan: "BUSINESS", source: "LEGACY" } }); // fixtures : hors quotas
    }
    const app = express();
    app.use("/api/experiences", experiencesRouter);
    app.use(quizErrorHandler);
    server = await new Promise<Server>((resolve) => {
      const running = app.listen(0, "127.0.0.1", () => resolve(running));
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/experiences`;
    const token = (tenantId: string, isSuperAdmin = false) =>
      jwt.sign({ tenantId, email: `${tenantId}@example.test`, isSuperAdmin }, process.env.JWT_SECRET!);
    const request = (authorization?: string) => fetch(url, { headers: authorization ? { Authorization: `Bearer ${authorization}` } : {} });
    const overview = async (tenantId = id) => {
      const response = await request(token(tenantId));
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get("cache-control"), "no-store");
      return response.json() as Promise<ExperiencesOverview>;
    };

    await t.test("authentification, super-administrateur et tenant sans quiz", async () => {
      assert.equal((await request()).status, 401);
      assert.equal((await request("invalid")).status, 401);
      assert.equal((await request(token("super-admin"))).status, 403);
      assert.equal((await request(token(id, true))).status, 403);
      assert.deepEqual((await overview()).experiences, []);
      assert.equal(await prisma.quiz.count({ where: { tenantId: id } }), 0);
    });

    const main = await prisma.catalog.create({ data: { tenantId: id, name: "Principal" } });
    const second = await prisma.catalog.create({ data: { tenantId: id, name: "Second" } });
    const foreignCatalog = await prisma.catalog.create({ data: { tenantId: other, name: "Étranger" } });
    await prisma.product.create({ data: { tenantId: id, catalogId: main.id, name: "Produit", tags: [] } });
    await prisma.product.create({ data: { tenantId: id, catalogId: second.id, name: "Produit 2", tags: [] } });
    await prisma.product.create({ data: { tenantId: other, catalogId: foreignCatalog.id, name: "Secret", tags: [] } });
    const make = (data: { name: string; catalogId?: string; active?: boolean }) => prisma.quiz.create({ data: {
      tenantId: id, catalogId: main.id, quizTitle: `Titre ${data.name}`, ctaText: "Voir", ...data,
    } });
    const shared = await make({ name: "Partagé" });
    const standalone = await make({ name: "Sans campagne", catalogId: second.id });
    const inactive = await make({ name: "Inactif", active: false });
    const foreign = await prisma.quiz.create({ data: {
      tenantId: other, catalogId: foreignCatalog.id, name: "Quiz étranger", quizTitle: "Secret", ctaText: "Voir",
    } });
    for (const quizId of [shared.id, standalone.id]) await prisma.question.create({ data: {
      tenantId: id, quizId, text: "Question ?", answers: { create: [{ text: "Oui", order: 0, impacts: {} }] },
    } });
    await prisma.question.create({ data: { tenantId: id, quizId: shared.id, text: "Inactive", active: false, answers: { create: [] } } });
    for (const name of ["Une", "Deux", "Trois"]) await prisma.campaign.create({ data: {
      tenantId: id, quizId: shared.id, name, occasion: "PERMANENT", objectives: [],
      status: name === "Deux" ? "PAUSED" : "ACTIVE",
    } });
    await prisma.campaign.create({ data: { tenantId: other, quizId: foreign.id, name: "Campagne étrangère", occasion: "SPRING", objectives: [] } });
    await prisma.quizEditorDraft.create({ data: { tenantId: id, quizId: shared.id, content: { config: { name: "Partagé" } } } });
    await prisma.metric.createMany({ data: [
      { tenantId: id, quizId: shared.id, type: "quiz_start" }, { tenantId: id, quizId: shared.id, type: "quiz_start" },
      { tenantId: id, quizId: shared.id, type: "quiz_complete" }, { tenantId: id, quizId: shared.id, type: "buy_click" },
      { tenantId: other, quizId: foreign.id, type: "quiz_start" },
    ] });
    // Outside the 30-day window: must not be counted.
    await prisma.metric.create({ data: { tenantId: id, quizId: standalone.id, type: "quiz_start", createdAt: new Date(Date.now() - 90 * 86_400_000) } });

    await t.test("quiz partagé compté une fois, quiz sans campagne, inactif et plusieurs catalogues", async () => {
      const result = await overview();
      assert.equal(result.experiences.length, 3);
      const byId = new Map(result.experiences.map((item) => [item.id, item]));
      const sharedItem = byId.get(shared.id)!;
      assert.deepEqual(sharedItem.campaigns.map((item) => item.name).sort(), ["Deux", "Trois", "Une"]);
      assert.deepEqual(sharedItem.stats, { started: 2, completed: 1, productClicks: 1 });
      assert.equal(sharedItem.hasDraft, true);
      assert.ok(sharedItem.draftUpdatedAt);
      assert.equal(sharedItem.questionCount, 1);
      assert.equal(sharedItem.accessible, true);
      assert.equal(sharedItem.catalog.name, "Principal");
      const standaloneItem = byId.get(standalone.id)!;
      assert.deepEqual(standaloneItem.campaigns, []);
      assert.equal(standaloneItem.stats, null);
      assert.equal(standaloneItem.hasDraft, false);
      assert.equal(standaloneItem.catalog.name, "Second");
      const inactiveItem = byId.get(inactive.id)!;
      assert.equal(inactiveItem.accessible, false);
      assert.equal(inactiveItem.correction, "Aucune question active.");
    });

    await t.test("isolation entre boutiques", async () => {
      const text = JSON.stringify(await overview());
      for (const secret of ["Quiz étranger", "Campagne étrangère", "Étranger", foreign.id]) assert.ok(!text.includes(secret), secret);
      const foreignResult = await overview(other);
      assert.deepEqual(foreignResult.experiences.map((item) => item.name), ["Quiz étranger"]);
      assert.deepEqual(foreignResult.experiences[0].stats, { started: 1, completed: 0, productClicks: 0 });
    });

    await t.test("boutique désactivée : aucune expérience accessible, lecture seule", async () => {
      const before = await prisma.quiz.count({ where: { tenantId: id } });
      await prisma.tenant.update({ where: { id }, data: { active: false } });
      const result = await overview();
      assert.equal(result.shopActive, false);
      assert.ok(result.experiences.every((item) => !item.accessible));
      assert.equal(await prisma.quiz.count({ where: { tenantId: id } }), before);
    });
  } finally {
    await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
    await prisma.tenant.deleteMany({ where: { id: { in: [id, other] } } });
    await prisma.$disconnect();
    if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret;
  }
});
