import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import type { QuizEditorDraftResponse } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import quizzesRouter from "../src/routes/quizzes";
import { quizErrorHandler } from "../src/services/quizzes";
import { ensureStarterSubscription } from "../src/services/subscriptions";

// Express réel + PostgreSQL réel, boutiques jetables supprimées en fin de test. Aucun appel externe.
const run = randomUUID().slice(0, 8);
const tenants: string[] = [];
let api: Server, base = "";

async function shop(plan: "STARTER" | "BUSINESS", quizzes: { active: boolean }[]) {
  const id = `quota-${run}-${tenants.length}`;
  tenants.push(id);
  await prisma.tenant.create({ data: { id, email: `${id}@example.test` } });
  if (plan === "STARTER") await ensureStarterSubscription(prisma, id);
  else await prisma.subscription.create({ data: { tenantId: id, plan: "BUSINESS", source: "LEGACY" } });
  const catalog = await prisma.catalog.create({ data: { tenantId: id, name: "Catalogue", isDefault: true } });
  const product = await prisma.product.create({ data: { tenantId: id, catalogId: catalog.id, name: "Produit", tags: [], attributes: { pace: 0.3 } } });
  const created = [];
  for (const [index, spec] of quizzes.entries()) {
    const quiz = await prisma.quiz.create({ data: {
      tenantId: id, catalogId: catalog.id, name: `Quiz ${index}`, active: spec.active, quizTitle: "Titre", ctaText: "Go",
      axes: [{ key: "pace", label: "Rythme", lowLabel: "Calme", highLabel: "Intense" }],
      useAllProducts: false, products: { create: { productId: product.id } },
    } });
    await prisma.question.create({ data: { tenantId: id, quizId: quiz.id, text: "Rythme ?", order: 0,
      answers: { create: { text: "Calme", order: 0, impacts: { pace: -0.2 } } } } });
    created.push(quiz);
  }
  const token = jwt.sign({ tenantId: id, email: `${id}@example.test` }, process.env.JWT_SECRET!);
  const call = (path: string, method = "GET", body?: unknown) => fetch(base + path, { method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { id, quizzes: created, call };
}
type Shop = Awaited<ReturnType<typeof shop>>;

/** Enregistre un brouillon modifié (titre + activation souhaitée) et renvoie sa révision. */
async function saveDraft(s: Shop, quizId: string, active: boolean, title = "Titre brouillon") {
  const read = await (await s.call(`/api/quizzes/${quizId}/draft`)).json() as QuizEditorDraftResponse;
  read.draft.config.active = active;
  read.draft.config.quizTitle = title;
  const saved = await s.call(`/api/quizzes/${quizId}/draft`, "PUT", { draft: read.draft, revision: read.revision });
  assert.equal(saved.status, 200, await saved.clone().text());
  return ((await saved.json()) as QuizEditorDraftResponse).revision;
}
const publish = (s: Shop, quizId: string, revision: number) =>
  s.call(`/api/quizzes/${quizId}/publication/publish`, "POST", { revision, confirm: true });
const activeCount = (id: string) => prisma.quiz.count({ where: { tenantId: id, active: true } });

before(async () => {
  process.env.JWT_SECRET = "quota-secret";
  const app = express(); app.use(express.json()); app.use("/api/quizzes", quizzesRouter); app.use(quizErrorHandler);
  api = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  base = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
});
after(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  api.close(); await prisma.$disconnect();
});

test("Starter, un quiz actif : l'activation d'un second quiz est refusée (PUT)", async () => {
  const s = await shop("STARTER", [{ active: true }, { active: false }]);
  const res = await s.call(`/api/quizzes/${s.quizzes[1].id}`, "PUT", { active: true });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "quota_exceeded");
  assert.equal(await activeCount(s.id), 1);
});

test("même scénario via publication/publish : refus identique, rien de publié", async () => {
  const s = await shop("STARTER", [{ active: true }, { active: false }]);
  const target = s.quizzes[1];
  const revision = await saveDraft(s, target.id, true, "Titre à publier");
  const res = await publish(s, target.id, revision);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.code, "quota_exceeded");
  assert.equal(body.details.quota, "publishedExperiences");
  // Aucune publication partielle : quiz inchangé, brouillon conservé à la même révision.
  const after = await prisma.quiz.findUniqueOrThrow({ where: { id: target.id } });
  assert.deepEqual([after.active, after.quizTitle], [false, "Titre"]);
  const row = await prisma.quizEditorDraft.findUniqueOrThrow({ where: { quizId: target.id } });
  assert.deepEqual([row.revision, row.content !== null], [revision, true]);
  assert.equal(await activeCount(s.id), 1);
});

