import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import type { DashboardSummary } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import dashboardRouter from "../src/routes/dashboard";
import { quizErrorHandler } from "../src/services/quizzes";

test("PostgreSQL : accueil isolé, données réelles et lecture seule", {
  skip: process.env.POAPO_TEST_DASHBOARD_DB !== "1",
}, async (t) => {
  const id = `dashboard-${randomUUID()}`;
  const other = `${id}-other`;
  let server: Server | undefined;
  const secret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "dashboard-test-only";
  try {
    for (const tenantId of [id, other]) {
      await prisma.tenant.create({
      data: { id: tenantId, email: `${tenantId}@example.test`, name: tenantId === id ? "La boutique test" : "Autre boutique" },
    });
      await prisma.subscription.create({ data: { tenantId: tenantId, plan: "BUSINESS", source: "LEGACY" } }); // fixtures : hors quotas
    }
    const app = express();
    app.use("/api/dashboard", dashboardRouter);
    app.use(quizErrorHandler);
    server = await new Promise<Server>((resolve) => {
      const running = app.listen(0, "127.0.0.1", () => resolve(running));
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/dashboard`;
    const token = (tenantId: string, isSuperAdmin = false) =>
      jwt.sign({ tenantId, email: `${tenantId}@example.test`, isSuperAdmin }, process.env.JWT_SECRET!);
    const request = (authorization?: string) => fetch(url, {
      headers: authorization ? { Authorization: `Bearer ${authorization}` } : {},
    });
    const summary = async (tenantId = id) => {
      const response = await request(token(tenantId));
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get("cache-control"), "no-store");
      return response.json() as Promise<DashboardSummary>;
    };
    await t.test("compte vide sans création implicite, authentification et super-administrateur", async () => {
      assert.equal((await request()).status, 401);
      assert.equal((await request("invalid")).status, 401);
      assert.equal((await request(token("super-admin"))).status, 403);
      assert.equal((await request(token(id, true))).status, 403);
      const empty = await summary();
      assert.equal(empty.products, 0);
      assert.equal(empty.catalogs, 0);
      assert.deepEqual(empty.experiences, []);
      assert.deepEqual(empty.totals, { started: 0, completed: 0, productClicks: 0, accessible: 0 });
      assert.equal(await prisma.quiz.count({ where: { tenantId: id } }), 0);
    });
    const catalog = await prisma.catalog.create({ data: { tenantId: id, name: "Principal" } });
    const catalog2 = await prisma.catalog.create({ data: { tenantId: id, name: "Second" } });
    const foreignCatalog = await prisma.catalog.create({ data: { tenantId: other, name: "Étranger" } });
    const product = await prisma.product.create({ data: { tenantId: id, catalogId: catalog.id, name: "Produit", tags: [] } });
    await prisma.product.create({ data: { tenantId: id, catalogId: catalog2.id, name: "Inactif", active: false, tags: [] } });
    await prisma.product.create({ data: { tenantId: other, catalogId: foreignCatalog.id, name: "Secret", tags: [] } });
    const quiz = await prisma.quiz.create({ data: {
      tenantId: id, catalogId: catalog.id, name: "Partagé", quizTitle: "Titre", ctaText: "Voir", active: true,
    } });
    const standalone = await prisma.quiz.create({ data: {
      tenantId: id, catalogId: catalog2.id, name: "Sans campagne", quizTitle: "Titre", ctaText: "Voir", active: false,
    } });
    const manual = await prisma.quiz.create({ data: {
      tenantId: id, catalogId: catalog.id, name: "Sélection inactive", quizTitle: "Titre", ctaText: "Voir",
      useAllProducts: false, products: { create: { productId: product.id } },
    } });
    for (const quizId of [quiz.id, manual.id]) await prisma.question.create({
      data: { tenantId: id, quizId, text: "Question ?", answers: { create: { text: "Réponse", impacts: {} } } },
    });
    for (const name of ["Occasion A", "Occasion B"]) await prisma.campaign.create({
      data: { tenantId: id, quizId: quiz.id, name, occasion: "PERMANENT", objectives: [], status: "PAUSED" },
    });
    await prisma.quizEditorDraft.create({ data: { tenantId: id, quizId: standalone.id, content: { schemaVersion: 1 }, revision: 3 } });
    await prisma.quizEditorDraft.create({ data: { tenantId: id, quizId: quiz.id, content: Prisma.DbNull } });
    await prisma.metric.createMany({ data: [
      { tenantId: id, quizId: quiz.id, type: "quiz_start" },
      { tenantId: id, quizId: quiz.id, type: "quiz_complete" },
      { tenantId: id, quizId: quiz.id, type: "buy_click" },
      { tenantId: id, quizId: quiz.id, type: "quiz_start", createdAt: new Date(Date.now() - 40 * 86400000) },
    ] });
    await t.test("quiz partagé compté une fois, quiz sans campagne et brouillon sauvegardé", async () => {
      const data = await summary();
      assert.equal(data.shop.name, "La boutique test");
      assert.equal(data.products, 2);
      assert.equal(data.catalogs, 2);
      assert.equal(data.experiences.length, 3);
      assert.deepEqual(data.totals, { started: 1, completed: 1, productClicks: 1, accessible: 2 });
      assert.deepEqual(data.nextAction, { kind: "draft", quizId: standalone.id });
      assert.equal(data.experiences.find((item) => item.id === standalone.id)?.hasDraft, true);
      assert.equal(data.experiences.find((item) => item.id === quiz.id)?.hasDraft, false);
      const foreign = await summary(other);
      assert.equal(foreign.products, 1);
      assert.equal(foreign.catalogs, 1);
      assert.equal(foreign.experiences.length, 0);
      assert.equal(foreign.totals.started, 0);
    });
    await t.test("disponibilité du compte, correction et sélection manuelle sans produit actif", async () => {
      await prisma.tenant.update({ where: { id }, data: { active: false } });
      await prisma.product.update({ where: { id: product.id }, data: { active: false } });
      const data = await summary();
      assert.equal(data.totals.accessible, 0);
      assert.equal(data.experiences.find((item) => item.id === manual.id)?.correction, "Aucun produit actif recommandable.");
      assert.equal(await prisma.metric.count({ where: { tenantId: id } }), 4);
      assert.equal(await prisma.quizSession.count({ where: { tenantId: id } }), 0);
      assert.equal(await prisma.quizEditorDraft.count({ where: { tenantId: id } }), 2);
    });
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((err) => err ? reject(err) : resolve()));
    await prisma.tenant.deleteMany({ where: { id: { in: [id, other] } } });
    await prisma.$disconnect();
    if (secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = secret;
  }
});
