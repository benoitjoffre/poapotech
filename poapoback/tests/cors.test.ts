import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { adminOrigins, corsPolicy, isPublicRoute } from "../src/services/cors";

const env = { FRONTEND_URL: "https://widget.example.test", ADMIN_URL: "https://admin.example.test, https://admin2.example.test/" } as NodeJS.ProcessEnv;
let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use(corsPolicy(env));
  app.all("*", (_req, res) => res.json({ ok: true }));
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});
after(() => server.close());

const third = "https://boutique-tierce.example.org";

test("origines admin : liste séparée par des virgules, slash final retiré", () => {
  assert.deepEqual(adminOrigins(env), ["https://widget.example.test", "https://admin.example.test", "https://admin2.example.test"]);
});

test("routes publiques du widget et routes d'administration sont distinguées", () => {
  for (const [method, path] of [["GET", "/api/embed/config"], ["GET", "/api/quiz/questions"], ["POST", "/api/quiz/submit"], ["POST", "/api/quiz/track"], ["POST", "/api/quiz/feedback"]]) {
    assert.ok(isPublicRoute(method, path), `${method} ${path}`);
  }
  for (const [method, path] of [["GET", "/api/quiz/metrics"], ["POST", "/api/quiz/builder"], ["GET", "/api/catalog/products"], ["POST", "/api/catalog/import/execute"], ["GET", "/api/quiz/submit"], ["GET", "/api/admin/tenants"]]) {
    assert.ok(!isPublicRoute(method, path), `${method} ${path}`);
  }
});

test("domaine tiers : le widget public répond avec Allow-Origin * et sans credentials", async () => {
  const res = await fetch(`${base}/api/embed/config?clientId=t`, { headers: { Origin: third } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(res.headers.get("access-control-allow-credentials"), null);
  const preflight = await fetch(`${base}/api/quiz/submit`, {
    method: "OPTIONS",
    headers: { Origin: third, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /content-type/i);
});

test("domaine tiers : l'administration est refusée, y compris en preflight", async () => {
  for (const path of ["/api/catalog/products", "/api/quiz/metrics", "/api/catalog/import/execute", "/api/auth/me"]) {
    const res = await fetch(`${base}${path}`, { headers: { Origin: third, Authorization: "Bearer x" } });
    assert.equal(res.status, 403, path);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  }
  const preflight = await fetch(`${base}/api/catalog/products/p1`, {
    method: "OPTIONS",
    headers: { Origin: third, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "authorization,content-type" },
  });
  assert.equal(preflight.status, 403);
  // Le quiz public ne donne aucun accès aux méthodes d'administration du même préfixe.
  const metrics = await fetch(`${base}/api/quiz/submit`, { headers: { Origin: third } });
  assert.equal(metrics.status, 403);
});

test("origines de l'administration autorisées avec credentials ; sans Origin la requête passe", async () => {
  const res = await fetch(`${base}/api/catalog/products`, { headers: { Origin: "https://admin2.example.test" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://admin2.example.test");
  assert.equal(res.headers.get("access-control-allow-credentials"), "true");
  assert.equal((await fetch(`${base}/api/catalog/products`)).status, 200);
});

test("embedDomain : le site parent déclaré est contrôlé, jamais l'origine de l'iframe", async () => {
  const { isEmbedParentAllowed } = await import("../src/services/embedDomain");
  assert.equal(isEmbedParentAllowed(null, "https://x.test", env), true);
  assert.equal(isEmbedParentAllowed("https://ma-marque.com", undefined, env), true); // intégration existante sans parentOrigin
  assert.equal(isEmbedParentAllowed("ma-marque.com", "https://ma-marque.com", env), true);
  assert.equal(isEmbedParentAllowed("ma-marque.com", "https://www.ma-marque.com", env), true);
  assert.equal(isEmbedParentAllowed("ma-marque.com", "https://pirate.test", env), false);
  assert.equal(isEmbedParentAllowed("ma-marque.com", "https://ma-marque.com.pirate.test", env), false);
  assert.equal(isEmbedParentAllowed("a.com, *.b.com", "https://shop.b.com", env), true);
  assert.equal(isEmbedParentAllowed("a.com", "https://admin.example.test", env), true); // aperçu admin
  assert.equal(isEmbedParentAllowed("a.com", "pas une url", env), false);
});
