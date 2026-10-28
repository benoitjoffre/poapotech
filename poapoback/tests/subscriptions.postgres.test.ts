import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../src/lib/prisma";
import authRouter from "../src/routes/auth";
import catalogsRouter from "../src/routes/catalogs";
import quizzesRouter from "../src/routes/quizzes";
import quizRouter from "../src/routes/quiz";
import campaignsRouter from "../src/routes/campaigns";
import adminTenantsRouter from "../src/routes/adminTenants";
import subscriptionRouter from "../src/routes/subscription";
import dashboardRouter from "../src/routes/dashboard";
import resultsRouter from "../src/routes/results";
import expressQuizRouter from "../src/routes/expressQuiz";
import { purgeRecommendationRequests } from "../src/services/recommendationRetention";
import { quizErrorHandler } from "../src/services/quizzes";
import { createShop } from "../src/services/accounts";
import { ensureStarterSubscription, setPromotionalPlan } from "../src/services/subscriptions";
import { recordServedRecommendation } from "../src/services/entitlements";

// Express réel + PostgreSQL réel + faux service IA local (aucun appel externe, aucun OpenAI).
const run = randomUUID().slice(0, 8);
const superEmail = `root-${run}@example.test`;
const period = new Date().toISOString().slice(0, 7);
let api: Server, ai: Server, base = "";
let aiFail = false;
let aiBodies: Record<string, unknown>[] = [];
const tenants: string[] = [];

const tokenOf = (tenantId: string, email = `${tenantId}@example.test`) => jwt.sign({ tenantId, email }, process.env.JWT_SECRET!);
const superToken = jwt.sign({ tenantId: "super-admin", email: superEmail, isSuperAdmin: true }, "subs-secret");
const call = (path: string, tok: string | null, method = "GET", body?: unknown) =>
  fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(tok && { Authorization: `Bearer ${tok}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });

type Setup = { id: string; token: string; catalogId: string; quizId: string; productId: string; questionId: string; answerId: string };
/** Boutique avec abonnement donné, un catalogue, un produit, un quiz valide (inactif) à une question. */
async function shop(plan: "STARTER" | "PRO" | "BUSINESS" | "LEGACY", extraQuizzes = 0): Promise<Setup> {
  const id = `subs-${run}-${tenants.length}`;
  tenants.push(id);
  await prisma.tenant.create({ data: { id, email: `${id}@example.test` } });
  if (plan === "STARTER") await ensureStarterSubscription(prisma, id);
  else if (plan === "LEGACY") await prisma.subscription.create({ data: { tenantId: id, plan: "BUSINESS", source: "LEGACY" } });
  else await setPromotionalPlan(id, { plan, endsAt: null }, "test");
  const catalog = await prisma.catalog.create({ data: { tenantId: id, name: "Catalogue", isDefault: true } });
  const product = await prisma.product.create({ data: { tenantId: id, catalogId: catalog.id, name: "Produit", tags: [], attributes: { pace: 0.3 } } });
  const mk = (n: number) => prisma.quiz.create({ data: {
    tenantId: id, catalogId: catalog.id, name: `Quiz ${n}`, active: false, quizTitle: "Titre", ctaText: "Go",
    axes: [{ key: "pace", label: "Rythme", lowLabel: "Calme", highLabel: "Intense" }],
    useAllProducts: false, products: { create: { productId: product.id } },
  } });
  const withQuestion = async (n: number) => {
    const quiz = await mk(n);
    const question = await prisma.question.create({ data: { tenantId: id, quizId: quiz.id, text: "Rythme ?", order: 0,
      answers: { create: { text: "Calme", order: 0, impacts: { pace: -0.2 } } } }, include: { answers: true } });
    return { ...quiz, questions: [question] };
  };
  const quiz = await withQuestion(0);
  for (let i = 1; i <= extraQuizzes; i++) await withQuestion(i);
  return { id, token: tokenOf(id), catalogId: catalog.id, quizId: quiz.id, productId: product.id, questionId: quiz.questions[0].id, answerId: quiz.questions[0].answers[0].id };
}
const submit = (s: Setup, extra: Record<string, unknown> = {}) =>
  fetch(base + "/api/quiz/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    clientId: s.id, quizId: s.quizId, answers: [{ questionId: s.questionId, answerId: s.answerId }], ...extra }) });
const counter = async (id: string) => (await prisma.usageCounter.findUnique({ where: { tenantId_period: { tenantId: id, period } } }))?.recommendations ?? 0;
const key = () => randomUUID();

before(async () => {
  Object.assign(process.env, { JWT_SECRET: "subs-secret", SUPER_ADMIN_EMAIL: superEmail, NODE_ENV: "test", LEGACY_AUTH: "on" });
  ai = await new Promise<Server>((resolve) => {
    const s = createServer((req, res) => {
      let raw = ""; req.on("data", (c) => (raw += c));
      req.on("end", async () => {
        const body = JSON.parse(raw || "{}"); aiBodies.push(body);
        if (aiFail) { res.statusCode = 500; res.end("{}"); return; }
        const product = await prisma.product.findFirst({ where: { tenantId: body.tenantId, catalogId: body.catalogId } });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ productId: product!.id, explanation: ["ok"], profileSummary: {} }));
      });
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${(ai.address() as { port: number }).port}`;
  await prisma.tenant.create({ data: { id: `super-${run}`, email: superEmail } });
  tenants.push(`super-${run}`);
  const app = express(); app.use(express.json());
  app.use("/api/auth", authRouter); app.use("/api/catalogs", catalogsRouter); app.use("/api/quizzes", quizzesRouter);
  app.use("/api/quiz", quizRouter); app.use("/api/campaigns", campaignsRouter);
  app.use("/api/admin/tenants", adminTenantsRouter); app.use("/api/subscription", subscriptionRouter);
  app.use("/api/dashboard", dashboardRouter); app.use("/api/results", resultsRouter); app.use("/api/express-quiz", expressQuizRouter);
  app.use(quizErrorHandler);
  api = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  base = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
});
after(async () => {
  await prisma.tenant.deleteMany({ where: { OR: [{ id: { in: tenants } }, { email: { contains: run } }] } });
  api.close(); ai.close(); await prisma.$disconnect();
});

