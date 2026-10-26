import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { prisma } from "../src/lib/prisma";
import { checkReadiness } from "../src/services/readiness";

function stubDatabase(ok: boolean) {
  const original = prisma.$queryRaw;
  (prisma as unknown as { $queryRaw: unknown }).$queryRaw = () => (ok ? Promise.resolve([{ "?column?": 1 }]) : Promise.reject(new Error("down")));
  return () => { (prisma as unknown as { $queryRaw: unknown }).$queryRaw = original; };
}

async function aiServer(status: number) {
  const server = createServer((_req, res) => { res.statusCode = status; res.end("{}"); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}`, close: () => server.close() };
}

test("readiness : PostgreSQL et moteur Python disponibles", async () => {
  const restore = stubDatabase(true);
  const ai = await aiServer(200);
  try {
    assert.deepEqual(await checkReadiness({ AI_SERVICE_URL: ai.url }), { ready: true, database: "ok", ai: "ok" });
  } finally { restore(); ai.close(); }
});

test("readiness : Python arrêté ou en chargement n'enlève pas la disponibilité de l'API", async () => {
  const restore = stubDatabase(true);
  const loading = await aiServer(503);
  try {
    assert.deepEqual(await checkReadiness({ AI_SERVICE_URL: loading.url }), { ready: true, database: "ok", ai: "down" });
    assert.deepEqual(await checkReadiness({ AI_SERVICE_URL: "http://127.0.0.1:1" }), { ready: true, database: "ok", ai: "down" });
    assert.deepEqual(await checkReadiness({}), { ready: true, database: "ok", ai: "not_configured" });
  } finally { restore(); loading.close(); }
});

test("readiness : PostgreSQL inaccessible rend l'API non prête", async () => {
  const restore = stubDatabase(false);
  try {
    const state = await checkReadiness({});
    assert.equal(state.ready, false);
    assert.equal(state.database, "down");
  } finally { restore(); }
});
