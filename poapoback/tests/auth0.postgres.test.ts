import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { prisma } from "../src/lib/prisma";
import authRouter from "../src/routes/auth";
import catalogsRouter from "../src/routes/catalogs";
import { quizErrorHandler } from "../src/services/quizzes";

// Auth0 simulé localement : JWKS servi par un faux émetteur, PostgreSQL réel. Aucun secret Auth0.
const run = randomUUID().slice(0, 8);
const audience = "https://api.poapo.test";
const NS = "https://poapo.app/";
let issuer = "", base = "", jwksServer: Server, api: Server;
let privateKey: CryptoKey, other: CryptoKey;
const created: string[] = [];

async function token(sub: string, email: string | null, opts: { verified?: boolean; aud?: string; iss?: string; exp?: string; key?: CryptoKey; alg?: string } = {}) {
  return new SignJWT({ ...(email && { [`${NS}email`]: email }), [`${NS}email_verified`]: opts.verified ?? true })
    .setProtectedHeader({ alg: "RS256", kid: "k1" }).setSubject(sub).setIssuer(opts.iss ?? issuer)
    .setAudience(opts.aud ?? audience).setIssuedAt().setExpirationTime(opts.exp ?? "1h").sign(opts.key ?? privateKey);
}
const call = (path: string, tok: string | null, method = "GET", body?: unknown) =>
  fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(tok && { Authorization: `Bearer ${tok}` }) }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  const pair = await generateKeyPair("RS256"); privateKey = pair.privateKey;
  other = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  jwksServer = await new Promise<Server>((r) => { const s = createServer((_q, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); }); s.listen(0, "127.0.0.1", () => r(s)); });
  issuer = `http://127.0.0.1:${(jwksServer.address() as { port: number }).port}/`;
  Object.assign(process.env, { AUTH0_ISSUER: issuer, AUTH0_AUDIENCE: audience, JWT_SECRET: "test-secret", SUPER_ADMIN_EMAIL: `root-${run}@example.test`, NODE_ENV: "test" });
  const app = express(); app.use(express.json());
  app.use("/api/auth", authRouter); app.use("/api/catalogs", catalogsRouter); app.use(quizErrorHandler);
  api = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  base = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
});
after(async () => {
  await prisma.user.deleteMany({ where: { auth0Sub: { contains: run } } });
  await prisma.tenant.deleteMany({ where: { id: { in: created } } });
  await prisma.tenant.deleteMany({ where: { email: { contains: run } } });
  api.close(); jwksServer.close(); await prisma.$disconnect();
});