test("inscription Auth0 : STARTER actif, sans Stripe, idempotent sous double soumission", async () => {
  const id = { sub: `auth0|s-${run}`, email: `s-${run}@example.test`, emailVerified: true };
  const input = { shopName: "Boutique S", industry: "Café" };
  const results = await Promise.all([createShop(id, input), createShop(id, input), createShop(id, input)]);
  const tenantId = results[0].account.tenantId;
  tenants.push(tenantId);
  assert.equal(results.filter((r) => r.created).length, 1);
  const subs = await prisma.subscription.findMany({ where: { tenantId } });
  assert.equal(subs.length, 1);
  assert.deepEqual([subs[0].plan, subs[0].status, subs[0].source, subs[0].endsAt, subs[0].stripeCustomerId, subs[0].stripeSubscriptionId],
    ["STARTER", "ACTIVE", "SIGNUP", null, null, null]);
  assert.equal(await prisma.subscriptionEvent.count({ where: { tenantId, action: "CREATED" } }), 1);
  const ov = await (await call("/api/subscription", tokenOf(tenantId))).json();
  assert.deepEqual([ov.plan, ov.status, ov.promotional, ov.limits.recommendationsPerMonth], ["STARTER", "ACTIVE", false, 100]);
});

test("attribution PRO par super-admin, journal, refus au commerçant, expiration sans perte de données", async () => {
  const s = await shop("STARTER");
  // Le commerçant ne peut changer ni son plan ni celui d'un autre.
  for (const body of [{ plan: "PRO" }, { plan: "BUSINESS", tenantId: s.id }]) {
    assert.equal((await call(`/api/admin/tenants/${s.id}/subscription`, s.token, "PUT", body)).status, 403);
  }
  assert.equal((await call("/api/auth/me/branding", s.token, "PUT", { plan: "BUSINESS" })).status < 500, true);
  assert.equal((await call("/api/subscription", s.token, "PUT", { plan: "PRO" })).status, 404);
  assert.equal((await (await call("/api/subscription", s.token)).json()).plan, "STARTER");
  // Validation super-admin.
  const bad = [{ plan: "FREE" }, { plan: "PRO", endsAt: "2020-01-01" }, { plan: "PRO", endsAt: "nope" }];
  for (const b of bad) assert.equal((await call(`/api/admin/tenants/${s.id}/subscription`, superToken, "PUT", b)).status, 400);
  assert.equal((await call(`/api/admin/tenants/inexistant/subscription`, superToken, "PUT", { plan: "PRO" })).status, 404);
  // Attribution avec échéance.
  const endsAt = new Date(Date.now() + 7 * 864e5).toISOString();
  const put = await call(`/api/admin/tenants/${s.id}/subscription`, superToken, "PUT", { plan: "PRO", endsAt });
  assert.equal(put.status, 200);
  const ov = await (await call("/api/subscription", s.token)).json();
  assert.deepEqual([ov.plan, ov.status, ov.source, ov.promotional, ov.limits.catalogs], ["PRO", "ACTIVE", "PROMO", true, 5]);
  const me = await (await call("/api/auth/me", s.token)).json();
  assert.deepEqual([me.entitlements.plan, me.subscription.promotional], ["PRO", true]);
  const events = await prisma.subscriptionEvent.findMany({ where: { tenantId: s.id, action: "PLAN_CHANGED" } });
  assert.deepEqual([events.length, events[0].fromPlan, events[0].toPlan, events[0].toSource, events[0].actor], [1, "STARTER", "PRO", "PROMO", superEmail]);
  // Données créées pendant la promotion.
  await prisma.catalog.createMany({ data: [{ tenantId: s.id, name: "B" }, { tenantId: s.id, name: "C" }] });
  const before = { catalogs: await prisma.catalog.count({ where: { tenantId: s.id } }), products: await prisma.product.count({ where: { tenantId: s.id } }) };
  // Expiration : reflétée immédiatement partout, aucune donnée supprimée.
  await prisma.subscription.update({ where: { tenantId: s.id }, data: { endsAt: new Date(Date.now() - 1000) } });
  const exp = await (await call("/api/subscription", s.token)).json();
  assert.deepEqual([exp.plan, exp.status, exp.previousPlan, exp.promotional, exp.limits.catalogs], ["STARTER", "EXPIRED", "PRO", false, 1]);
  const me2 = await (await call("/api/auth/me", s.token)).json();
  assert.deepEqual([me2.entitlements.plan, me2.subscription.status], ["STARTER", "EXPIRED"]);
  assert.deepEqual({ catalogs: await prisma.catalog.count({ where: { tenantId: s.id } }), products: await prisma.product.count({ where: { tenantId: s.id } }) }, before);
  // Au-delà du quota : lecture OK, création refusée.
  assert.equal((await call("/api/catalogs", s.token)).status, 200);
  const denied = await call("/api/catalogs", s.token, "POST", { name: "D" });
  const body = await denied.json();
  assert.deepEqual([denied.status, body.code, body.details.quota, body.details.limit, body.details.used], [403, "quota_exceeded", "catalogs", 1, 3]);
  // Retour STARTER explicite par le super-admin.
  assert.equal((await call(`/api/admin/tenants/${s.id}/subscription`, superToken, "PUT", { plan: "STARTER" })).status, 200);
  assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { tenantId: s.id } })).source, "SIGNUP");
  const log = await (await call(`/api/admin/tenants/${s.id}/subscription`, superToken)).json();
  assert.ok(log.events.length >= 3);
});

