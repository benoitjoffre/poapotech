import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { prisma } from "../src/lib/prisma";
import catalogsRouter from "../src/routes/catalogs";
import { quizErrorHandler } from "../src/services/quizzes";
import { generationLimiter } from "../src/services/quizGeneration";
import { buildEnrichmentBatch, enrichmentLimiter, normalizeEnrichment } from "../src/services/productEnrichment";

type Row = Record<string, any>;

const AXES = [
  { key: "adventure", label: "Aventure", lowLabel: "Calme", highLabel: "Intense" },
  { key: "culture", label: "Culture", lowLabel: null, highLabel: null },
  { key: "comfort", label: "Confort", lowLabel: null, highLabel: null },
];

const quizzes: Row[] = [
  { id: "trips", tenantId: "tenant-a", catalogId: "cat-trips", name: "Voyages", active: true, industry: "", axes: AXES },
  { id: "trips-2", tenantId: "tenant-a", catalogId: "cat-trips", name: "Week-ends", active: false, industry: "", axes: [AXES[0], { key: "budget", label: "Budget" }] },
  { id: "flat", tenantId: "tenant-a", catalogId: "cat-trips", name: "Sans axes", active: false, industry: "", axes: [] },
  { id: "hotels", tenantId: "tenant-a", catalogId: "cat-hotels", name: "Hôtels", active: true, industry: "hôtellerie", axes: AXES },
  { id: "foreign-quiz", tenantId: "tenant-b", catalogId: "cat-b", name: "Quiz B", active: true, industry: "", axes: AXES },
];
const catalogs: Row[] = [
  { id: "cat-trips", tenantId: "tenant-a", name: "Expériences" },
  { id: "cat-hotels", tenantId: "tenant-a", name: "Hébergements" },
  { id: "cat-b", tenantId: "tenant-b", name: "Catalogue B" },
];

function productRow(overrides: Row): Row {
  return {
    tenantId: "tenant-a", catalogId: "cat-trips", active: true, brand: null, price: 990, tags: [], description: null,
    attributes: {}, updatedAt: new Date("2026-01-01T00:00:00Z"), embedding: null, ...overrides,
  };
}

let products: Row[] = [];
let aiCalls: { path: string; body: Row }[] = [];
let aiHandler: (path: string, body: Row, call: number) => Response | Promise<Response> = () => json(500, {});
let server: Server;
let base: string;
const originalFetch = globalThis.fetch;
const restores: (() => void)[] = [];

function stub<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const previous = target[key];
  target[key] = value;
  restores.push(() => { target[key] = previous; });
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (condition instanceof Date) return row[key] instanceof Date && row[key].getTime() === condition.getTime();
    if (condition !== null && typeof condition === "object" && "in" in condition) return condition.in.includes(row[key]);
    if (condition !== null && typeof condition === "object" && "not" in condition) return row[key] !== condition.not;
    return row[key] === condition;
  });
}

beforeEach(() => {
  enrichmentLimiter.reset();
  aiCalls = [];
  aiHandler = (path) => (path === "/embed/product" ? json(200, { embedding: [0.42] }) : json(500, {}));
  products = [
    productRow({ id: "trek", name: "Trek au Népal", description: "Randonnée de 12 jours en haute montagne, nuits en refuge.", tags: ["trek", "montagne"], attributes: { duree: "12 jours", adventure: 0.9 } }),
    productRow({ id: "museum", name: "Rome antique", description: "Visites guidées du Colisée et des musées du Vatican, hôtel 4 étoiles.", tags: ["culture"], attributes: {} }),
    productRow({ id: "bare", name: "Séjour mystère", description: "  ", tags: [], attributes: { adventure: 0.5 } }),
    productRow({ id: "broken", name: "Valeur cassée", description: "Croisière en Méditerranée.", attributes: { adventure: "élevé" } }),
    productRow({ id: "hotel-1", catalogId: "cat-hotels", name: "Hôtel du port", description: "Chambres vue mer." }),
    productRow({ id: "foreign", tenantId: "tenant-b", catalogId: "cat-b", name: "Produit B", description: "Autre tenant." }),
  ];
});