test("Auth0 : jetons invalides, expirés, mauvaise audience/émetteur/clé, HS256 forgé", async () => {
  const sub = `auth0|bad-${run}`;
  assert.equal((await call("/api/auth/me", null)).status, 401);
  assert.equal((await call("/api/auth/me", "n.importe.quoi")).status, 401);
  for (const bad of [
    await token(sub, `a-${run}@example.test`, { exp: "-1m" }),
    await token(sub, `a-${run}@example.test`, { aud: "https://autre-api" }),
    await token(sub, `a-${run}@example.test`, { iss: "https://evil.test/" }),
    await token(sub, `a-${run}@example.test`, { key: other }),
    jwt.sign({ tenantId: "x", email: "x@y.z" }, "wrong", { algorithm: "HS256" }),
  ]) assert.equal((await call("/api/auth/me", bad)).status, 401);
  const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(`{"sub":"${sub}"}`).toString("base64url")}.`;
  assert.equal((await call("/api/auth/me", none)).status, 401);
});

test("inscription, email non vérifié, idempotence, isolation, catalogue, reconnexion", async () => {
  const subA = `auth0|a-${run}`, subB = `auth0|b-${run}`, emailA = `a-${run}@example.test`, emailB = `b-${run}@example.test`;
  const a = await token(subA, emailA);
  // Première connexion : pas de boutique, routes métier refusées avec un code explicite.
  const me0 = await (await call("/api/auth/me", a)).json();
  assert.deepEqual([me0.onboardingRequired, me0.emailVerified], [true, true]);
  const refused = await call("/api/catalogs", a);
  assert.deepEqual([refused.status, (await refused.json()).code], [403, "onboarding_required"]);
  // Email non vérifié : aucune création.
  const unverified = await token(`auth0|u-${run}`, `u-${run}@example.test`, { verified: false });
  const r = await call("/api/auth/onboarding", unverified, "POST", { shopName: "Boutique U", industry: "Café" });
  assert.deepEqual([r.status, (await r.json()).code], [403, "email_not_verified"]);
  assert.equal(await prisma.tenant.count({ where: { email: `u-${run}@example.test` } }), 0);
  // Validation.
  assert.equal((await call("/api/auth/onboarding", a, "POST", { shopName: "x", industry: "Café" })).status, 400);
  assert.equal((await call("/api/auth/onboarding", a, "POST", { shopName: "Boutique A", industry: "Café", websiteUrl: "javascript:alert(1)" })).status, 400);
  // Création + double soumission simultanée : un seul tenant.
  const body = { shopName: "Boutique A", industry: "Café", websiteUrl: "ma-boutique.fr", tenantId: "existing-tenant" };
  const [r1, r2] = await Promise.all([call("/api/auth/onboarding", a, "POST", body), call("/api/auth/onboarding", a, "POST", body)]);
  const j = [await r1.json(), await r2.json()];
  assert.deepEqual([r1.status, r2.status].sort(), [200, 201]);
  assert.equal(j[0].tenantId, j[1].tenantId);
  created.push(j[0].tenantId);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: j[0].tenantId } });
  assert.deepEqual([tenant.primaryColor, tenant.name, tenant.email, tenant.plan, tenant.websiteUrl], ["#6C47FF", "Boutique A", emailA, "FREE", "https://ma-boutique.fr/"]);
  assert.equal(await prisma.membership.count({ where: { tenantId: tenant.id, role: "OWNER" } }), 1);
  assert.equal(await prisma.quiz.count({ where: { tenantId: tenant.id } }), 0);
  assert.equal(await prisma.campaign.count({ where: { tenantId: tenant.id } }), 0);
  // Rechargement : même boutique, pas de doublon.
  const again = await call("/api/auth/onboarding", a, "POST", body);
  assert.deepEqual([again.status, (await again.json()).created], [200, false]);
  const me = await (await call("/api/auth/me", a)).json();
  assert.deepEqual([me.tenantId, me.role, me.entitlements.maxCatalogs], [tenant.id, "OWNER", null]);
  // Premier catalogue (route existante) ; isolation avec un second commerçant.
  const cat = await call("/api/catalogs", a, "POST", { name: "Mon catalogue" });
  assert.equal(cat.status, 201);
  const catId = (await cat.json()).id;
  const b = await token(subB, emailB);
  const rb = await call("/api/auth/onboarding", b, "POST", { shopName: "Boutique B", industry: "Vin" });
  created.push((await rb.json()).tenantId);
  assert.equal((await call(`/api/catalogs/${catId}`, b)).status, 404);
  const listB = await (await call("/api/catalogs", b)).json();
  assert.ok(!JSON.stringify(listB).includes(catId));
  // Un email déjà pris par une autre boutique ne permet pas de s'en attribuer l'accès.
  const thief = await call("/api/auth/onboarding", await token(`auth0|t-${run}`, emailA), "POST", { shopName: "Voleur", industry: "x1" });
  assert.equal(thief.status, 409);
  assert.equal((await call("/api/catalogs", await token(`auth0|t-${run}`, emailA))).status, 403);
  // Déconnexion/reconnexion : nouveau jeton, même compte.
  const a2 = await token(subA, emailA);
  assert.equal((await (await call("/api/auth/me", a2)).json()).tenantId, tenant.id);
});

test("transition : tenant historique rattaché uniquement par email vérifié ; super-admin jamais créé par inscription", async () => {
  const email = `legacy-${run}@example.test`;
  const legacy = await prisma.tenant.create({ data: { email, name: "Ancien" } });
  const unverified = await token(`auth0|l1-${run}`, email, { verified: false });
  assert.equal((await call("/api/catalogs", unverified)).status, 403);
  const ok = await token(`auth0|l2-${run}`, email);
  assert.equal((await call("/api/catalogs", ok)).status, 200);
  assert.equal((await prisma.membership.findFirstOrThrow({ where: { tenantId: legacy.id } })).role, "OWNER");
  // Un second compte Auth0 avec le même email vérifié ne prend pas une boutique déjà possédée.
  assert.equal((await call("/api/catalogs", await token(`auth0|l3-${run}`, email))).status, 403);
  // Super-admin : email vérifié = SUPER_ADMIN_EMAIL ; non vérifié = simple visiteur.
  const root = process.env.SUPER_ADMIN_EMAIL!;
  const su = await (await call("/api/auth/me", await token(`auth0|r-${run}`, root))).json();
  assert.equal(su.isSuperAdmin, true);
  assert.equal((await call("/api/auth/onboarding", await token(`auth0|r-${run}`, root), "POST", { shopName: "Root", industry: "x1" })).status, 403);
  const fake = await (await call("/api/auth/me", await token(`auth0|r2-${run}`, root, { verified: false }))).json();
  assert.equal(fake.isSuperAdmin, undefined);
});

test("compatibilité : jeton HS256 de développement accepté hors production, refusé en production avec Auth0", async () => {
  const t = await prisma.tenant.create({ data: { email: `dev-${run}@example.test` } });
  const legacy = jwt.sign({ tenantId: t.id, email: t.email }, process.env.JWT_SECRET!);
  assert.equal((await call("/api/catalogs", legacy)).status, 200);
  assert.equal((await call("/api/auth/login", null, "POST", { email: "a@b.c", password: "x" })).status, 401);
  process.env.NODE_ENV = "production";
  try {
    assert.equal((await call("/api/catalogs", legacy)).status, 401);
    assert.equal((await call("/api/auth/login", null, "POST", { email: "a@b.c", password: "x" })).status, 410);
    assert.equal((await call("/api/auth/magic-link", null, "POST", { email: "new@b.c" })).status, 410);
  } finally { process.env.NODE_ENV = "test"; }
});