test("quota catalogues : plafond respecté sous concurrence, isolation entre boutiques", async () => {
  const pro = await shop("PRO"); const starter = await shop("STARTER");
  const res = await Promise.all(Array.from({ length: 8 }, (_, i) => call("/api/catalogs", pro.token, "POST", { name: `Cat ${i}` })));
  const codes = await Promise.all(res.map(async (r) => [r.status, r.status === 403 ? (await r.json()).code : null]));
  assert.equal(codes.filter(([s]) => s === 201).length, 4); // 1 existant + 4 = 5
  assert.ok(codes.filter(([s]) => s !== 201).every(([s, c]) => s === 403 && c === "quota_exceeded"));
  assert.equal(await prisma.catalog.count({ where: { tenantId: pro.id } }), 5);
  // La boutique STARTER n'est pas affectée par la saturation de l'autre, et reste à 1.
  assert.equal(await prisma.catalog.count({ where: { tenantId: starter.id } }), 1);
  assert.equal((await call("/api/catalogs", starter.token, "POST", { name: "X" })).status, 403);
});

test("quota expériences publiées : activation, concurrence, réactivation, rétrogradation sans désactivation", async () => {
  const s = await shop("STARTER", 2);
  const quizzes = await prisma.quiz.findMany({ where: { tenantId: s.id }, orderBy: { name: "asc" } });
  const activate = (id: string, active = true) => call(`/api/quizzes/${id}`, s.token, "PUT", { active });
  const race = await Promise.all(quizzes.map((q) => activate(q.id)));
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 403, 403]);
  const refused = race.find((r) => r.status === 403)!;
  const body = await refused.json();
  assert.deepEqual([body.code, body.details.quota, body.details.limit], ["quota_exceeded", "publishedExperiences", 1]);
  const active = await prisma.quiz.findFirstOrThrow({ where: { tenantId: s.id, active: true } });
  assert.equal((await activate(active.id)).status, 200); // réactiver l'active ne consomme rien
  // Désactiver libère une place pour un autre.
  assert.equal((await activate(active.id, false)).status, 200);
  const other = quizzes.find((q) => q.id !== active.id)!;
  assert.equal((await activate(other.id)).status, 200);
  // Rétrogradation : PRO → 3 actives → STARTER ; rien n'est désactivé, mais plus d'activation.
  await setPromotionalPlan(s.id, { plan: "PRO", endsAt: null }, "test");
  for (const q of quizzes) assert.equal((await activate(q.id)).status, 200);
  await setPromotionalPlan(s.id, { plan: "STARTER", endsAt: null }, "test");
  assert.equal(await prisma.quiz.count({ where: { tenantId: s.id, active: true } }), 3);
  assert.equal((await activate(quizzes[0].id, false)).status, 200); // désactivation toujours permise
  assert.equal((await activate(quizzes[0].id)).status, 403);
  const ov = await (await call("/api/subscription", s.token)).json();
  assert.equal(ov.usage.publishedExperiences, 2);
});

