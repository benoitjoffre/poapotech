import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createServer, type Server } from "node:http";
import { prisma } from "../src/lib/prisma";
import { MAX_EMBEDDING_ATTEMPTS, embeddingSummary, enqueueEmbeddings, retryEmbeddings, runEmbeddingBatch } from "../src/services/embeddings";

// File d'embeddings sur PostgreSQL réel avec un faux moteur IA : aucun appel OpenAI ni modèle local.
test("PostgreSQL : file d'embeddings — reprise, échecs visibles, bail, version, isolation tenant", {
  skip: process.env.POAPO_TEST_EMBEDDINGS_DB !== "1",
}, async () => {
  const run = randomUUID();
  const tenants = [`emb-a-${run}`, `emb-b-${run}`];
  const calls: { id: string; axes: { key: string }[] }[] = [];
  let ready = true;
  let embedStatus = 200;
  let onEmbed: (() => Promise<void>) | null = null;
  const ai: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      if (req.url === "/ready") { res.statusCode = ready ? 200 : 503; res.end("{}"); return; }
      const payload = JSON.parse(body);
      calls.push({ id: payload.id, axes: payload.axes });
      await onEmbed?.();
      res.statusCode = embedStatus;
      res.setHeader("Content-Type", "application/json");
      res.end(embedStatus === 200 ? JSON.stringify({ embedding: [0.1, 0.2] }) : JSON.stringify({ detail: "boom" }));
    });
  });
  await new Promise<void>((resolve) => ai.listen(0, "127.0.0.1", resolve));
  const address = ai.address();
  assert.ok(address && typeof address !== "string");
  const previousUrl = process.env.AI_SERVICE_URL;
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${address.port}`;
  const state = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });
  try {
    const products: Record<string, string> = {};
    for (const [i, tenantId] of tenants.entries()) {
      await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test` } });
      await prisma.subscription.create({ data: { tenantId: tenantId, plan: "BUSINESS", source: "LEGACY" } }); // fixtures : hors quotas
      const catalog = await prisma.catalog.create({ data: { tenantId, name: "Principal", isDefault: true } });
      const axis = [{ key: i ? "tenant_b_axis" : "tenant_a_axis", label: "Axe" }];
      await prisma.quiz.create({ data: { tenantId, catalogId: catalog.id, name: "Quiz", quizTitle: "Q", ctaText: "Go", axes: axis } });
      products[tenantId] = (await prisma.product.create({ data: { tenantId, catalogId: catalog.id, name: `Produit ${i}` } })).id;
    }
    const [a, b] = tenants.map((t) => products[t]);
    const only = async () => { // isole le lot sur ces deux produits
      await prisma.product.updateMany({ where: { id: { notIn: [a, b] }, embeddingStatus: "PENDING" }, data: { embeddingNextAttemptAt: new Date(Date.now() + 3_600_000) } });
    };
    await only();

    // Un import réussi ne signifie pas « prêt » : le produit naît PENDING.
    assert.equal((await state(a)).embeddingStatus, "PENDING");

    // Moteur arrêté : rien n'est perdu, aucune tentative consommée.
    ready = false;
    assert.equal(await runEmbeddingBatch(), 0);
    assert.deepEqual([(await state(a)).embeddingStatus, (await state(a)).embeddingAttempts], ["PENDING", 0]);

    // Échec du calcul : tentative comptée, erreur conservée, relance différée.
    ready = true; embedStatus = 500;
    await runEmbeddingBatch();
    const failedOnce = await state(a);
    assert.equal(failedOnce.embeddingStatus, "PENDING");
    assert.equal(failedOnce.embeddingAttempts, 1);
    assert.ok(failedOnce.embeddingError);
    assert.ok(failedOnce.embeddingNextAttemptAt && failedOnce.embeddingNextAttemptAt > new Date());
    const before = calls.length;
    await runEmbeddingBatch();
    assert.equal(calls.length, before, "pas de nouvelle tentative avant l'échéance");

    // Tentatives épuisées : FAILED, visible dans le résumé, puis reprise manuelle limitée au tenant.
    await prisma.product.updateMany({ where: { id: { in: [a, b] } }, data: { embeddingAttempts: MAX_EMBEDDING_ATTEMPTS - 1, embeddingNextAttemptAt: null, embeddingStatus: "PENDING" } });
    await runEmbeddingBatch();
    assert.equal((await state(a)).embeddingStatus, "FAILED");
    assert.equal((await state(b)).embeddingStatus, "FAILED");
    const summary = await embeddingSummary(tenants[0]);
    assert.deepEqual([summary.total, summary.failed, summary.ready], [1, 1, 0]);
    assert.ok(summary.lastError);
    assert.equal(await runEmbeddingBatch(), 0, "un produit FAILED n'est jamais retraité seul");
    assert.equal(await retryEmbeddings(tenants[0]), 1);
    assert.equal((await state(a)).embeddingStatus, "PENDING");
    assert.equal((await state(b)).embeddingStatus, "FAILED", "la reprise d'un tenant ne touche pas l'autre");

    // Succès : READY, embedding écrit, axes du seul catalogue du produit transmis.
    embedStatus = 200; calls.length = 0;
    await runEmbeddingBatch();
    const done = await state(a);
    assert.deepEqual([done.embeddingStatus, done.embedding, done.embeddingError, done.embeddingAttempts], ["READY", [0.1, 0.2], null, 0]);
    assert.deepEqual(calls.map((c) => [c.id, c.axes.map((x) => x.key)]), [[a, ["tenant_a_axis"]]]);

    // Contenu modifié pendant le calcul : le résultat périmé est écarté et le produit repart en file.
    onEmbed = async () => { onEmbed = null; await enqueueEmbeddings([a], tenants[0]); };
    await enqueueEmbeddings([a], tenants[0]);
    await runEmbeddingBatch();
    assert.equal((await state(a)).embeddingStatus, "PENDING");
    await runEmbeddingBatch();
    assert.equal((await state(a)).embeddingStatus, "READY");

    // Bail : un traitement en cours n'est pas repris ; une fois le bail expiré (crash), il l'est.
    await prisma.product.update({ where: { id: a }, data: { embeddingStatus: "PROCESSING", embeddingLockedUntil: new Date(Date.now() + 60_000), embeddingAttempts: 1 } });
    calls.length = 0;
    await runEmbeddingBatch();
    assert.equal(calls.length, 0);
    await prisma.product.update({ where: { id: a }, data: { embeddingLockedUntil: new Date(Date.now() - 1000) } });
    await runEmbeddingBatch();
    assert.equal((await state(a)).embeddingStatus, "READY");

    // Deux workers simultanés (autres instances) ne traitent jamais deux fois le même produit.
    await prisma.product.updateMany({ where: { id: { in: [a, b] } }, data: { embeddingStatus: "PENDING", embeddingAttempts: 0, embeddingNextAttemptAt: null } });
    calls.length = 0;
    const claims = await Promise.all([1, 2, 3].map(() => prisma.$transaction(async (tx) =>
      tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Product" WHERE id IN (${a}, ${b}) AND "embeddingStatus" = 'PENDING' FOR UPDATE SKIP LOCKED`)));
    assert.ok(claims.flat().length >= 2);
  } finally {
    ai.close();
    if (previousUrl === undefined) delete process.env.AI_SERVICE_URL; else process.env.AI_SERVICE_URL = previousUrl;
    await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
    await prisma.$disconnect();
  }
});