before(async () => {
  process.env.JWT_SECRET = "multi-quiz-tests-only";
  process.env.AI_SERVICE_URL = "http://ai.test";

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("http://ai.test")) return originalFetch(input, init);
    const path = url.slice("http://ai.test".length);
    const body = JSON.parse(String(init?.body));
    aiCalls.push({ path, body });
    return aiHandler(path, body, aiCalls.filter((call) => call.path === path).length);
  }) as typeof fetch;
  restores.push(() => { globalThis.fetch = originalFetch; });

  stub(prisma.tenant, "findUnique", (async ({ where }: { where: Row }) => (
    where.id === "tenant-a" || where.id === "tenant-b" ? { id: where.id, industry: "voyage" } : null
  )) as unknown as typeof prisma.tenant.findUnique);
  stub(prisma.catalog, "findFirst", (async ({ where }: { where: Row }) => (
    catalogs.find((c) => matches(c, where)) ?? null
  )) as unknown as typeof prisma.catalog.findFirst);
  stub(prisma.quiz, "findMany", (async ({ where }: { where: Row }) => (
    quizzes.filter((q) => matches(q, where))
  )) as unknown as typeof prisma.quiz.findMany);
  stub(prisma.quiz, "findFirst", (async ({ where }: { where: Row }) => {
    const quiz = quizzes.find((q) => matches(q, where));
    return quiz ? { ...quiz, tenant: { industry: "voyage" } } : null;
  }) as unknown as typeof prisma.quiz.findFirst);
  stub(prisma.product, "findMany", (async ({ where }: { where: Row }) => (
    products.filter((p) => matches(p, where)).map((p) => ({ ...p }))
  )) as unknown as typeof prisma.product.findMany);
  stub(prisma.product, "updateMany", (async ({ where, data }: { where: Row; data: Row }) => {
    const rows = products.filter((p) => matches(p, where));
    rows.forEach((row) => Object.assign(row, data, { updatedAt: new Date() }, "embeddingVersion" in data ? { embeddingVersion: 1 } : {}));
    return { count: rows.length };
  }) as unknown as typeof prisma.product.updateMany);
  stub(prisma.product, "findUnique", (async ({ where }: { where: Row }) => (
    products.find((p) => p.id === where.id) ?? null
  )) as unknown as typeof prisma.product.findUnique);
  stub(prisma.product, "update", (async ({ where, data }: { where: Row; data: Row }) => {
    const row = products.find((p) => p.id === where.id)!;
    Object.assign(row, data);
    return row;
  }) as unknown as typeof prisma.product.update);
  stub(prisma, "$transaction", (async (fn: (tx: typeof prisma) => unknown) => fn(prisma)) as unknown as typeof prisma.$transaction);

  stub(prisma.subscription, "findUnique", (async () => ({ plan: "BUSINESS", status: "ACTIVE", source: "LEGACY", startsAt: new Date(0), endsAt: null })) as unknown as typeof prisma.subscription.findUnique);
  const app = express();
  app.use(express.json());
  app.use("/api/catalogs", catalogsRouter);
  app.use(quizErrorHandler);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  for (const restore of restores.reverse()) restore();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await prisma.$disconnect();
});