test("fonctionnalités non incluses : refus structuré, lecture conservée ; PRO accepté", async () => {
  const s = await shop("STARTER"); const p = await shop("PRO");
  const denied = await call("/api/campaigns", s.token, "POST", { name: "x" });
  const b = await denied.json();
  assert.deepEqual([denied.status, b.code, b.details.feature], [403, "feature_not_included", "campaigns"]);
  assert.equal((await call("/api/campaigns", s.token)).status, 200);
  assert.equal((await call(`/api/quiz/metrics/ai-insights?quizId=${s.quizId}`, s.token)).status, 403);
  assert.equal((await call(`/api/catalogs/${s.catalogId}/enrichment/estimate`, s.token, "POST", {})).status, 403);
  const ok = await call("/api/campaigns", p.token, "POST", { name: "x" });
  assert.notEqual((await ok.json().catch(() => ({}))).code, "feature_not_included");
});

test("recommandations : quota atomique, échec sans consommation, mois, isolation, aucune fuite publique", async () => {
  const a = await shop("STARTER"); const b = await shop("STARTER");
  await prisma.quiz.updateMany({ where: { tenantId: { in: [a.id, b.id] } }, data: { active: true } });
  await prisma.usageCounter.create({ data: { tenantId: a.id, period, recommendations: 98 } });
  // Un mois précédent plein ne bloque pas le mois courant (remise à zéro par période).
  await prisma.usageCounter.create({ data: { tenantId: b.id, period: "2020-01", recommendations: 100 } });
  // Échec du moteur : rien n'est consommé ni créé.
  aiFail = true;
  const failed = await submit(a, { idempotencyKey: key() });
  aiFail = false;
  assert.equal(failed.status, 502);
  assert.deepEqual([await counter(a.id), await prisma.quizSession.count({ where: { tenantId: a.id } })], [98, 0]);
  // 5 soumissions concurrentes distinctes : exactement 2 passent.
  const burst = await Promise.all(Array.from({ length: 5 }, () => submit(a, { idempotencyKey: key() })));
  assert.deepEqual(burst.map((r) => r.status).sort(), [200, 200, 429, 429, 429]);
  assert.equal(await counter(a.id), 100);
  assert.equal(await prisma.quizSession.count({ where: { tenantId: a.id } }), 2);
  const refused = await (burst.find((r) => r.status === 429)!).json();
  assert.deepEqual(Object.keys(refused).sort(), ["code", "error"]); // pas de plan ni de limite côté public
  assert.equal(refused.code, "quota_exceeded");
  assert.equal(JSON.stringify(refused).includes("STARTER"), false);
  // Isolation : l'autre boutique n'est pas bloquée.
  assert.equal((await submit(b, { idempotencyKey: key() })).status, 200);
  assert.equal(await counter(b.id), 1);
  assert.equal(await counter(a.id), 100);
});

