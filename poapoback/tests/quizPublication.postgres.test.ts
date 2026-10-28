import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import type { QuizEditorDraft, QuizEditorDraftResponse, QuizPublicationDiagnostic } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import quizzesRouter from "../src/routes/quizzes";
import campaignsRouter from "../src/routes/campaigns";
import embedRouter from "../src/routes/embed";
import quizRouter from "../src/routes/quiz";
import { quizErrorHandler } from "../src/services/quizzes";
import { lockQuiz } from "../src/services/quizPublication";

test("PostgreSQL : publication contrôlée, concurrence et activation", {
  skip: process.env.POAPO_TEST_PUBLICATION !== "1",
}, async (t) => {
  const secret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "publication-postgres-only";
  const app = express();
  app.use(express.json());
  app.use("/api/quizzes", quizzesRouter);
  app.use("/api/campaigns", campaignsRouter);
  app.use("/api/embed", embedRouter);
  app.use("/api/quiz", quizRouter);
  app.use(quizErrorHandler);
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const tenants: string[] = [];
  async function fixture() {
    const tenantId = `publication-${randomUUID()}`;
    tenants.push(tenantId);
    await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test`, primaryColor: "#246753" } });
    await prisma.subscription.create({ data: { tenantId: tenantId, plan: "BUSINESS", source: "LEGACY" } }); // fixtures : hors quotas
    const catalog = await prisma.catalog.create({ data: { tenantId, name: "Voyages", isDefault: true } });
    const product = await prisma.product.create({ data: { tenantId, catalogId: catalog.id, name: "Voyage", tags: [],
      attributes: { pace: 0.3 } } });
    const quiz = await prisma.quiz.create({ data: {
      id: `default_${tenantId}`, tenantId, catalogId: catalog.id, name: "Historique", isDefault: true,
      quizTitle: "Titre public", ctaText: "Découvrir", useAllProducts: false,
      axes: [{ key: "pace", label: "Rythme" }], products: { create: { productId: product.id } },
    } });
    const root = await prisma.question.create({ data: {
      tenantId, quizId: quiz.id, text: "Rythme ?", order: 0,
      answers: { create: { text: "Calme", impacts: { pace: -0.2 }, order: 0 } },
    }, include: { answers: true } });
    const child = await prisma.question.create({ data: {
      tenantId, quizId: quiz.id, text: "Confort ?", order: 1, type: "scale", conditionAnswerId: root.answers[0].id,
      answers: { create: { text: "Simple", impacts: { pace: 0.1 }, order: 0 } },
    }, include: { answers: true } });
    const campaign = await prisma.campaign.create({ data: {
      tenantId, quizId: quiz.id, name: "Odyssey", occasion: "PERMANENT", objectives: [],
    } });
    const token = jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET!);
    async function request(path: string, method = "GET", body?: unknown, auth: string | null = token) {
      return fetch(base + path, { method, headers: { "Content-Type": "application/json",
        ...(auth && { Authorization: `Bearer ${auth}` }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    }
    const prefix = `/api/quizzes/${quiz.id}`;
    const read = async () => {
      const response = await request(prefix + "/draft");
      assert.equal(response.status, 200);
      return response.json() as Promise<QuizEditorDraftResponse>;
    };
    const save = (draft: QuizEditorDraft, revision: number) => request(prefix + "/draft", "PUT", { draft, revision });
    const check = (revision: number) => request(prefix + "/publication/check", "POST", { revision });
    const publish = (revision: number, extra: object = {}) => request(prefix + "/publication/publish", "POST", { revision, confirm: true, ...extra });
    const publicSnapshot = () => prisma.quiz.findUnique({ where: { id: quiz.id }, include: {
      products: true, questions: { orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } } } },
      campaigns: { orderBy: { id: "asc" } }, sessions: true, metrics: true,
    } });
    return { tenantId, catalog, product, quiz, root, child, campaign, request, prefix, read, save, check, publish, publicSnapshot };
  }
  try {
    await t.test("brouillon seul, diagnostic et avertissements, publication, identifiants stables et liens historiques", async () => {
      const f = await fixture();
      const before = await f.publicSnapshot();
      const initial = await f.read();
      initial.draft.config.quizTitle = "Titre publié";
      initial.draft.theme = { primaryColor: "#123456", headingFont: "georgia", nextLabel: "Continuer" };
      initial.draft.questions[0].text = "Rythme préparé ?";
      assert.equal((await f.save(initial.draft, 0)).status, 200);
      assert.deepEqual(await f.publicSnapshot(), before);
      const oldConfig = await f.request(`/api/embed/config?clientId=${f.tenantId}`);
      assert.equal((await oldConfig.json()).theme, undefined);
      const diagnosis = await f.check(1);
      assert.equal(diagnosis.status, 200);
      const report = await diagnosis.json() as QuizPublicationDiagnostic;
      assert.equal(report.valid, true);
      assert.ok(report.warnings.some((w) => w.code === "MISSING_EMBEDDINGS"));
      assert.ok(report.warnings.some((w) => w.code === "WEAK_AXIS"));
      const result = await f.publish(1);
      assert.equal(result.status, 200, await result.clone().text());
      const published = await result.json() as QuizEditorDraftResponse;
      assert.equal(published.revision, 2);
      assert.equal(published.hasChanges, false);
      assert.equal(published.draft.questions[0].id, f.root.id);
      assert.equal(published.draft.questions[0].answers[0].id, f.root.answers[0].id);
      assert.equal(published.draft.questions[1].conditionAnswerId, f.root.answers[0].id);
      assert.deepEqual(await f.read(), published);
      const config = await f.request(`/api/embed/config?clientId=${f.tenantId}`);
      const body = await config.json();
      assert.equal(body.quizId, f.quiz.id);
      assert.equal(body.quizTitle, "Titre publié");
      assert.equal(body.theme.primaryColor, "#123456");
      assert.equal(body.primaryColor, "#123456");
      const explicit = await f.request(`/api/embed/config?clientId=${f.tenantId}&quizId=${f.quiz.id}`);
      assert.deepEqual(await explicit.json(), body);
      assert.equal((await f.publicSnapshot())!.campaigns[0].status, "DRAFT");
      assert.equal(await prisma.metric.count({ where: { tenantId: f.tenantId } }), 0);
      assert.equal(await prisma.quizSession.count({ where: { tenantId: f.tenantId } }), 0);
      published.draft.theme = null;
      assert.equal((await f.save(published.draft, 2)).status, 200);
      assert.equal((await f.publish(3)).status, 200);
      const reset = await f.request(`/api/embed/config?clientId=${f.tenantId}`);
      assert.equal((await reset.json()).theme, undefined);
    });
    await t.test("nouvelles questions/réponses remappées, conditions restaurées après suppressions et changement de catalogue", async () => {
      const f = await fixture();
      const { draft } = await f.read();
      const q = structuredClone(draft.questions[0]);
      const localQ = `draft_${randomUUID()}`, localA = `draft_${randomUUID()}`;
      q.id = localQ; q.answers[0].id = localA; q.text = "Nouvelle racine"; q.order = 0;
      draft.questions = [q, { ...draft.questions[1], conditionAnswerId: localA }];
      const other = await prisma.catalog.create({ data: { tenantId: f.tenantId, name: "Nouveau catalogue" } });
      const product = await prisma.product.create({ data: { tenantId: f.tenantId, catalogId: other.id, name: "Nouveau", tags: [] } });
      draft.config.catalogId = other.id; draft.config.productIds = [product.id];
      assert.equal((await f.save(draft, 0)).status, 200);
      const result = await f.publish(1);
      assert.equal(result.status, 200, await result.clone().text());
      const published = (await result.json() as QuizEditorDraftResponse).draft;
      assert.notEqual(published.questions[0].id, localQ);
      assert.notEqual(published.questions[0].answers[0].id, localA);
      assert.equal(published.questions[1].id, f.child.id);
      assert.equal(published.questions[1].conditionAnswerId, published.questions[0].answers[0].id);
      assert.equal(await prisma.question.count({ where: { id: f.root.id } }), 0);
      assert.equal(await prisma.answer.count({ where: { id: f.root.answers[0].id } }), 0);
      assert.equal(published.config.catalogId, other.id);
      assert.deepEqual(published.config.productIds, [product.id]);
    });
    await t.test("conflits de révision, double publication et concurrence sauvegarde/publication", async () => {
      const f = await fixture();
      const { draft } = await f.read();
      draft.config.quizTitle = "Concurrent";
      assert.equal((await f.save(draft, 0)).status, 200);
      assert.equal((await f.check(0)).status, 409);
      assert.equal((await f.publish(0)).status, 409);
      const responses = await Promise.all([f.publish(1), f.publish(1)]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      assert.equal((await f.read()).revision, 2);
      assert.equal((await f.save(draft, 1)).status, 409);
      assert.equal((await f.save(draft, 2)).status, 200);
      const race = await Promise.all([f.publish(3), f.save(draft, 3)]);
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
      assert.equal((await f.read()).revision, 4);
    });
    await t.test("diagnostic et publication refusent les erreurs sans toucher le public", async () => {
      const f = await fixture();
      const { draft } = await f.read();
      draft.questions[0].answers[0].active = false;
      assert.equal((await f.save(draft, 0)).status, 200);
      const before = await f.publicSnapshot();
      const checked = await f.check(1);
      assert.equal((await checked.json()).valid, false);
      const invalid = await f.publish(1);
      assert.equal(invalid.status, 422);
      assert.ok((await invalid.json()).diagnostic.errors.length);
      assert.deepEqual(await f.publicSnapshot(), before);
      assert.equal((await f.read()).revision, 1);
      draft.questions[0].answers[0].active = true;
      assert.equal((await f.save(draft, 1)).status, 200);
      await prisma.product.update({ where: { id: f.product.id }, data: { active: false } });
      assert.equal((await f.publish(2)).status, 422);
      assert.equal((await f.read()).revision, 2);
      const body = { revision: 2, confirm: true };
      assert.equal((await f.request(f.prefix + "/publication/publish", "POST", body, null)).status, 401);
      const foreign = jwt.sign({ tenantId: "foreign", email: "foreign@example.test" }, process.env.JWT_SECRET!);
      assert.equal((await f.request(f.prefix + "/publication/publish", "POST", body, foreign)).status, 404);
      assert.equal((await f.request(f.prefix + "/publication/publish", "POST", { revision: 2 })).status, 400);
    });
    await t.test("validation serveur obligatoire : catalogue étranger, thème, axes, cycles et variantes", async () => {
      const f = await fixture(), other = await fixture();
      const original = (await f.read()).draft;
      const invalids = [
        { ...original, config: { ...original.config, catalogId: other.catalog.id } },
        { ...original, config: { ...original.config, productIds: [other.product.id] } },
        { ...original, theme: { primaryColor: "red" } },
        { ...original, theme: { bodyFont: "arbitrary-font" } },
        { ...original, questions: original.questions.map((q, i) => i ? q : {
          ...q, answers: q.answers.map((a) => ({ ...a, impacts: { nonexistent: 0.5 } })),
        }) },
        { ...original, questions: original.questions.map((q, i) => i ? q : {
          ...q, conditionAnswerId: original.questions[1].answers[0].id,
        }) },
        { ...original, questions: original.questions.map((q, i) => ({ ...q, abVariant: i ? "B" : "A" })) },
      ];
      assert.equal((await f.save(original, 0)).status, 200);
      const publicBefore = await f.publicSnapshot();
      for (const invalid of invalids) {
        // Simulate a legacy/corrupt persisted document as well as normal API validation.
        await prisma.quizEditorDraft.update({ where: { quizId: f.quiz.id }, data: { content: JSON.parse(JSON.stringify(invalid)) } });
        const checked = await f.check(1);
        assert.equal(checked.status, 200);
        assert.equal((await checked.json()).valid, false);
        assert.equal((await f.publish(1)).status, 422);
        assert.deepEqual(await f.publicSnapshot(), publicBefore);
        assert.equal((await f.read()).revision, 1);
      }
      const valid = structuredClone(original);
      valid.questions[1].abVariant = "A";
      valid.theme = { primaryColor: "#FFFFFF", textColor: "#FFFFFF", backgroundColor: "#FFFFFF" };
      await prisma.product.update({ where: { id: f.product.id }, data: { attributes: {} } });
      assert.equal((await f.save(valid, 1)).status, 200);
      const diagnosis = await (await f.check(2)).json() as QuizPublicationDiagnostic;
      assert.equal(diagnosis.valid, true);
      assert.ok(diagnosis.warnings.some((w) => w.code === "LOW_CONTRAST"));
      assert.ok(diagnosis.warnings.some((w) => w.code === "MISSING_ATTRIBUTES"));
      assert.equal((await f.publish(2)).status, 200);
      assert.equal((await f.read()).draft.questions[1].abVariant, "A");
    });
    await t.test("campagnes partagées : confirmation exacte, nouvelle campagne entre diagnostic et publication", async () => {
      const f = await fixture();
      const second = await prisma.campaign.create({ data: { tenantId: f.tenantId, quizId: f.quiz.id, name: "Autre", occasion: "SPRING", objectives: [] } });
      const { draft } = await f.read();
      assert.equal((await f.save(draft, 0)).status, 200);
      const checked = await (await f.check(1)).json() as QuizPublicationDiagnostic;
      assert.equal(checked.campaigns.length, 2);
      assert.ok(checked.warnings.some((w) => w.code === "SHARED_QUIZ"));
      assert.equal((await f.publish(1)).status, 409);
      assert.equal((await f.publish(1, { confirmedCampaignIds: [f.campaign.id] })).status, 409);
      const third = await f.request("/api/campaigns", "POST", { quizId: f.quiz.id, name: "Nouvelle", occasion: "SPRING" });
      assert.equal(third.status, 201);
      assert.equal((await f.publish(1, { confirmedCampaignIds: [f.campaign.id, second.id] })).status, 409);
      const confirmed = await (await f.check(1)).json() as QuizPublicationDiagnostic;
      assert.equal((await f.publish(1, { confirmedCampaignIds: confirmed.campaigns.map((c) => c.id) })).status, 200);
      assert.equal(await prisma.campaign.count({ where: { tenantId: f.tenantId, status: "DRAFT" } }), 3);
    });
    await t.test("une association de campagne concurrente est relue après acquisition du verrou", async () => {
      const f = await fixture();
      assert.equal((await f.save((await f.read()).draft, 0)).status, 200);
      let release!: () => void, locked!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const acquired = new Promise<void>((resolve) => { locked = resolve; });
      const association = prisma.$transaction(async (db) => {
        await lockQuiz(db, f.tenantId, f.quiz.id);
        await db.campaign.create({ data: { tenantId: f.tenantId, quizId: f.quiz.id, name: "Concurrente", occasion: "SPRING", objectives: [] } });
        locked();
        await gate;
      });
      await acquired;
      const publishing = f.publish(1);
      try {
        await new Promise((resolve) => setTimeout(resolve, 100));
      } finally { release(); }
      await association;
      assert.equal((await publishing).status, 409);
      assert.equal((await f.read()).revision, 1);
      const diagnostic = await (await f.check(1)).json() as QuizPublicationDiagnostic;
      assert.equal(diagnostic.campaigns.length, 2);
      assert.equal((await f.publish(1, { confirmedCampaignIds: diagnostic.campaigns.map((c) => c.id) })).status, 200);
    });
    await t.test("activation et programmation ne publient pas le brouillon et vérifient uniquement le public", async () => {
      const f = await fixture();
      const { draft } = await f.read();
      draft.questions[0].text = "Non publié";
      draft.questions[0].answers[0].active = false;
      assert.equal((await f.save(draft, 0)).status, 200);
      const before = await f.read();
      assert.equal((await f.request(`/api/campaigns/${f.campaign.id}`, "PUT", { status: "ACTIVE" })).status, 200);
      assert.deepEqual(await f.read(), before);
      assert.equal((await f.request(`/api/campaigns/${f.campaign.id}`, "PUT", {
        status: "SCHEDULED", startsAt: new Date(Date.now() + 86400000).toISOString(),
      })).status, 200);
      await prisma.question.update({ where: { id: f.root.id }, data: { active: false } });
      assert.equal((await f.request(f.prefix, "PUT", { active: true })).status, 422);
      assert.equal((await f.request(`/api/campaigns/${f.campaign.id}`, "PUT", { status: "ACTIVE" })).status, 422);
      assert.equal((await f.request("/api/campaigns", "POST", { name: "Refus", quizId: f.quiz.id, occasion: "SPRING", status: "ACTIVE" })).status, 422);
      assert.equal((await f.request(f.prefix, "PUT", { active: false })).status, 200);
      const invalid = await f.request("/api/quizzes", "POST", { name: "Vide", active: true });
      assert.equal(invalid.status, 422);
      const created = await f.request("/api/quizzes", "POST", { name: "Vide" });
      assert.equal(created.status, 201);
      assert.equal((await created.json()).active, false);
    });
    await t.test("échec SQL après écritures : rollback du contenu ET de la révision", async () => {
      const f = await fixture();
      const { draft } = await f.read();
      draft.questions[0].text = "Changement avant erreur";
      const sentinel = `fail-${randomUUID()}`;
      draft.questions[0].answers[0].text = sentinel;
      assert.equal((await f.save(draft, 0)).status, 200);
      const before = await f.publicSnapshot(), saved = await f.read();
      const name = `publication_test_${randomUUID().replaceAll("-", "")}`;
      // Identifiers and sentinel are generated UUIDs, never user-controlled SQL.
      await prisma.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.text = '${sentinel}' THEN RAISE EXCEPTION 'intentional publication rollback test'; END IF; RETURN NEW; END $$`);
      try {
        await prisma.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE UPDATE ON "Answer" FOR EACH ROW EXECUTE FUNCTION "${name}"()`);
        assert.equal((await f.publish(1)).status, 500);
        assert.deepEqual(await f.publicSnapshot(), before);
        assert.deepEqual(await f.read(), saved);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON "Answer"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"()`);
      }
      assert.equal((await f.publish(1)).status, 200);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    for (const id of tenants) await prisma.tenant.deleteMany({ where: { id } });
    await prisma.$disconnect();
    if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret;
  }
});