async function request(path: string, method = "GET", body?: unknown, tenantId: string | null = "tenant-a") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (tenantId) headers.Authorization = "Bearer " + jwt.sign({ tenantId, email: `${tenantId}@example.test` }, process.env.JWT_SECRET!);
  return originalFetch(`${base}/api/catalogs${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const estimatePath = "/cat-trips/enrichment/estimate";
const applyPath = "/cat-trips/enrichment/apply";

function estimate(ref: string, axis: string, value: number, confidence = "high", evidence: string[] = []) {
  return { axis, status: "estimated", value, confidence, rationale: `Analyse ${axis}`, evidence };
}

function aiProducts(products: Row[]) {
  return json(200, { products, model: "test-model", usage: { promptTokens: 10, completionTokens: 20 } });
}

const validAnswer = () => aiProducts([
  { ref: "p1", estimates: [
    estimate("p1", "culture", 0.95, "high", ["musées du Vatican"]),
    { axis: "comfort", status: "insufficient_data", value: null, confidence: null, rationale: "Pas d'info", evidence: [] },
  ] },
]);

async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

// ─── Contexte ────────────────────────────────────────────────────────────────

test("context : quiz, axes partagés, produits du seul catalogue et quota", async () => {
  const res = await request("/cat-trips/enrichment/context");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.quiz.id, "trips");
  assert.deepEqual(body.quizzes.map((q: Row) => q.id), ["trips", "trips-2", "flat"]);
  assert.deepEqual(body.products.map((p: Row) => p.id).sort(), ["bare", "broken", "museum", "trek"]);
  const trek = body.products.find((p: Row) => p.id === "trek");
  assert.deepEqual(trek.axisValues, { adventure: 0.9, culture: null, comfort: null });
  assert.equal(trek.hasData, true);
  assert.equal(body.products.find((p: Row) => p.id === "bare").hasData, false);
  assert.deepEqual(body.products.find((p: Row) => p.id === "broken").invalidAxes, ["adventure"]);
  assert.deepEqual(body.sharedAxes.adventure, ["Week-ends"]);
  assert.deepEqual(body.limits, { batchSize: 10, hourlyProducts: enrichmentLimiter.limit, remaining: enrichmentLimiter.limit });
});

test("context : authentification, catalogue et quiz d'un autre périmètre", async () => {
  assert.equal((await request("/cat-trips/enrichment/context", "GET", undefined, null)).status, 401);
  assert.equal((await request("/cat-b/enrichment/context")).status, 404);
  assert.equal((await request("/cat-trips/enrichment/context?quizId=hotels")).status, 404);
  assert.equal((await request("/cat-trips/enrichment/context?quizId=foreign-quiz")).status, 404);
  const flat = await (await request("/cat-trips/enrichment/context?quizId=flat")).json();
  assert.equal(flat.quiz.id, "flat");
  assert.deepEqual(flat.products, []);
});

// ─── Estimation ──────────────────────────────────────────────────────────────

test("estimate : validation du périmètre et des entrées", async () => {
  const cases: [Row, number][] = [
    [{ axisKeys: ["culture"], productIds: ["museum"] }, 400],
    [{ quizId: "hotels", axisKeys: ["culture"], productIds: ["museum"] }, 404],
    [{ quizId: "foreign-quiz", axisKeys: ["culture"], productIds: ["museum"] }, 404],
    [{ quizId: "flat", axisKeys: ["culture"], productIds: ["museum"] }, 422],
    [{ quizId: "trips", axisKeys: ["budget"], productIds: ["museum"] }, 400],
    [{ quizId: "trips", axisKeys: [], productIds: ["museum"] }, 400],
    [{ quizId: "trips", axisKeys: ["culture"], productIds: ["hotel-1"] }, 400],
    [{ quizId: "trips", axisKeys: ["culture"], productIds: ["foreign"] }, 400],
    [{ quizId: "trips", axisKeys: ["culture"], productIds: Array.from({ length: 11 }, (_, i) => `p${i}`) }, 400],
  ];
  for (const [body, status] of cases) {
    const res = await request(estimatePath, "POST", body);
    assert.equal(res.status, status, JSON.stringify(body));
  }
  assert.equal((await request("/cat-b/enrichment/estimate", "POST", { quizId: "foreign-quiz", axisKeys: ["culture"], productIds: ["foreign"] })).status, 404);
  assert.equal(aiCalls.length, 0);
});

test("estimate : références locales, axes existants jamais transmis, résultats convertis", async () => {
  aiHandler = () => aiProducts([
    { ref: "p1", estimates: [estimate("p1", "culture", 0.2, "medium", ["haute montagne"]), estimate("p1", "comfort", 0.256, "high", ["refuge"])] },
    { ref: "p2", estimates: [estimate("p2", "culture", 0.95, "high", ["Musées du  Vatican"]), estimate("p2", "comfort", 0.7, "high", ["hôtel 4 étoiles"])] },
  ]);
  const res = await request(estimatePath, "POST", { quizId: "trips", axisKeys: ["culture", "comfort"], productIds: ["trek", "museum"] });
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(aiCalls.length, 1);
  const sent = aiCalls[0].body;
  assert.equal(aiCalls[0].path, "/enrich/axes");
  assert.deepEqual(sent.axes.map((a: Row) => a.key), ["culture", "comfort"]);
  assert.deepEqual(sent.products.map((p: Row) => p.ref), ["p1", "p2"]);
  assert.ok(sent.products.every((p: Row) => !("id" in p)) && !JSON.stringify(sent).includes("museum"), "aucun identifiant réel transmis");
  assert.deepEqual(sent.products[0].attributes, { duree: "12 jours" }, "les valeurs d'axes ne sont jamais envoyées");
  assert.equal(sent.industry, "voyage");

  assert.deepEqual(body.results.map((r: Row) => r.productId), ["trek", "museum"]);
  assert.deepEqual(body.results[0].currentValues, { culture: null, comfort: null });
  assert.equal(body.results[0].estimates[1].value, 0.26);
  assert.equal(body.results[1].estimates[0].confidence, "high");
  assert.deepEqual(body.generation.aiProducts, 2);
  assert.equal(body.remaining, enrichmentLimiter.limit - 2);
});

test("estimate : une fiche sans données n'est pas envoyée à l'IA ni décomptée", async () => {
  const res = await request(estimatePath, "POST", { quizId: "trips", axisKeys: ["culture", "comfort"], productIds: ["bare"] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(aiCalls.length, 0);
  assert.ok(body.results[0].estimates.every((e: Row) => e.status === "insufficient_data" && e.value === null));
  assert.equal(body.remaining, enrichmentLimiter.limit);
  assert.match(body.warnings[0], /sans données/);
});

test("estimate : extraits non vérifiables écartés et confiance ramenée à low", async () => {
  aiHandler = () => aiProducts([
    { ref: "p1", estimates: [estimate("p1", "culture", 0.9, "high", ["opéra de Vienne", "Colisée"]), estimate("p1", "comfort", 0.8, "high", ["spa privé"])] },
  ]);
  const body = await (await request(estimatePath, "POST", { quizId: "trips", axisKeys: ["culture", "comfort"], productIds: ["museum"] })).json();
  const [culture, comfort] = body.results[0].estimates;
  assert.deepEqual(culture.evidence, ["Colisée"]);
  assert.equal(culture.confidence, "high");
  assert.deepEqual(comfort.evidence, []);
  assert.equal(comfort.confidence, "low");
  assert.ok(body.warnings.some((w: string) => /2 extrait/.test(w)));
});

test("estimate : réponse invalide corrigée par une seconde tentative avec retour d'erreurs", async () => {
  aiHandler = (_path, _body, call) => call === 1
    ? aiProducts([{ ref: "p9", estimates: [] }])
    : validAnswer();
  const res = await request(estimatePath, "POST", { quizId: "trips", axisKeys: ["culture", "comfort"], productIds: ["museum"] });
  assert.equal(res.status, 200);
  assert.equal(aiCalls.length, 2);
  assert.ok(aiCalls[1].body.feedback.some((f: string) => f.includes("p9")));
  assert.equal((await res.json()).generation.attempts, 2);
});

test("estimate : réponses invalides répétées → 502", async () => {
  aiHandler = () => aiProducts([{ ref: "p1", estimates: [estimate("p1", "culture", 1.4), estimate("p1", "budget", 0.5)] }]);
  const res = await request(estimatePath, "POST", { quizId: "trips", axisKeys: ["culture", "comfort"], productIds: ["museum"] });
  assert.equal(res.status, 502);
  assert.equal(aiCalls.length, 2);
});

test("estimate : erreurs du service IA → 503, 504, 502", async () => {
  const cases: [() => Response | Promise<Response>, number][] = [
    [() => json(503, { detail: { code: "ai_not_configured" } }), 503],
    [() => json(504, { detail: { code: "ai_timeout" } }), 504],
    [() => json(502, { detail: { code: "ai_unavailable" } }), 503],
    [() => json(502, { detail: { code: "invalid_ai_output", errors: ["x"] } }), 502],
  ];
  for (const [handler, status] of cases) {
    aiHandler = handler;
    enrichmentLimiter.reset();
    const res = await request(estimatePath, "POST", { quizId: "trips", axisKeys: ["culture"], productIds: ["museum"] });
    assert.equal(res.status, status);
    assert.match((await res.json()).error, /IA/);
  }
});

test("estimate : une estimation à la fois par tenant (409) et quota horaire en produits (429)", async () => {
  let release!: () => void;
  aiHandler = () => new Promise<Response>((resolve) => { release = () => resolve(validAnswer()); });
  const first = request(estimatePath, "POST", { quizId: "trips", axisKeys: ["culture", "comfort"], productIds: ["museum"] });
  while (!aiCalls.length) await new Promise((resolve) => setTimeout(resolve, 5));
  const busy = await request(estimatePath, "POST", { quizId: "trips", axisKeys: ["culture", "comfort"], productIds: ["trek"] });
  assert.equal(busy.status, 409);
  release();
  assert.equal((await first).status, 200);

  enrichmentLimiter.reset();
  for (let i = 0; i < enrichmentLimiter.limit - 1; i++) enrichmentLimiter.acquire("tenant-a")();
  aiHandler = () => validAnswer();
  const quota = await request(estimatePath, "POST", { quizId: "trips", axisKeys: ["culture"], productIds: ["museum", "trek"] });
  assert.equal(quota.status, 429);
  assert.equal(aiCalls.length, 1);
  assert.equal((await request(estimatePath, "POST", { quizId: "trips", axisKeys: ["culture"], productIds: ["bare"] })).status, 200, "les fiches sans données restent possibles");
});

test("normalizeEnrichment : produits et axes inconnus, valeurs hors bornes, doublons", () => {
  const rows = products.filter((p) => p.id === "museum") as never[];
  const batch = buildEnrichmentBatch(rows, new Set(["adventure", "culture", "comfort"]));
  const result = normalizeEnrichment({ products: [
    { ref: "p1", estimates: [
      estimate("p1", "culture", -0.1),
      estimate("p1", "adventure", 0.5),
      { axis: "comfort", status: "insufficient_data", value: 0.4, confidence: null, rationale: "", evidence: [] },
    ] },
    { ref: "p1", estimates: [] },
    { ref: "p2", estimates: [] },
  ] }, batch, ["culture", "comfort"]);
  assert.ok(result.errors.some((e) => e.includes("culture : estimation invalide")));
  assert.ok(result.errors.some((e) => e.includes("axe inconnu") && e.includes("adventure")));
  assert.ok(result.errors.some((e) => e.includes("value doit être null")));
  assert.ok(result.errors.some((e) => e.includes("Produit en double")));
  assert.ok(result.errors.some((e) => e.includes("Produit inconnu : p2")));
  assert.deepEqual(normalizeEnrichment({}, batch, ["culture"]).errors, ["Réponse sans liste de produits"]);
});

// ─── Enregistrement ──────────────────────────────────────────────────────────

function update(productId: string, values: Row, expected: Row, overwrite: string[] = []) {
  return { productId, values, expected, overwrite };
}

test("apply : ajoute les valeurs, conserve les autres clés et recalcule l'embedding", async () => {
  const res = await request(applyPath, "POST", { quizId: "trips", updates: [
    update("trek", { culture: 0.234, comfort: 0.3 }, { culture: null, comfort: null }),
    update("museum", { culture: 0.95 }, { culture: null }),
  ] });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { updatedProducts: 2, added: 3, replaced: 0 });
  const trek = products.find((p) => p.id === "trek")!;
  assert.deepEqual(trek.attributes, { duree: "12 jours", adventure: 0.9, culture: 0.23, comfort: 0.3 });
  await flush();
  // Les produits modifiés sont remis en file (PENDING) ; le worker, testé sur PostgreSQL, calcule l'embedding.
  assert.deepEqual(products.filter((p) => p.embeddingStatus === "PENDING").map((p) => p.id), ["trek", "museum"]);
  assert.equal(aiCalls.filter((c) => c.path === "/embed/product").length, 0);
});

test("apply : une valeur existante n'est jamais remplacée sans confirmation (tout ou rien)", async () => {
  const res = await request(applyPath, "POST", { quizId: "trips", updates: [
    update("museum", { culture: 0.9 }, { culture: null }),
    update("trek", { adventure: 0.4 }, { adventure: 0.9 }),
  ] });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Trek au Népal \(adventure\) : remplacement/);
  assert.deepEqual(products.find((p) => p.id === "museum")!.attributes, {}, "aucune écriture partielle");

  const confirmed = await request(applyPath, "POST", { quizId: "trips", updates: [update("trek", { adventure: 0.4 }, { adventure: 0.9 }, ["adventure"])] });
  assert.deepEqual(await confirmed.json(), { updatedProducts: 1, added: 0, replaced: 1 });
  assert.equal(products.find((p) => p.id === "trek")!.attributes.adventure, 0.4);
});

test("apply : valeur modifiée depuis l'estimation → 409", async () => {
  const stale = await request(applyPath, "POST", { quizId: "trips", updates: [update("trek", { adventure: 0.4 }, { adventure: 0.5 }, ["adventure"])] });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /modifiée depuis l'estimation/);

  const added = await request(applyPath, "POST", { quizId: "trips", updates: [update("trek", { culture: 0.4 }, { culture: 0.1 })] });
  assert.equal(added.status, 409, "une valeur apparue entre-temps est un conflit");
  assert.equal(products.find((p) => p.id === "trek")!.attributes.culture, undefined);
});

test("apply : verrou optimiste sur updatedAt → 409", async () => {
  const originalFindMany = prisma.product.findMany;
  stub(prisma.product, "findMany", (async (args: Row) => {
    const rows = await (originalFindMany as any)(args);
    products.find((p) => p.id === "museum")!.updatedAt = new Date("2026-02-01T00:00:00Z");
    return rows;
  }) as unknown as typeof prisma.product.findMany);
  try {
    const res = await request(applyPath, "POST", { quizId: "trips", updates: [update("museum", { culture: 0.9 }, { culture: null })] });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /modifié entre-temps/);
  } finally {
    restores.pop()!();
  }
});

test("apply : valeur existante non numérique à confirmer explicitement", async () => {
  const notConfirmed = await request(applyPath, "POST", { quizId: "trips", updates: [update("broken", { adventure: 0.7 }, { adventure: null })] });
  assert.equal(notConfirmed.status, 409);
  const confirmed = await request(applyPath, "POST", { quizId: "trips", updates: [update("broken", { adventure: 0.7 }, { adventure: null }, ["adventure"])] });
  assert.deepEqual(await confirmed.json(), { updatedProducts: 1, added: 0, replaced: 1 });
});

test("apply : validation des entrées et isolation", async () => {
  const cases: [Row, number][] = [
    [{ quizId: "trips", updates: [] }, 400],
    [{ quizId: "trips", updates: [update("trek", { culture: 1.2 }, { culture: null })] }, 400],
    [{ quizId: "trips", updates: [update("trek", { budget: 0.2 }, { budget: null })] }, 400],
    [{ quizId: "trips", updates: [update("trek", { culture: 0.2 }, {})] }, 400],
    [{ quizId: "trips", updates: [update("trek", { culture: 0.2 }, { culture: null }, ["comfort"])] }, 400],
    [{ quizId: "trips", updates: [update("trek", { culture: 0.2 }, { culture: null }), update("trek", { comfort: 0.2 }, { comfort: null })] }, 400],
    [{ quizId: "trips", updates: [update("hotel-1", { culture: 0.2 }, { culture: null })] }, 400],
    [{ quizId: "trips", updates: [update("foreign", { culture: 0.2 }, { culture: null })] }, 400],
    [{ quizId: "hotels", updates: [update("trek", { culture: 0.2 }, { culture: null })] }, 404],
  ];
  for (const [body, status] of cases) {
    const res = await request(applyPath, "POST", body);
    assert.equal(res.status, status, JSON.stringify(body));
  }
  const res = await request("/cat-trips/enrichment/apply", "POST", { quizId: "foreign-quiz", updates: [update("foreign", { culture: 0.2 }, { culture: null })] }, "tenant-b");
  assert.equal(res.status, 404);
  assert.deepEqual(products.find((p) => p.id === "foreign")!.attributes, {});
});

test("non-régression : le quota de génération de quiz reste indépendant", () => {
  assert.equal(generationLimiter.limit, 10);
  enrichmentLimiter.acquire("tenant-a", 5)();
  assert.equal(generationLimiter.remaining("tenant-a"), 10);
});