test("idempotence : retry, concurrence, contenu différent, replay à quota épuisé, sans clé", async () => {
  const s = await shop("PRO", 0);
  await prisma.quiz.updateMany({ where: { tenantId: s.id }, data: { active: true } });
  const k = key();
  const first = await (await submit(s, { idempotencyKey: k })).json();
  const retry = await submit(s, { idempotencyKey: k, decisionTime: 12345 });
  const again = await retry.json();
  assert.equal(retry.status, 200);
  assert.deepEqual([again.sessionId, again.feedbackToken], [first.sessionId, first.feedbackToken]);
  assert.equal(await counter(s.id), 1);
  assert.equal(await prisma.quizSession.count({ where: { tenantId: s.id } }), 1);
  // Concurrence sur une même clé neuve : une seule unité.
  const k2 = key();
  const rs = await Promise.all(Array.from({ length: 6 }, () => submit(s, { idempotencyKey: k2 })));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(new Set(await Promise.all(rs.map(async (r) => (await r.json()).sessionId))).size, 1);
  assert.equal(await counter(s.id), 2);
  // Même clé, contenu différent (autre quiz) : rejeté sans consommation.
 
  const other = await prisma.question.create({ data: { tenantId: s.id, quizId: s.quizId, text: "Autre", order: 1, answers: { create: { text: "Oui", order: 0, impacts: { pace: 0.1 } } } }, include: { answers: true } });
  const conflict = await submit(s, { idempotencyKey: k2, answers: [{ questionId: other.id, answerId: other.answers[0].id }] });
  assert.equal(conflict.status, 422);
  assert.equal(await counter(s.id), 2);
 
  assert.equal((await submit(s, { idempotencyKey: "court" })).status, 400);
 
  // Sans clé : chaque soumission compte (rétrocompatibilité).
  await submit(s); await submit(s);
  assert.equal(await counter(s.id), 4);
 
  // Replay d'une clé déjà servie reste possible quota épuisé.
  await prisma.usageCounter.update({ where: { tenantId_period: { tenantId: s.id, period } }, data: { recommendations: 5000 } });
  assert.equal((await submit(s, { idempotencyKey: k })).status, 200);
  assert.equal((await submit(s, { idempotencyKey: key() })).status, 429);
  // Isolation d'une même clé entre boutiques.
  const t = await shop("PRO"); await prisma.quiz.updateMany({ where: { tenantId: t.id }, data: { active: true } });
  const shared = await (await submit(t, { idempotencyKey: k })).json();
  assert.notEqual(shared.sessionId, first.sessionId);
});

test("BUSINESS / LEGACY : illimité mais comptabilisé ; périodes UTC mensuelles", async () => {
  const s = await shop("LEGACY");
  await prisma.quiz.updateMany({ where: { tenantId: s.id }, data: { active: true } });
  await prisma.usageCounter.create({ data: { tenantId: s.id, period, recommendations: 250_000 } });
  assert.equal((await submit(s, { idempotencyKey: key() })).status, 200);
  const ov = await (await call("/api/subscription", s.token)).json();
  assert.deepEqual([ov.plan, ov.source, ov.promotional, ov.limits.recommendationsPerMonth, ov.usage.recommendationsPerMonth], ["BUSINESS", "LEGACY", false, null, 250_001]);
  // Changement de mois : nouvelle ligne, compteur repart de 1.
  const st = await shop("STARTER");
  await prisma.usageCounter.create({ data: { tenantId: st.id, period: "2030-01", recommendations: 100 } });
  await recordServedRecommendation({ tenantId: st.id, key: null, fingerprint: "f", now: new Date("2030-02-03T00:00:00Z"), create: async () => ({}) });
  const rows = await prisma.usageCounter.findMany({ where: { tenantId: st.id }, orderBy: { period: "asc" } });
  assert.deepEqual(rows.map((r) => [r.period, r.recommendations]), [["2030-01", 100], ["2030-02", 1]]);
  // Dernière seconde du mois = ancienne période, première seconde = nouvelle.
  await recordServedRecommendation({ tenantId: st.id, key: null, fingerprint: "f", now: new Date("2030-02-28T23:59:59Z"), create: async () => ({}) });
  await assert.rejects(recordServedRecommendation({ tenantId: st.id, key: null, fingerprint: "f", now: new Date("2030-01-31T23:59:59Z"), create: async () => ({}) }), /quota/i);
});