test("publication d'un quiz qui reste inactif : autorisée, sans consommer de quota", async () => {
  const s = await shop("STARTER", [{ active: true }, { active: false }]);
  const target = s.quizzes[1];
  const res = await publish(s, target.id, await saveDraft(s, target.id, false, "Nouveau titre"));
  assert.equal(res.status, 200, await res.clone().text());
  const after = await prisma.quiz.findUniqueOrThrow({ where: { id: target.id } });
  assert.deepEqual([after.active, after.quizTitle], [false, "Nouveau titre"]);
});

test("publication d'un quiz déjà actif : autorisée à la limite", async () => {
  const s = await shop("STARTER", [{ active: true }, { active: false }]);
  const target = s.quizzes[0];
  const res = await publish(s, target.id, await saveDraft(s, target.id, true, "Titre actif modifié"));
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await prisma.quiz.findUniqueOrThrow({ where: { id: target.id } })).quizTitle, "Titre actif modifié");
  assert.equal(await activeCount(s.id), 1);
});

test("désactivation par publication : autorisée, puis la place est de nouveau disponible", async () => {
  const s = await shop("STARTER", [{ active: true }, { active: false }]);
  assert.equal((await publish(s, s.quizzes[0].id, await saveDraft(s, s.quizzes[0].id, false))).status, 200);
  assert.equal(await activeCount(s.id), 0);
  assert.equal((await publish(s, s.quizzes[1].id, await saveDraft(s, s.quizzes[1].id, true))).status, 200);
  assert.equal(await activeCount(s.id), 1);
});

test("activation dans la limite du quota : autorisée (PUT et publication)", async () => {
  const s = await shop("STARTER", [{ active: false }, { active: false }]);
  assert.equal((await s.call(`/api/quizzes/${s.quizzes[0].id}`, "PUT", { active: true })).status, 200);
  const b = await shop("STARTER", [{ active: false }]);
  assert.equal((await publish(b, b.quizzes[0].id, await saveDraft(b, b.quizzes[0].id, true))).status, 200);
  assert.equal(await activeCount(b.id), 1);
});

test("deux publications concurrentes pour une seule place : une seule réussit", async () => {
  const s = await shop("STARTER", [{ active: false }, { active: false }]);
  const [a, b] = s.quizzes;
  const [revA, revB] = [await saveDraft(s, a.id, true), await saveDraft(s, b.id, true)];
  const results = await Promise.all([publish(s, a.id, revA), publish(s, b.id, revB)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 403]);
  const refused = results.find((r) => r.status === 403)!;
  assert.equal((await refused.json()).code, "quota_exceeded");
  assert.equal(await activeCount(s.id), 1);
});

test("concurrence PUT activation + publication pour une seule place : une seule réussit", async () => {
  const s = await shop("STARTER", [{ active: false }, { active: false }]);
  const [a, b] = s.quizzes;
  const revB = await saveDraft(s, b.id, true);
  const results = await Promise.all([s.call(`/api/quizzes/${a.id}`, "PUT", { active: true }), publish(s, b.id, revB)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 403]);
  assert.equal(await activeCount(s.id), 1);
});

test("tenant déjà au-dessus de son quota : pas de nouvelle activation, l'existant reste modifiable et désactivable", async () => {
  const s = await shop("STARTER", [{ active: true }, { active: true }, { active: false }]); // 2 actifs pour une limite de 1
  const [a, b, inactive] = s.quizzes;
  const refusedPut = await s.call(`/api/quizzes/${inactive.id}`, "PUT", { active: true });
  assert.deepEqual([refusedPut.status, (await refusedPut.json()).code], [403, "quota_exceeded"]);
  assert.equal((await publish(s, inactive.id, await saveDraft(s, inactive.id, true))).status, 403);
  assert.equal((await publish(s, a.id, await saveDraft(s, a.id, true, "Toujours actif"))).status, 200);
  assert.equal((await publish(s, b.id, await saveDraft(s, b.id, false))).status, 200);
  assert.equal(await activeCount(s.id), 1);
  // Revenu à la limite : toujours aucune place.
  assert.equal((await s.call(`/api/quizzes/${inactive.id}`, "PUT", { active: true })).status, 403);
});

test("BUSINESS (illimité) : activations multiples autorisées", async () => {
  const s = await shop("BUSINESS", [{ active: true }, { active: false }]);
  assert.equal((await publish(s, s.quizzes[1].id, await saveDraft(s, s.quizzes[1].id, true))).status, 200);
  assert.equal(await activeCount(s.id), 2);
});
