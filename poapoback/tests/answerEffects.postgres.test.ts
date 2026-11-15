import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../src/lib/prisma";
import catalogsRouter from "../src/routes/catalogs";
import quizzesRouter from "../src/routes/quizzes";
import quizRouter from "../src/routes/quiz";
import { quizErrorHandler } from "../src/services/quizzes";
import { axialScore, semantic } from "./fixtures/fakeEngine";
import { perfumeSeeded } from "./fixtures/selectionFixtures";

// Opt-in : POAPO_TEST_EFFECTS_DB=1. Écrit dans la base configurée sur un tenant isolé supprimé en fin de test.
// Le moteur Python est remplacé par un faux serveur HTTP qui applique les règles vérifiées de /recommend (voir poapoai/test_recommend_comparability.py).
test("PostgreSQL : effets de réponses de bout en bout (brouillon → publication → soumission → aperçu), anciens quiz intacts", {
  skip: process.env.POAPO_TEST_EFFECTS_DB !== "1",
}, async () => {
  process.env.JWT_SECRET = "effects-db-only";
  const tenantId = `effects-${randomUUID()}`;
  const aiCalls: Record<string, unknown>[] = [];
  let failSecondCall = false;
  const fakeAi = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", async () => {
      const body = JSON.parse(raw) as { tenantId: string; catalogId: string; profile: Record<string, number>; productIds?: string[]; topN?: number };
      aiCalls.push(body);
      const rows = (await prisma.product.findMany({ where: { tenantId: body.tenantId, catalogId: body.catalogId, active: true, ...(body.productIds && { id: { in: body.productIds } }) } }))
        .sort((a, b) => a.id.localeCompare(b.id));
      // Panne ciblée : l'appel « produits qui répondent exactement à la préférence » (tous de la famille Frais) échoue.
      if (failSecondCall && rows.length && rows.every((r) => (r.attributes as Record<string, unknown>).famille === "Frais")) { res.writeHead(500).end("{}"); return; }
      if (!rows.length) { res.writeHead(404).end(JSON.stringify({ detail: "Aucun produit trouvé" })); return; }
      const topN = rows.map((p) => ({ id: p.id, score: 0.6 * semantic(p.id) + 0.4 * axialScore(body.profile, p.attributes) }))
        .sort((a, b) => b.score - a.score).slice(0, body.topN ?? 1);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ productId: topN[0].id, score: topN[0].score, explanation: [], profileSummary: { axes: [] }, topN }));
    });
  });
  await new Promise<void>((resolve) => fakeAi.listen(0, "127.0.0.1", resolve));
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${(fakeAi.address() as { port: number }).port}`;

  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api/catalogs", catalogsRouter);
  app.use("/api/quizzes", quizzesRouter);
  app.use("/api/quiz", quizRouter);
  app.use(quizErrorHandler);
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const tenant = await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test` } });
    await prisma.subscription.create({ data: { tenantId, plan: "BUSINESS", source: "LEGACY" } });
    const token = jwt.sign({ tenantId, email: tenant.email }, process.env.JWT_SECRET!);
    const call = (path: string, method = "GET", body?: unknown) => fetch(base + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const catalogId = ((await (await call("/api/catalogs")).json()) as { id: string }[])[0].id;
    const catalog = perfumeSeeded(30, 31);
    await prisma.product.createMany({ data: catalog.map((p) => ({
      tenantId, catalogId, name: p.id, brand: p.brand ?? null, price: p.price ?? null, tags: [...(p.tags ?? [])],
      // « taille » n'est renseignée que sur 40 % des produits : insuffisant pour une contrainte stricte.
      attributes: { ...(p.attributes as object), ...(Number(p.id.slice(3)) % 5 < 2 ? { taille: "M" } : {}) },
      embeddingStatus: "READY" as const,
    })) });
    const prices = catalog.map((p) => p.price!).sort((a, b) => a - b);
    const cap = prices[Math.floor(prices.length * 0.4)];
    const axes = ["freshness", "woody", "sweetness", "intensity"].map((key) => ({ key, label: key }));
    const quiz = await (await call("/api/quizzes", "POST", { name: "Quiz effets", catalogId, axes, quizTitle: "T", ctaText: "Go" })).json() as { id: string };
    const q1 = await prisma.question.create({ data: { tenantId, quizId: quiz.id, text: "Ambiance ?", order: 0, answers: { create: [
      { text: "Frais", impacts: { freshness: 0.25 }, order: 0 }, { text: "Chaud", impacts: { freshness: -0.25 }, order: 1 }] } }, include: { answers: true } });
    const q2 = await prisma.question.create({ data: { tenantId, quizId: quiz.id, text: "Budget ?", order: 1, answers: { create: [
      { text: "Petit budget", impacts: {}, order: 0 }, { text: "Sans limite", impacts: {}, order: 1 }, { text: "Presque gratuit", impacts: {}, order: 2 }] } }, include: { answers: true } });
    const q3 = await prisma.question.create({ data: { tenantId, quizId: quiz.id, text: "Famille ?", order: 2, answers: { create: [
      { text: "Floral", impacts: {}, order: 0 }, { text: "Sans préférence", impacts: {}, order: 1 }] } }, include: { answers: true } });
    const ans = (q: typeof q1, i: number) => q.answers.sort((a, b) => a.order - b.order)[i];

    // Brouillon : ajout d'effets (réponses sans impact : « Petit budget », « Sans limite », « Floral », « Sans préférence »).
    const read = async () => await (await call(`/api/quizzes/${quiz.id}/draft`)).json() as { draft: any; revision: number };
    let current = await read();
    const setEffects = (draft: any, id: string, effects: unknown) => {
      for (const q of draft.questions) for (const a of q.answers) if (a.id === id) a.effects = effects;
    };
    setEffects(current.draft, ans(q2, 0).id, { v: 1, effects: [{ type: "range", criterion: "price", mode: "strict", max: cap }] });
    setEffects(current.draft, ans(q2, 1).id, { v: 1, effects: [{ type: "none", criterion: "price" }] });
    setEffects(current.draft, ans(q2, 2).id, { v: 1, effects: [{ type: "range", criterion: "price", mode: "strict", max: 5 }] });
    setEffects(current.draft, ans(q3, 0).id, { v: 1, effects: [{ type: "category", criterion: "attribute.famille", mode: "soft", values: ["Frais"] }] });
    setEffects(current.draft, ans(q3, 1).id, { v: 1, effects: [{ type: "none", criterion: "attribute.famille" }] });
    current.draft.config.active = true;

    // Effets invalides refusés à l'enregistrement.
    const invalid = JSON.parse(JSON.stringify(current.draft));
    setEffects(invalid, ans(q3, 0).id, { v: 1, effects: [{ type: "category", criterion: "attribute.famille", values: ["Frais"] }] });
    const refused = await call(`/api/quizzes/${quiz.id}/draft`, "PUT", { draft: invalid, revision: current.revision });
    assert.equal(refused.status, 400);
    assert.match(((await refused.json()) as { error: string }).error, /Effets invalides/);

    // Contrainte stricte sur une donnée peu fiable : publication refusée avec un message explicite.
    const unreliable = JSON.parse(JSON.stringify(current.draft));
    setEffects(unreliable, ans(q3, 1).id, { v: 1, effects: [{ type: "category", criterion: "attribute.taille", mode: "strict", values: ["M"] }] });
    const savedUnreliable = await call(`/api/quizzes/${quiz.id}/draft`, "PUT", { draft: unreliable, revision: current.revision });
    assert.equal(savedUnreliable.status, 200, await savedUnreliable.clone().text());
    const check = await (await call(`/api/quizzes/${quiz.id}/publication/check`, "POST", { revision: (await savedUnreliable.json() as { revision: number }).revision })).json() as { diagnostic?: { errors: { code: string }[] }; errors?: { code: string }[] };
    const errors = check.diagnostic?.errors ?? check.errors ?? [];
    assert.ok(errors.some((e) => e.code === "UNRELIABLE_CONSTRAINT"), JSON.stringify(check).slice(0, 400));

    // Enregistrement valide, puis publication (réponses sans impact mais avec effets : aucun avertissement NO_IMPACT pour elles).
    current = await read();
    setEffects(current.draft, ans(q2, 0).id, { v: 1, effects: [{ type: "range", criterion: "price", mode: "strict", max: cap }] });
    setEffects(current.draft, ans(q2, 1).id, { v: 1, effects: [{ type: "none", criterion: "price" }] });
    setEffects(current.draft, ans(q2, 2).id, { v: 1, effects: [{ type: "range", criterion: "price", mode: "strict", max: 5 }] });
    setEffects(current.draft, ans(q3, 0).id, { v: 1, effects: [{ type: "category", criterion: "attribute.famille", mode: "soft", values: ["Frais"] }] });
    setEffects(current.draft, ans(q3, 1).id, { v: 1, effects: [{ type: "none", criterion: "attribute.famille" }] });
    current.draft.config.active = true;
    const saved = await call(`/api/quizzes/${quiz.id}/draft`, "PUT", { draft: current.draft, revision: current.revision });
    assert.equal(saved.status, 200, await saved.clone().text());
    const savedRevision = ((await saved.json()) as { revision: number }).revision;
    const checked = await (await call(`/api/quizzes/${quiz.id}/publication/check`, "POST", { revision: savedRevision })).json() as { warnings?: { code: string; answerId?: string }[]; diagnostic?: { warnings: { code: string; answerId?: string }[]; valid: boolean } };
    const warnings = checked.diagnostic?.warnings ?? checked.warnings ?? [];
    const effectsOnly = [ans(q2, 0), ans(q2, 1), ans(q2, 2), ans(q3, 0), ans(q3, 1)].map((a) => a.id);
    assert.ok(!warnings.some((w) => w.code === "NO_IMPACT" && effectsOnly.includes(w.answerId ?? "")), "réponses à effets seuls ≠ réponses inertes");
    const published = await call(`/api/quizzes/${quiz.id}/publication/publish`, "POST", { revision: savedRevision, confirm: true });
    assert.equal(published.status, 200, await published.clone().text());

    // Colonne : NULL pour les réponses sans effets, JSON validé pour les autres.
    const rows = await prisma.answer.findMany({ where: { question: { quizId: quiz.id } }, select: { id: true, effects: true } });
    assert.equal(rows.filter((r) => r.effects === null).length, 2, "les deux réponses de la question historique restent à NULL");
    assert.equal(rows.filter((r) => r.effects !== null).length, 5);

    // Enregistrement par un client qui ne connaît pas `effects` : rien n'est effacé ; `null` explicite efface.
    const unaware = await read();
    for (const q of unaware.draft.questions) for (const a of q.answers) delete a.effects;
    const savedUnaware = await call(`/api/quizzes/${quiz.id}/draft`, "PUT", { draft: unaware.draft, revision: unaware.revision });
    assert.equal(savedUnaware.status, 200);
    const reread = await read();
    assert.deepEqual(reread.draft.questions.flatMap((q: any) => q.answers).filter((a: any) => a.effects).length, 5, "effets conservés");
    assert.ok(!reread.draft.questions.flatMap((q: any) => q.answers).some((a: any) => a.effects === null), "pas de clé null parasite");

    // API publique : les effets ne sont jamais exposés, le reste de la réponse garde sa forme historique.
    const publicQuestions = await (await fetch(`${base}/api/quiz/questions?clientId=${tenantId}&quizId=${quiz.id}`)).json() as any[];
    assert.equal(publicQuestions.length, 3);
    for (const q of publicQuestions) for (const a of q.answers) {
      assert.ok(!("effects" in a), "effects absent de l'API publique");
      assert.ok("impacts" in a && "text" in a && "order" in a && "id" in a);
    }

    const submit = async (answers: { questionId: string; answerId: string }[]) =>
      fetch(`${base}/api/quiz/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: tenantId, quizId: quiz.id, answers }) });
    const priceMap = new Map((await prisma.product.findMany({ where: { tenantId }, select: { id: true, price: true } })).map((p) => [p.id, p.price!]));
    const priceOf = (id: string) => priceMap.get(id)!;
    const productPrice = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id }, select: { price: true } })).price!;

    // 1. Ancienne réponse (sans effets) : appel historique unique, réponse sans `selection`.
    aiCalls.length = 0;
    const legacy = await submit([{ questionId: q1.id, answerId: ans(q1, 0).id }]);
    assert.equal(legacy.status, 200, await legacy.clone().text());
    const legacyBody = await legacy.json() as Record<string, unknown>;
    assert.ok(!("selection" in legacyBody));
    assert.equal(aiCalls.length, 1);
    assert.ok(!("topN" in aiCalls[0]), "requête identique à l'historique (topN par défaut côté moteur)");

    // 2. Plafond strict : le moteur ne voit que des produits autorisés ; le résultat respecte le plafond.
    aiCalls.length = 0;
    const capped = await submit([{ questionId: q1.id, answerId: ans(q1, 0).id }, { questionId: q2.id, answerId: ans(q2, 0).id }]);
    assert.equal(capped.status, 200, await capped.clone().text());
    const cappedBody = await capped.json() as { product: { id: string }; selection: { state: string } };
    assert.equal(cappedBody.selection.state, "matched");
    assert.ok(await productPrice(cappedBody.product.id) <= cap);
    assert.ok(aiCalls.length >= 1 && aiCalls.every((c) => (c.productIds as string[]).every((id) => priceOf(id) <= cap)));

    // 3. Aucun produit : 422 explicite, aucun appel au moteur, ni session ni quota consommés.
    aiCalls.length = 0;
    const sessionsBefore = await prisma.quizSession.count({ where: { tenantId } });
    const none = await submit([{ questionId: q1.id, answerId: ans(q1, 0).id }, { questionId: q2.id, answerId: ans(q2, 2).id }]);
    assert.equal(none.status, 422);
    const noneBody = await none.json() as { code: string; error: string };
    assert.equal(noneBody.code, "no_match");
    assert.ok(!/price|criterion|attribute/.test(noneBody.error));
    assert.equal(aiCalls.length, 0);
    assert.equal(await prisma.quizSession.count({ where: { tenantId } }), sessionsBefore);

    // 4. Préférence souple : deux appels (général + produits exacts), toujours dans le périmètre.
    aiCalls.length = 0;
    const soft = await submit([{ questionId: q1.id, answerId: ans(q1, 0).id }, { questionId: q3.id, answerId: ans(q3, 0).id }]);
    assert.equal(soft.status, 200, await soft.clone().text());
    assert.equal(aiCalls.length, 2);
    const softBody = await soft.json() as { product: { id: string } };
    const softProduct = await prisma.product.findUniqueOrThrow({ where: { id: softBody.product.id } });
    assert.equal((softProduct.attributes as Record<string, unknown>).famille, "Frais");

    // 5. « Sans préférence » : aucun effet de filtre ni de bonus → chemin historique.
    aiCalls.length = 0;
    const neutral = await submit([{ questionId: q1.id, answerId: ans(q1, 0).id }, { questionId: q3.id, answerId: ans(q3, 1).id }, { questionId: q2.id, answerId: ans(q2, 1).id }]);
    assert.equal(neutral.status, 200);
    assert.ok(!("selection" in (await neutral.json() as object)));
    assert.equal(aiCalls.length, 1);

    // 6. Second appel en échec : résultat du premier appel conservé, requête toujours réussie.
    aiCalls.length = 0;
    failSecondCall = true;
    const degraded = await submit([{ questionId: q1.id, answerId: ans(q1, 0).id }, { questionId: q2.id, answerId: ans(q2, 0).id }, { questionId: q3.id, answerId: ans(q3, 0).id }]);
    failSecondCall = false;
    assert.equal(degraded.status, 200, await degraded.clone().text());
    assert.ok(await productPrice(((await degraded.json()) as { product: { id: string } }).product.id) <= cap);
    assert.equal(aiCalls.length, 2, "les deux appels ont bien été émis, le second a échoué");

    // 7. Aperçu : même moteur que la soumission (même produit pour les mêmes réponses), avec diagnostics techniques.
    const draftNow = await read();
    const answers = [{ questionId: q1.id, answerId: ans(q1, 0).id }, { questionId: q2.id, answerId: ans(q2, 0).id }, { questionId: q3.id, answerId: ans(q3, 0).id }];
    const preview = await call(`/api/quizzes/${quiz.id}/preview/recommendations`, "POST", { draft: draftNow.draft, answers });
    assert.equal(preview.status, 200, await preview.clone().text());
    const previewBody = await preview.json() as { product: { id: string }; diagnostics: { path: string }; selection: { state: string } };
    const submitted = await (await submit(answers)).json() as { product: { id: string } };
    assert.equal(previewBody.product.id, submitted.product.id);
    assert.equal(previewBody.diagnostics.path, "strict+soft");
    const previewNone = await call(`/api/quizzes/${quiz.id}/preview/recommendations`, "POST", { draft: draftNow.draft, answers: [answers[0], { questionId: q2.id, answerId: ans(q2, 2).id }, answers[2]] });
    assert.equal(previewNone.status, 422);
    assert.equal(((await previewNone.json()) as { code: string }).code, "no_match");
  } finally {
    await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
    server.close();
    fakeAi.close();
    await prisma.$disconnect();
  }
});