test("non-régression : le moteur de scoring reçoit la même requête et la réponse est inchangée", async () => {
  const s = await shop("STARTER");
  await prisma.quiz.updateMany({ where: { tenantId: s.id }, data: { active: true } });
  aiBodies = [];
  const res = await submit(s, { idempotencyKey: key() });
  const out = await res.json();
  assert.equal(aiBodies.length, 1);
  assert.deepEqual(Object.keys(aiBodies[0]).sort(), ["axes", "catalogId", "industry", "productIds", "profile", "tenantId"].sort());
  assert.equal(out.product.id, s.productId);
  assert.deepEqual(Object.keys(out).sort(), ["explanation", "feedbackToken", "industry", "product", "profileSummary", "quizId", "sessionId"]);
});

test("analytics : essentiels et création express accessibles en STARTER, avancés réservés ; PRO/BUSINESS accèdent aux avancés", async () => {
  const s = await shop("STARTER"); const p = await shop("PRO"); const b = await shop("LEGACY");
  for (const path of ["/api/dashboard", "/api/results/summary", `/api/results/experiences/${s.quizId}`]) {
    assert.equal((await call(path, s.token)).status, 200, path);
  }
  for (const path of [`/api/quiz/metrics?quizId=${s.quizId}`, `/api/quiz/metrics/ai-insights?quizId=${s.quizId}`]) {
    const r = await call(path, s.token);
    assert.deepEqual([r.status, (await r.json()).code], [403, "feature_not_included"], path);
  }
  for (const t of [p, b]) for (const path of [`/api/quiz/metrics?quizId=${t.quizId}`, `/api/quiz/metrics/ai-insights?quizId=${t.quizId}`]) {
    assert.notEqual((await call(path, t.token)).status, 403, path);
  }
  // Création express : non soumise à une fonctionnalité (STARTER inclus).
  const express = await call("/api/express-quiz/analyze", s.token, "POST", {});
  assert.notEqual((await express.json().catch(() => ({}))).code, "feature_not_included");
});

test("rétention 30 jours : purge les vieilles demandes seulement, sessions et compteurs intacts, idempotence conservée", async () => {
  const s = await shop("PRO");
  await prisma.quiz.updateMany({ where: { tenantId: s.id }, data: { active: true } });
  const recent = key(), old = key();
  const first = await (await submit(s, { idempotencyKey: recent })).json();
  await submit(s, { idempotencyKey: old });
  await prisma.recommendationRequest.update({ where: { tenantId_idempotencyKey: { tenantId: s.id, idempotencyKey: old } }, data: { createdAt: new Date(Date.now() - 31 * 864e5) } });
  await prisma.recommendationRequest.update({ where: { tenantId_idempotencyKey: { tenantId: s.id, idempotencyKey: recent } }, data: { createdAt: new Date(Date.now() - 29 * 864e5) } });
  const before = { sessions: await prisma.quizSession.count({ where: { tenantId: s.id } }), counter: await counter(s.id) };
  assert.ok(await purgeRecommendationRequests() >= 1);
  assert.equal(await prisma.recommendationRequest.count({ where: { tenantId: s.id, idempotencyKey: old } }), 0);
  assert.equal(await prisma.recommendationRequest.count({ where: { tenantId: s.id, idempotencyKey: recent } }), 1);
  assert.deepEqual({ sessions: await prisma.quizSession.count({ where: { tenantId: s.id } }), counter: await counter(s.id) }, before);
  // Dans la fenêtre : le retry est toujours rejoué sans consommation.
  assert.equal((await (await submit(s, { idempotencyKey: recent })).json()).sessionId, first.sessionId);
  assert.equal(await counter(s.id), before.counter);
  // Une demande en cours (transaction ouverte, verrouillée) n'est jamais supprimée.
  const fresh = key();
  await submit(s, { idempotencyKey: fresh });
  await prisma.recommendationRequest.update({ where: { tenantId_idempotencyKey: { tenantId: s.id, idempotencyKey: fresh } }, data: { createdAt: new Date(Date.now() - 40 * 864e5) } });
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "RecommendationRequest" WHERE "tenantId" = ${s.id} AND "idempotencyKey" = ${fresh} FOR UPDATE`;
    await purgeRecommendationRequests();
    assert.equal(await tx.recommendationRequest.count({ where: { tenantId: s.id, idempotencyKey: fresh } }), 1);
  });
});
