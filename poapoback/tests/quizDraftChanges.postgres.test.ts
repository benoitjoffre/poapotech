import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import type { QuizEditorDraft, QuizEditorDraftResponse } from "@poapo/types";
import { prisma } from "../src/lib/prisma";
import quizzesRouter from "../src/routes/quizzes";
import experiencesRouter from "../src/routes/experiences";
import dashboardRouter from "../src/routes/dashboard";
import { quizErrorHandler } from "../src/services/quizzes";
import { canonicalDraft, differsFromPublished } from "../src/services/quizDraftChanges";

// Express réel + PostgreSQL réel, boutiques jetables supprimées en fin de test. Aucun appel externe.
const run = randomUUID().slice(0, 8);
const tenants: string[] = [];
let api: Server, base = "";

async function shop() {
  const id = `draftchg-${run}-${tenants.length}`;
  tenants.push(id);
  await prisma.tenant.create({ data: { id, email: `${id}@example.test` } });
  await prisma.subscription.create({ data: { tenantId: id, plan: "BUSINESS", source: "LEGACY" } });
  const catalog = await prisma.catalog.create({ data: { tenantId: id, name: "Catalogue", isDefault: true } });
  const [p1, p2] = await Promise.all([1, 2].map((n) => prisma.product.create({ data: { tenantId: id, catalogId: catalog.id, name: `Produit ${n}`, tags: [], attributes: { pace: 0.3 } } })));
  const quiz = await prisma.quiz.create({ data: {
    tenantId: id, catalogId: catalog.id, name: "Quiz", active: true, quizTitle: "Titre publié", ctaText: "Go",
    axes: [{ key: "pace", label: "Rythme", lowLabel: "Calme", highLabel: "Intense" }],
    useAllProducts: false, products: { create: { productId: p1.id } },
  } });
  await prisma.question.create({ data: { tenantId: id, quizId: quiz.id, text: "Rythme ?", order: 0,
    answers: { create: [{ text: "Calme", order: 0, impacts: { pace: -0.2 } }, { text: "Intense", order: 1, impacts: { pace: 0.2 } }] } } });
  const token = jwt.sign({ tenantId: id, email: `${id}@example.test` }, process.env.JWT_SECRET!);
  const call = (path: string, method = "GET", body?: unknown) => fetch(base + path, { method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const read = async () => (await (await call(`/api/quizzes/${quiz.id}/draft`)).json()) as QuizEditorDraftResponse;
  const save = (draft: QuizEditorDraft, revision: number) => call(`/api/quizzes/${quiz.id}/draft`, "PUT", { draft, revision });
  const edit = async (mutate: (d: QuizEditorDraft) => void) => {
    const current = await read();
    const draft = structuredClone(current.draft);
    mutate(draft);
    const res = await save(draft, current.revision);
    assert.equal(res.status, 200, await res.clone().text());
    return (await res.json()) as QuizEditorDraftResponse;
  };
  const indicators = async () => {
    const list = (await (await call("/api/experiences")).json()).experiences.find((e: { id: string }) => e.id === quiz.id);
    const home = (await (await call("/api/dashboard")).json()).experiences.find((e: { id: string }) => e.id === quiz.id);
    const state = await read();
    const check = await (await call(`/api/quizzes/${quiz.id}/publication/check`, "POST", { revision: state.revision })).json();
    return { read: state.hasChanges, list: list.hasDraft, home: home.hasDraft, check: check.hasChanges as boolean };
  };
  return { id, quiz, catalog, p1, p2, call, read, save, edit, indicators };
}
const all = (value: boolean) => ({ read: value, list: value, home: value, check: value });

before(async () => {
  process.env.JWT_SECRET = "draft-changes-secret";
  const app = express(); app.use(express.json());
  app.use("/api/quizzes", quizzesRouter); app.use("/api/experiences", experiencesRouter); app.use("/api/dashboard", dashboardRouter);
  app.use(quizErrorHandler);
  api = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  base = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
});
after(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  api.close(); await prisma.$disconnect();
});

test("aucun brouillon : aucune modification en cours", async () => {
  const s = await shop();
  assert.deepEqual(await s.indicators(), all(false));
});

test("brouillon enregistré identique au publié : pas de modification, mais le brouillon est conservé", async () => {
  const s = await shop();
  const { draft, revision } = await s.read();
  assert.equal((await s.save(draft, revision)).status, 200);
  assert.deepEqual(await s.indicators(), all(false));
  const row = await prisma.quizEditorDraft.findUniqueOrThrow({ where: { quizId: s.quiz.id } });
  assert.deepEqual([row.content !== null, row.revision], [true, revision + 1], "ligne de brouillon et révision préservées");
});

test("modification puis retour exact à la valeur publiée : l'indicateur disparaît, le brouillon n'est jamais supprimé", async () => {
  const s = await shop();
  assert.equal((await s.edit((d) => { d.config.quizTitle = "Autre titre"; })).hasChanges, true, "réponse de l'enregistrement : modification réelle");
  assert.deepEqual(await s.indicators(), all(true));
  assert.equal((await s.edit((d) => { d.config.quizTitle = "Titre publié"; })).hasChanges, false, "réponse de l'enregistrement : retour à l'identique");
  assert.deepEqual(await s.indicators(), all(false));
  assert.notEqual((await prisma.quizEditorDraft.findUniqueOrThrow({ where: { quizId: s.quiz.id } })).content, null);
});

test("vraies modifications : titre, question, réponse, impact, ajout, ordre, critère, produits, apparence, activation", async () => {
  const mutations: [string, (d: QuizEditorDraft) => void][] = [
    ["titre", (d) => { d.config.quizTitle = "Nouveau"; }],
    ["texte de question", (d) => { d.questions[0].text = "Autre ?"; }],
    ["texte de réponse", (d) => { d.questions[0].answers[0].text = "Très calme"; }],
    ["impact", (d) => { d.questions[0].answers[0].impacts.pace = -0.4; }],
    ["réponse désactivée", (d) => { d.questions[0].answers[1].active = false; }],
    ["question désactivée", (d) => { d.questions[0].active = false; }],
    ["ordre", (d) => { d.questions[0].order = 5; }],
    ["question ajoutée", (d) => { d.questions.push({ id: `draft_${randomUUID()}`, text: "Nouvelle ?", helpText: null, type: "single", imageUrl: null, order: 1,
      active: true, conditionAnswerId: null, abVariant: null, answers: [{ id: `draft_${randomUUID()}`, text: "Oui", emoji: null, imageUrl: null, order: 0, active: true, impacts: { pace: 0.1 } }] }); }],
    ["libellé de critère", (d) => { d.config.axes[0].label = "Allure"; }],
    ["apparence", (d) => { d.theme = { primaryColor: "#123456" }; }],
    ["activation préparée", (d) => { d.config.active = false; }],
  ];
  for (const [label, mutate] of mutations) {
    const s = await shop();
    await s.edit(mutate);
    assert.deepEqual(await s.indicators(), all(true), `modification réelle non détectée : ${label}`);
  }
  const s = await shop();
  await s.edit((d) => { d.config.productIds = [s.p1.id, s.p2.id]; });
  assert.deepEqual(await s.indicators(), all(true), "produits");
});

test("différences de sérialisation sans effet métier : ordre des clés, null/absent, thème vide, ordre des tableaux à ordre égal", async () => {
  const s = await shop();
  const { draft } = await s.read();
  const reordered = {
    questions: draft.questions.map((q) => ({ answers: [...q.answers].reverse().map((a) => ({ impacts: a.impacts, ...a, emoji: undefined })), ...q, helpText: undefined })),
    theme: {}, config: { productIds: [...draft.config.productIds].reverse(), ...draft.config, axes: draft.config.axes.map((a) => ({ ...a, lowLabel: a.lowLabel ?? null })) },
    schemaVersion: draft.schemaVersion,
  };
  assert.equal(differsFromPublished(JSON.parse(JSON.stringify(reordered)), draft), false);
  assert.equal(canonicalDraft(reordered as unknown as QuizEditorDraft), canonicalDraft(draft));
  // Même chose écrite directement en base : la lecture ne signale rien.
  await prisma.quizEditorDraft.create({ data: { tenantId: s.id, quizId: s.quiz.id, revision: 1, content: JSON.parse(JSON.stringify(reordered)) } });
  assert.deepEqual([(await s.read()).hasChanges, (await s.indicators()).list], [false, false]);
});

test("contenu illisible ou de forme inattendue : traité comme une modification (jamais masqué)", async () => {
  const s = await shop();
  await prisma.quizEditorDraft.create({ data: { tenantId: s.id, quizId: s.quiz.id, revision: 1, content: { schemaVersion: 1 } } });
  assert.deepEqual(await s.indicators(), all(true));
});

test("le publié a changé depuis l'enregistrement : le brouillon redevient une différence", async () => {
  const s = await shop();
  await s.edit(() => undefined);
  assert.equal((await s.indicators()).read, false);
  await prisma.quiz.update({ where: { id: s.quiz.id }, data: { quizTitle: "Changé ailleurs" } });
  assert.deepEqual(await s.indicators(), all(true));
});

test("brouillon et version publique simultanés : la lecture renvoie le brouillon tel qu'enregistré, la publication reste inchangée", async () => {
  const s = await shop();
  const saved = await s.edit((d) => { d.config.quizTitle = "Brouillon"; });
  const state = await s.read();
  assert.equal(state.draft.config.quizTitle, "Brouillon");
  assert.equal((await prisma.quiz.findUniqueOrThrow({ where: { id: s.quiz.id } })).quizTitle, "Titre publié");
  assert.equal(state.revision, saved.revision);
  const pub = await s.call(`/api/quizzes/${s.quiz.id}/publication/publish`, "POST", { revision: state.revision, confirm: true });
  assert.equal(pub.status, 200, await pub.clone().text());
  assert.deepEqual(await s.indicators(), all(false), "après publication, plus de modification en cours");
});

test("autosave et conflits 409 : révision périmée refusée, brouillon intact, protections inchangées", async () => {
  const s = await shop();
  const first = await s.edit((d) => { d.config.quizTitle = "A"; });
  const stale = structuredClone(first.draft); stale.config.quizTitle = "B (périmé)";
  assert.equal((await s.save(stale, first.revision - 1)).status, 409);
  assert.equal((await s.read()).draft.config.quizTitle, "A");
  // Retour à l'identique par autosave : révision incrémentée, pas de perte, plus d'indicateur.
  const back = await s.edit((d) => { d.config.quizTitle = "Titre publié"; });
  assert.equal(back.revision, first.revision + 1);
  assert.deepEqual(await s.indicators(), all(false));
  // Un second onglet qui sauvegarde avec l'ancienne révision est toujours refusé.
  const conflicting = structuredClone(back.draft); conflicting.config.quizTitle = "Onglet 2";
  assert.equal((await s.save(conflicting, first.revision)).status, 409);
  assert.equal((await s.read()).draft.config.quizTitle, "Titre publié");
});
