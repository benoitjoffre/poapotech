import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { DEFAULT_PRIMARY_COLOR } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import catalogsRouter from "../src/routes/catalogs";
import importRouter from "../src/routes/import";
import quizzesRouter from "../src/routes/quizzes";
import quizRouter from "../src/routes/quiz";
import { quizErrorHandler } from "../src/services/quizzes";

// Parcours sur base PostgreSQL vide (migrate deploy) avec poapoai local (AI_SERVICE_URL), sans OpenAI.
test("Base neuve : tenant → catalogue → import idempotent → embeddings → quiz → publication → recommandation", {
  skip: process.env.POAPO_TEST_FRESH_DB !== "1",
}, async () => {
  process.env.JWT_SECRET = "fresh-db-only";
  const app = express();
  app.use(express.json());
  app.use("/api/catalogs", catalogsRouter);
  app.use("/api/catalog/import", importRouter);
  app.use("/api/quizzes", quizzesRouter);
  app.use("/api/quiz", quizRouter);
  app.use(quizErrorHandler);
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const tenantId = `fresh-${randomUUID()}`;
  const otherTenantId = `fresh-${randomUUID()}`;
  try {
    const tenant = await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test` } });
    await prisma.tenant.create({ data: { id: otherTenantId, email: `${otherTenantId}@example.test` } });
    assert.equal(tenant.primaryColor, DEFAULT_PRIMARY_COLOR);
    const token = jwt.sign({ tenantId, email: tenant.email }, process.env.JWT_SECRET!);
    const call = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
      fetch(base + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers },
        ...(body !== undefined && { body: JSON.stringify(body) }) });

    // Catalogue principal créé à la demande, puis catalogue secondaire.
    const list = await (await call("/api/catalogs")).json() as { id: string; isDefault: boolean }[];
    assert.equal(list.length, 1);
    assert.ok(list[0].isDefault);
    const catalogId = list[0].id;

    // Import de 10 produits.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      Nom: `Produit ${i}`, Description: i % 2 ? "Chaleureux et doux" : "Frais et vif", Calme: String(i / 10),
    }));
    const mapping = [
      { sourceColumn: "Nom", targetField: "name" },
      { sourceColumn: "Description", targetField: "description" },
      { sourceColumn: "Calme", targetField: "attribute.calm" },
    ];
    const body = { mapping, rows, catalogId };
    const key = { "Idempotency-Key": randomUUID() };
    const first = await call("/api/catalog/import/execute", "POST", body, key);
    assert.equal(first.status, 200, await first.clone().text());
    const firstBody = await first.json();
    assert.equal(firstBody.created, 10);
    assert.equal(firstBody.embeddings, "queued");

    // Rejeu avec la même clé : aucun nouveau produit.
    const replay = await call("/api/catalog/import/execute", "POST", body, key);
    assert.equal(replay.status, 200);
    const replayBody = await replay.json();
    assert.equal(replayBody.replayed, true);
    assert.equal(replayBody.created, 10);
    // Même fichier, nouvelle clé : refusé sauf demande explicite.
    const dup = await call("/api/catalog/import/execute", "POST", body, { "Idempotency-Key": randomUUID() });
    assert.equal(dup.status, 409);
    assert.equal((await dup.json()).code, "duplicate_import");
    // Même clé, fichier différent.
    const reused = await call("/api/catalog/import/execute", "POST", { ...body, rows: rows.slice(0, 2) }, key);
    assert.equal(reused.status, 422);
    assert.equal(await prisma.product.count({ where: { tenantId } }), 10);
    // Import volontaire : doublons de noms conservés, jamais fusionnés.
    const again = await call("/api/catalog/import/execute", "POST", { ...body, rows: rows.slice(0, 2), allowDuplicate: true }, { "Idempotency-Key": randomUUID() });
    assert.equal(again.status, 200);
    assert.equal(await prisma.product.count({ where: { tenantId } }), 12);
    // Isolation tenant : l'autre tenant ne voit rien.
    assert.equal(await prisma.importBatch.count({ where: { tenantId: otherTenantId } }), 0);

    // Embeddings persistés (génération en arrière-plan).
    const deadline = Date.now() + 60_000;
    let embedded = 0;
    while (Date.now() < deadline) {
      embedded = (await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Product" WHERE "tenantId" = ${tenantId} AND embedding IS NOT NULL AND embedding::text <> 'null'`)[0].n as unknown as number;
      if (Number(embedded) >= 12) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(Number(embedded), 12);

    // Quiz → brouillon → publication.
    const quiz = await (await call("/api/quizzes", "POST", {
      name: "Quiz", catalogId, axes: [{ key: "calm", label: "Calme" }], quizTitle: "Titre", ctaText: "Go",
    })).json() as { id: string };
    const q = await prisma.question.create({ data: {
      tenantId, quizId: quiz.id, text: "Ambiance ?", order: 0,
      answers: { create: [{ text: "Très calme", impacts: { calm: 0.5 }, order: 0 }, { text: "Vif", impacts: { calm: -0.5 }, order: 1 }] },
    }, include: { answers: true } });
    const draft = await (await call(`/api/quizzes/${quiz.id}/draft`)).json();
    draft.draft.config.active = true;
    const saved = await call(`/api/quizzes/${quiz.id}/draft`, "PUT", { draft: draft.draft, revision: draft.revision });
    assert.equal(saved.status, 200, await saved.clone().text());
    const published = await call(`/api/quizzes/${quiz.id}/publication/publish`, "POST", { revision: (await saved.json()).revision, confirm: true });
    assert.equal(published.status, 200, await published.clone().text());

    // Recommandation publique : utilise les embeddings générés.
    const submit = await fetch(`${base}/api/quiz/submit`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: tenantId, quizId: quiz.id, answers: [{ questionId: q.id, answerId: q.answers[0].id }] }) });
    assert.equal(submit.status, 200, await submit.clone().text());
    const result = await submit.json();
    assert.ok(result.product.id);
    assert.equal(result.product.id && (await prisma.product.count({ where: { id: result.product.id, tenantId, catalogId } })), 1);
  } finally {
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } }).catch(() => undefined);
    server.close();
    await prisma.$disconnect();
  }
});
