import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../src/lib/prisma";
import catalogsRouter from "../src/routes/catalogs";
import importRouter from "../src/routes/import";
import { quizErrorHandler } from "../src/services/quizzes";
import { profileColumns } from "../src/services/catalogProfile";
import { describeImportColumns } from "../src/services/importColumns";
import { suggestMapping } from "../src/services/importMapping";
import { perfumeCatalog } from "./fixtures/catalogProfileFixtures";

// Opt-in (écrit dans la base configurée, sur un tenant isolé supprimé en fin de test) : POAPO_TEST_IMPORT_DB=1.
// Aucun embedding n'est lancé (AI_SERVICE_URL retiré) ; aucune donnée existante n'est lue ni modifiée.
test("PostgreSQL : import Parfum avec informations supplémentaires confirmées → produits enregistrés → diagnostic 10B ; quiz existant intact", {
  skip: process.env.POAPO_TEST_IMPORT_DB !== "1",
}, async () => {
  process.env.JWT_SECRET = "import-db-only";
  delete process.env.AI_SERVICE_URL;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/catalogs", catalogsRouter);
  app.use("/api/catalog/import", importRouter);
  app.use(quizErrorHandler);
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const tenantId = `import-${randomUUID()}`;
  try {
    const tenant = await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test` } });
    await prisma.subscription.create({ data: { tenantId, plan: "BUSINESS", source: "LEGACY" } });
    const token = jwt.sign({ tenantId, email: tenant.email }, process.env.JWT_SECRET!);
    const call = (path: string, body?: unknown) => fetch(base + path, {
      method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const catalogs = await (await call("/api/catalogs")).json() as { id: string }[];
    const catalogId = catalogs[0].id;
    const axes = [{ key: "intensite", label: "Intensité", lowLabel: null, highLabel: null }];
    const quiz = await prisma.quiz.create({ data: { tenantId, catalogId, name: "Quiz existant", quizTitle: "T", ctaText: "C", axes } });

    const headers = ["Nom", "Prix", "Genre", "Famille olfactive", "Notes", "Intensité"];
    const rows = perfumeCatalog().products.map((p) => {
      const a = p.attributes as Record<string, unknown>;
      return { Nom: p.name, Prix: `${p.price},00 €`, Genre: String(a.genre), "Famille olfactive": String(a.famille), Notes: `${p.tags[0]}, ${p.tags[1]}`, "Intensité": String(a.intensity).replace(".", ",") };
    });
    const suggested = suggestMapping(headers, axes);
    const columns = describeImportColumns(headers, rows, suggested, new Set(["intensite"]));
    const mapping = suggested.map((m) => ({ ...m, targetField: m.targetField ?? columns.find((c) => c.sourceColumn === m.sourceColumn)!.suggestion!.targetField }));

    const preview = await (await call("/api/catalog/import/preview", { mapping, rows, catalogId })).json() as { canImport: boolean; valid: number };
    assert.equal(preview.canImport, true);
    assert.equal(preview.valid, 40);
    assert.equal(await prisma.product.count({ where: { tenantId } }), 0, "l'aperçu n'écrit rien");
    const executed = await call("/api/catalog/import/execute", { mapping, rows, catalogId });
    assert.equal(executed.status, 200, await executed.clone().text());
    assert.equal(((await executed.json()) as { created: number }).created, 40);

    const stored = await prisma.product.findMany({ where: { tenantId, catalogId }, select: { price: true, brand: true, tags: true, attributes: true } });
    assert.equal(stored.length, 40);
    const profiles = profileColumns(stored, { axisKeys: ["intensite"] });
    const type = (key: string) => profiles.find((p) => p.key === key)?.inferredType;
    assert.equal(type("price"), "RANGE");
    assert.equal(type("attribute.genre"), "CATEGORICAL");
    assert.equal(type("attribute.famille_olfactive"), "CATEGORICAL");
    assert.equal(type("attribute.intensite"), "NUMERIC");
    assert.ok(stored.every((p) => p.tags.length === 0), "les notes ne sont pas découpées en tags");

    const after = await prisma.quiz.findUniqueOrThrow({ where: { id: quiz.id } });
    assert.deepEqual([after.axes, after.updatedAt.getTime()], [quiz.axes, quiz.updatedAt.getTime()], "le quiz existant n'a pas bougé");
  } finally {
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    server.close();
    await prisma.$disconnect();
  }
});
