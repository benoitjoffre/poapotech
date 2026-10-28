import assert from "node:assert/strict";
import { test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { quizErrorHandler } from "../src/services/quizzes";

test("corps trop volumineux → 413, JSON invalide → 400, sans fuite d'erreur interne", async () => {
  const app = express();
  app.use(express.json({ limit: "1kb" }));
  app.post("/x", (_req, res) => { res.json({ ok: true }); });
  app.get("/boom", () => { throw new Error("secret interne postgresql://user:pass@host/db"); });
  app.use(quizErrorHandler);
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (body: string) => fetch(base + "/x", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  const originalError = console.error; console.error = () => undefined;
  try {
    const big = await post(JSON.stringify({ a: "x".repeat(5000) }));
    assert.deepEqual([big.status, (await big.json()).error], [413, "Requête trop volumineuse"]);
    const bad = await post("{pas du json");
    assert.deepEqual([bad.status, (await bad.json()).error], [400, "Requête invalide"]);
    const boom = await fetch(base + "/boom");
    const text = await boom.text();
    assert.equal(boom.status, 500);
    assert.ok(!text.includes("postgresql://") && !text.includes("pass"), "aucun détail interne dans la réponse");
  } finally { console.error = originalError; server.close(); }
});
