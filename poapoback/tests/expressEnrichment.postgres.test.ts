import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import type { ExpressProposal, ExpressValidation, ProductEnrichmentEstimateResponse, QuizPublicationDiagnostic } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import catalogsRouter from "../src/routes/catalogs";
import catalogRouter from "../src/routes/catalog";
import expressQuizRouter from "../src/routes/expressQuiz";
import quizzesRouter from "../src/routes/quizzes";
import { quizErrorHandler } from "../src/services/quizzes";

// Parcours commerçant sur plan Starter, sans service IA ni OpenAI : produits → brouillon Express → enrichissement local
// → vérification → publication. Le worker d'embeddings n'est pas démarré : la file reste en base (état « non prêt »).
test("PostgreSQL : Starter — brouillon, enrichissement local validé, vérification puis publication", {
  skip: process.env.POAPO_TEST_EXPRESS_ENRICHMENT !== "1",
}, async () => {
  process.env.JWT_SECRET = "express-enrichment-only";
  delete process.env.AI_SERVICE_URL;
  const app = express();
  app.use(express.json());
  app.use("/api/catalogs", catalogsRouter);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/express-quiz", expressQuizRouter);
  app.use("/api/quizzes", quizzesRouter);
  app.use(quizErrorHandler);
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const tenantId = `express-enrich-${randomUUID()}`;
  const otherId = `express-enrich-${randomUUID()}`;
  try {
    await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test`, industry: "Parfumerie" } }); // aucune souscription : Starter
    await prisma.tenant.create({ data: { id: otherId, email: `${otherId}@example.test` } });
    const catalog = await prisma.catalog.create({ data: { tenantId, name: "Parfums", isDefault: true } });
    const products = [
      ["Aube Citronnée", ["frais", "léger", "agrumes"], "Eau de toilette vive : citron, bergamote. Légère."],
      ["Brise de Lin", ["frais", "léger"], "Lin frais et musc blanc, discret."],
      ["Nuit de Velours", ["intense", "oriental"], "Parfum intense : oud et patchouli, fort sillage."],
      ["Forêt Profonde", ["boisé", "modéré"], "Cèdre, vétiver et mousse de chêne. Boisé."],
      ["Vanille Gourmande", ["gourmand", "vanille"], "Vanille, caramel et fève tonka. Gourmand."],
      ["Mystère", [], "Un grand classique."],
    ] as const;
    for (const [name, tags, description] of products) {
      await prisma.product.create({ data: { tenantId, catalogId: catalog.id, name, tags: [...tags], description, attributes: {} } });
    }
    const token = jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET!);
    const call = (path: string, method = "GET", body?: unknown, auth: string | null = token) =>
      fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(auth && { Authorization: `Bearer ${auth}` }) },
        ...(body !== undefined && { body: JSON.stringify(body) }) });
    const enrichment = `/api/catalogs/${catalog.id}/enrichment`;

    // 1. Aucun embedding prêt : l'état est lisible et le brouillon n'est pas présenté comme fiable.
    const readiness = await (await call(`/api/catalog/embeddings?catalogId=${catalog.id}`)).json();
    assert.deepEqual([readiness.total, readiness.ready, readiness.pending], [6, 0, 6]);
    const proposal = await (await call("/api/express-quiz/analyze", "POST", { catalogId: catalog.id })).json() as ExpressProposal;
    assert.equal(proposal.analysis.semanticProducts, 0);
    assert.equal(proposal.analysis.reliability, "insufficient");
    assert.ok(proposal.draft, "Express génère un brouillon avant que les embeddings soient prêts");

    // 2. Brouillon enregistré tel quel : possible (avec confirmation), mais la publication est bloquée en langage commerçant.
    const rejected = await call("/api/express-quiz/save", "POST", { catalogId: catalog.id, draft: proposal.draft });
    assert.equal(rejected.status, 409);
    const saved = await (await call("/api/express-quiz/save", "POST", { catalogId: catalog.id, draft: proposal.draft, acknowledgeLimits: true })).json() as { quizId: string };
    const quizId = saved.quizId;
    let draft = await (await call(`/api/quizzes/${quizId}/draft`)).json();
    const blocked = await (await call(`/api/quizzes/${quizId}/publication/check`, "POST", { revision: draft.revision })).json() as QuizPublicationDiagnostic;
    assert.equal(blocked.valid, false);
    const issue = blocked.errors.find((e) => e.code === "NO_USABLE_ATTRIBUTES");
    assert.equal(issue?.message, "Les informations de vos produits ne permettent pas encore de proposer des recommandations fiables.");
    draft.draft.config.active = true;
    const put = await (await call(`/api/quizzes/${quizId}/draft`, "PUT", { draft: draft.draft, revision: draft.revision })).json();
    assert.equal((await call(`/api/quizzes/${quizId}/publication/publish`, "POST", { revision: put.revision, confirm: true })).status, 422);
    assert.ok(await prisma.quizEditorDraft.findFirst({ where: { quizId } }), "le brouillon reste enregistré");

    // 3. Enrichissement local depuis les axes du brouillon (Starter) : aucune écriture avant validation.
    const axes = proposal.draft!.axes.map(({ key, label, lowLabel, highLabel }) => ({ key, label, lowLabel, highLabel }));
    const axisKeys = axes.map((a) => a.key);
    const estimate = await call(`${enrichment}/estimate-local`, "POST", { axes, axisKeys });
    assert.equal(estimate.status, 200);
    const estimated = await estimate.json() as ProductEnrichmentEstimateResponse;
    assert.equal(await prisma.product.count({ where: { tenantId, NOT: { attributes: { equals: {} } } } }), 0, "estimation sans écriture");
    assert.equal((await call(`${enrichment}/estimate`, "POST", { quizId, axisKeys, productIds: [estimated.results[0].productId] })).status, 403, "l'IA reste réservée");
    assert.equal((await call(`${enrichment}/estimate-local`, "POST", { axes, axisKeys }, jwt.sign({ tenantId: otherId, email: "x@example.test" }, process.env.JWT_SECRET!))).status, 404);
    // Le commerçant valide les propositions à confiance moyenne ou élevée.
    const updates = estimated.results.map((r) => {
      const values: Record<string, number> = {}, expected: Record<string, number | null> = {};
      for (const e of r.estimates) if (e.status === "estimated" && e.confidence !== "low" && r.currentValues[e.axis] === null) { values[e.axis] = e.value!; expected[e.axis] = null; }
      return { productId: r.productId, values, expected, overwrite: [] as string[] };
    }).filter((u) => Object.keys(u.values).length);
    assert.ok(updates.length >= 4);
    const applied = await call(`${enrichment}/apply`, "POST", { axes, updates });
    assert.equal(applied.status, 200, await applied.clone().text());
    // Rejouer les mêmes mises à jour : les valeurs existent désormais, rien n'est écrasé.
    const replay = await call(`${enrichment}/apply`, "POST", { axes, updates });
    assert.equal(replay.status, 409);
    // Les embeddings sont remis en file : les recommandations ne sont toujours pas annoncées comme prêtes.
    const after = await (await call(`/api/catalog/embeddings?catalogId=${catalog.id}`)).json();
    assert.deepEqual([after.ready, after.pending], [0, 6]);

    // 4. Revalidation du même brouillon puis publication du brouillon enregistré.
    const validation = await (await call("/api/express-quiz/validate", "POST", { catalogId: catalog.id, draft: proposal.draft })).json() as ExpressValidation;
    assert.notEqual(validation.reliability, "insufficient");
    draft = await (await call(`/api/quizzes/${quizId}/draft`)).json();
    const ready = await (await call(`/api/quizzes/${quizId}/publication/check`, "POST", { revision: draft.revision })).json() as QuizPublicationDiagnostic;
    assert.equal(ready.valid, true, JSON.stringify(ready.errors));
    assert.ok(ready.warnings.some((w) => w.code === "PENDING_EMBEDDINGS"), "la préparation en cours est signalée");
    const published = await call(`/api/quizzes/${quizId}/publication/publish`, "POST", { revision: draft.revision, confirm: true });
    assert.equal(published.status, 200, await published.clone().text());
    assert.equal((await prisma.quiz.findUniqueOrThrow({ where: { id: quizId } })).active, true);
  } finally {
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherId] } } }).catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }
});
