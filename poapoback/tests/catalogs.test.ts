import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import catalogsRouter from "../src/routes/catalogs";
import catalogRouter from "../src/routes/catalog";
import importRouter from "../src/routes/import";
import { quizErrorHandler } from "../src/services/quizzes";

type Row = Record<string, any>;

const AXES = [{ key: "comfort", label: "Confort", lowLabel: null, highLabel: null }];
let catalogs: Row[] = [];
let products: Row[] = [];
let quizzes: Row[] = [];
let selections: Row[] = [];
let lastProductListWhere: Row | undefined;
let sequence = 0;
let server: Server;
let base: string;
const originalFetch = globalThis.fetch;
const restores: (() => void)[] = [];

function stub<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const previous = target[key];
  target[key] = value;
  restores.push(() => { target[key] = previous; });
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Row[]).some((part) => matches(row, part));
    if (condition !== null && typeof condition === "object" && "in" in condition) return condition.in.includes(row[key]);
    if (condition !== null && typeof condition === "object" && "contains" in condition) {
      return String(row[key] ?? "").toLowerCase().includes(String(condition.contains).toLowerCase());
    }
    return row[key] === condition;
  });
}

function countBy(rows: Row[], where: Row) {
  const groups = new Map<string, number>();
  for (const row of rows.filter((item) => matches(item, where))) {
    groups.set(row.catalogId, (groups.get(row.catalogId) ?? 0) + 1);
  }
  return [...groups.entries()].map(([catalogId, count]) => ({ catalogId, _count: { _all: count } }));
}

beforeEach(() => {
  const now = new Date();
  catalogs = [
    { id: "catalog_tenant-a", tenantId: "tenant-a", name: "Catalogue principal", description: null, isDefault: true, createdAt: now, updatedAt: now },
    { id: "catalog-heberg", tenantId: "tenant-a", name: "Hébergements", description: null, isDefault: false, createdAt: now, updatedAt: now },
    { id: "catalog-empty", tenantId: "tenant-a", name: "Vide", description: null, isDefault: false, createdAt: now, updatedAt: now },
    { id: "catalog_tenant-b", tenantId: "tenant-b", name: "Catalogue B", description: null, isDefault: true, createdAt: now, updatedAt: now },
  ];
  products = [
    { id: "exp-1", tenantId: "tenant-a", catalogId: "catalog_tenant-a", name: "Trek", active: true, attributes: {} },
    { id: "exp-2", tenantId: "tenant-a", catalogId: "catalog_tenant-a", name: "Plongée", active: false, attributes: {} },
    { id: "hotel-1", tenantId: "tenant-a", catalogId: "catalog-heberg", name: "Riad", active: true, attributes: {} },
    { id: "foreign", tenantId: "tenant-b", catalogId: "catalog_tenant-b", name: "Secret B", active: true, attributes: {} },
  ];
  quizzes = [
    { id: "quiz-exp", tenantId: "tenant-a", catalogId: "catalog_tenant-a", axes: [], campaigns: 2, isDefault: true, createdAt: now },
    { id: "quiz-hotel", tenantId: "tenant-a", catalogId: "catalog-heberg", axes: AXES, campaigns: 1, isDefault: false, createdAt: now },
    { id: "quiz-b", tenantId: "tenant-b", catalogId: "catalog_tenant-b", axes: AXES, campaigns: 3, isDefault: true, createdAt: now },
  ];
  selections = [{ quizId: "quiz-exp", productId: "exp-1" }];
});

before(async () => {
  process.env.JWT_SECRET = "multi-quiz-tests-only";
  delete process.env.AI_SERVICE_URL;

  stub(prisma.tenant, "findUnique", (async ({ where }: { where: Row }) => {
    if (where.id === "tenant-a" || where.email === "a@example.test") return { id: "tenant-a" };
    if (where.id === "tenant-b") return { id: "tenant-b" };
    return null;
  }) as unknown as typeof prisma.tenant.findUnique);

  stub(prisma.catalog, "findFirst", (async ({ where }: { where: Row }) =>
    catalogs.find((catalog) => matches(catalog, where)) ?? null
  ) as unknown as typeof prisma.catalog.findFirst);
  stub(prisma.catalog, "findMany", (async ({ where }: { where: Row }) => (
    catalogs.filter((catalog) => matches(catalog, where))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
  )) as unknown as typeof prisma.catalog.findMany);
  stub(prisma.catalog, "upsert", (async ({ create }: { create: Row }) => {
    const row = { description: null, createdAt: new Date(), updatedAt: new Date(), ...create };
    catalogs.push(row);
    return row;
  }) as unknown as typeof prisma.catalog.upsert);
  const duplicate = (tenantId: string, name: string, id?: string) => {
    if (catalogs.some((catalog) => catalog.tenantId === tenantId && catalog.name === name && catalog.id !== id)) {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    }
  };
  stub(prisma.catalog, "create", (async ({ data }: { data: Row }) => {
    duplicate(data.tenantId, data.name);
    const row = { ...data, id: `catalog-${++sequence}`, createdAt: new Date(), updatedAt: new Date() };
    catalogs.push(row);
    return row;
  }) as unknown as typeof prisma.catalog.create);
  stub(prisma.catalog, "update", (async ({ where, data }: { where: Row; data: Row }) => {
    const row = catalogs.find((catalog) => catalog.id === where.id)!;
    if (data.name) duplicate(row.tenantId, data.name, row.id);
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  }) as unknown as typeof prisma.catalog.update);
  stub(prisma.catalog, "delete", (async ({ where }: { where: Row }) => {
    const row = catalogs.find((catalog) => catalog.id === where.id)!;
    catalogs = catalogs.filter((catalog) => catalog !== row);
    return row;
  }) as unknown as typeof prisma.catalog.delete);

  stub(prisma.product, "groupBy", (async ({ where }: { where: Row }) => countBy(products, where)) as unknown as typeof prisma.product.groupBy);
  stub(prisma.product, "count", (async ({ where }: { where: Row }) => products.filter((p) => matches(p, where)).length) as unknown as typeof prisma.product.count);
  stub(prisma.product, "findMany", (async ({ where }: { where: Row }) => {
    lastProductListWhere = where;
    return products.filter((p) => matches(p, where));
  }) as unknown as typeof prisma.product.findMany);
  stub(prisma.product, "findFirst", (async ({ where }: { where: Row }) => products.find((p) => matches(p, where)) ?? null) as unknown as typeof prisma.product.findFirst);
  stub(prisma.product, "create", (async ({ data }: { data: Row }) => {
    const row = { ...data, id: `product-${++sequence}` };
    products.push(row);
    return row;
  }) as unknown as typeof prisma.product.create);
  stub(prisma.product, "update", (async ({ where, data }: { where: Row; data: Row }) => {
    const row = products.find((p) => p.id === where.id)!;
    Object.assign(row, data);
    return row;
  }) as unknown as typeof prisma.product.update);

  stub(prisma.quiz, "findMany", (async ({ where, select }: { where: Row; select: Row }) => (
    quizzes.filter((quiz) => matches(quiz, where)).map((quiz) => (
      select._count ? { catalogId: quiz.catalogId, _count: { campaigns: quiz.campaigns } } : { axes: quiz.axes }
    ))
  )) as unknown as typeof prisma.quiz.findMany);
  stub(prisma.quiz, "count", (async ({ where }: { where: Row }) => quizzes.filter((q) => matches(q, where)).length) as unknown as typeof prisma.quiz.count);
  stub(prisma.quizProduct, "count", (async ({ where }: { where: Row }) => selections.filter((s) => matches(s, where)).length) as unknown as typeof prisma.quizProduct.count);

  const app = express();
  app.use(express.json());
  app.use("/api/catalogs", catalogsRouter);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/catalog/import", importRouter);
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

const SCHEME = "Bearer";

async function request(path: string, method = "GET", body?: unknown, token: Row | null = { tenantId: "tenant-a", email: "a@example.test" }) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `${SCHEME} ${jwt.sign(token, process.env.JWT_SECRET!)}`;
  return originalFetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

// ─── Catalogues ───────────────────────────────────────────────────────────────

test("liste : authentification requise, catalogues du tenant uniquement, défaut en premier, compteurs par catalogue", async () => {
  assert.equal((await request("/api/catalogs", "GET", undefined, null)).status, 401);
  const res = await request("/api/catalogs");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.map((c: Row) => c.id), ["catalog_tenant-a", "catalog-heberg", "catalog-empty"]);
  const main = body[0];
  assert.equal(main.isDefault, true);
  assert.deepEqual(
    [main.productCount, main.activeProductCount, main.quizCount, main.campaignCount],
    [2, 1, 1, 2],
  );
  assert.deepEqual([body[1].productCount, body[1].quizCount, body[1].campaignCount], [1, 1, 1]);
  assert.deepEqual([body[2].productCount, body[2].quizCount, body[2].campaignCount], [0, 0, 0]);
});

test("liste : un tenant sans catalogue reçoit son catalogue par défaut", async () => {
  catalogs = catalogs.filter((catalog) => catalog.tenantId !== "tenant-a");
  const body = await (await request("/api/catalogs")).json();
  assert.equal(body.length, 1);
  assert.deepEqual([body[0].id, body[0].name, body[0].isDefault], ["catalog_tenant-a", "Catalogue principal", true]);
});

test("création et renommage : validations et nom unique par tenant", async () => {
  assert.equal((await request("/api/catalogs", "POST", { name: "  " })).status, 400);
  assert.equal((await request("/api/catalogs", "POST", { name: "x".repeat(81) })).status, 400);
  assert.equal((await request("/api/catalogs", "POST", { name: "OK", description: 42 })).status, 400);
  assert.equal((await request("/api/catalogs", "POST", { name: "Hébergements" })).status, 409);

  const created = await request("/api/catalogs", "POST", { name: "  Locations  ", description: " Voitures " });
  assert.equal(created.status, 201);
  const catalog = await created.json();
  assert.deepEqual([catalog.name, catalog.description, catalog.isDefault, catalog.tenantId], ["Locations", "Voitures", false, "tenant-a"]);

  assert.equal((await request(`/api/catalogs/${catalog.id}`, "PUT", { name: "Hébergements" })).status, 409);
  const renamed = await request(`/api/catalogs/${catalog.id}`, "PUT", { name: "Location de voitures", description: null });
  assert.equal(renamed.status, 200);
  assert.deepEqual([(await renamed.json()).name], ["Location de voitures"]);
});

test("isolation : un catalogue d'un autre tenant est introuvable pour toutes les opérations", async () => {
  assert.equal((await request("/api/catalogs/catalog_tenant-b")).status, 404);
  assert.equal((await request("/api/catalogs/catalog_tenant-b", "PUT", { name: "Piraté" })).status, 404);
  assert.equal((await request("/api/catalogs/catalog_tenant-b", "DELETE")).status, 404);
  assert.equal(catalogs.find((c) => c.id === "catalog_tenant-b")!.name, "Catalogue B");
});

test("suppression : catalogue principal et catalogue non vide refusés, catalogue vide supprimé", async () => {
  assert.equal((await request("/api/catalogs/catalog_tenant-a", "DELETE")).status, 409);
  assert.equal((await request("/api/catalogs/catalog-heberg", "DELETE")).status, 409);
  assert.equal((await request("/api/catalogs/catalog-empty", "DELETE")).status, 200);
  assert.ok(!catalogs.some((c) => c.id === "catalog-empty"));
  assert.ok(catalogs.some((c) => c.id === "catalog-heberg"));
});

// ─── Produits ─────────────────────────────────────────────────────────────────

test("produits : liste filtrée par catalogue, sans filtre tous les produits du tenant", async () => {
  const all = await (await request("/api/catalog/products")).json();
  assert.deepEqual(all.data.map((p: Row) => p.id).sort(), ["exp-1", "exp-2", "hotel-1"]);
  assert.equal(lastProductListWhere!.catalogId, undefined);

  const hotels = await (await request("/api/catalog/products?catalogId=catalog-heberg")).json();
  assert.deepEqual(hotels.data.map((p: Row) => p.id), ["hotel-1"]);
  assert.equal(lastProductListWhere!.tenantId, "tenant-a");

  const foreign = await (await request("/api/catalog/products?catalogId=catalog_tenant-b")).json();
  assert.equal(foreign.data.length, 0);
});

test("produits : création dans le catalogue par défaut ou choisi, catalogue étranger refusé", async () => {
  const legacy = await request("/api/catalog/products", "POST", { name: "Sans catalogue" });
  assert.equal(legacy.status, 201);
  assert.equal((await legacy.json()).catalogId, "catalog_tenant-a");

  const hotel = await request("/api/catalog/products", "POST", { name: "Lodge", catalogId: "catalog-heberg", attributes: { comfort: 0.8 } });
  assert.equal(hotel.status, 201);
  assert.equal((await hotel.json()).catalogId, "catalog-heberg");

  // Les axes de validation sont ceux du catalogue ciblé.
  assert.equal((await request("/api/catalog/products", "POST", { name: "Lodge", catalogId: "catalog-heberg", attributes: { comfort: 3 } })).status, 400);
  assert.equal((await request("/api/catalog/products", "POST", { name: "Trek", attributes: { comfort: 3 } })).status, 201);

  assert.equal((await request("/api/catalog/products", "POST", { name: "X", catalogId: "catalog_tenant-b" })).status, 404);
  assert.ok(!products.some((p) => p.tenantId === "tenant-a" && p.catalogId === "catalog_tenant-b"));
});

test("produits : déplacement refusé si le produit est sélectionné dans un quiz, autorisé sinon", async () => {
  const blocked = await request("/api/catalog/products/exp-1", "PUT", { catalogId: "catalog-heberg" });
  assert.equal(blocked.status, 409);
  assert.equal(products.find((p) => p.id === "exp-1")!.catalogId, "catalog_tenant-a");

  assert.equal((await request("/api/catalog/products/exp-2", "PUT", { catalogId: "catalog-heberg", attributes: { comfort: 2 } })).status, 400);
  const moved = await request("/api/catalog/products/exp-2", "PUT", { catalogId: "catalog-heberg" });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).catalogId, "catalog-heberg");

  assert.equal((await request("/api/catalog/products/exp-1", "PUT", { catalogId: "catalog_tenant-b" })).status, 404);
  assert.equal((await request("/api/catalog/products/foreign", "PUT", { name: "Piraté" })).status, 404);
});

// ─── Import CSV ───────────────────────────────────────────────────────────────

const mapping = [{ sourceColumn: "nom", targetField: "name" }];

test("import : catalogue choisi, catalogue par défaut sans catalogId, catalogue étranger refusé", async () => {
  const chosen = await request("/api/catalog/import/execute", "POST", { mapping, rows: [{ nom: "Gîte" }, { nom: "" }], catalogId: "catalog-heberg" });
  assert.equal(chosen.status, 200);
  const body = await chosen.json();
  assert.deepEqual([body.created, body.skipped, body.catalog], [1, 1, { id: "catalog-heberg", name: "Hébergements" }]);
  assert.equal(products.find((p) => p.name === "Gîte")!.catalogId, "catalog-heberg");

  const legacy = await (await request("/api/catalog/import/execute", "POST", { mapping, rows: [{ nom: "Safari" }] })).json();
  assert.equal(legacy.catalog.id, "catalog_tenant-a");
  assert.equal(products.find((p) => p.name === "Safari")!.catalogId, "catalog_tenant-a");

  const before = products.length;
  assert.equal((await request("/api/catalog/import/execute", "POST", { mapping, rows: [{ nom: "Intrus" }], catalogId: "catalog_tenant-b" })).status, 404);
  assert.equal(products.length, before);
});

test("import : l'analyse du fichier renvoie le catalogue cible", async () => {
  const form = new FormData();
  form.append("catalogId", "catalog-heberg");
  form.append("file", new Blob(["nom,prix\nRiad,120\n"], { type: "text/csv" }), "produits.csv");
  const headers = { Authorization: `${SCHEME} ${jwt.sign({ tenantId: "tenant-a", email: "a@example.test" }, process.env.JWT_SECRET!)}` };
  const res = await originalFetch(`${base}/api/catalog/import/parse`, { method: "POST", headers, body: form });
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.deepEqual(body.catalog, { id: "catalog-heberg", name: "Hébergements" });
  assert.equal(body.total, 1);

  const foreign = new FormData();
  foreign.append("catalogId", "catalog_tenant-b");
  foreign.append("file", new Blob(["nom\nX\n"], { type: "text/csv" }), "produits.csv");
  assert.equal((await originalFetch(`${base}/api/catalog/import/parse`, { method: "POST", headers, body: foreign })).status, 404);
});

// ─── Import guidé : aperçu, validation, embeddings ───────────────────────────

const guidedMapping = [
  { sourceColumn: "nom", targetField: "name" },
  { sourceColumn: "prix", targetField: "price" },
  { sourceColumn: "confort", targetField: "attribute.comfort" },
  { sourceColumn: "origine", targetField: null },
];

test("aperçu : aucune écriture, erreurs ligne par ligne, avertissements distincts", async () => {
  const before = products.length;
  const res = await request("/api/catalog/import/preview", "POST", {
    catalogId: "catalog-heberg", mapping: guidedMapping,
    rows: [
      { nom: "Riad 2", prix: "90", confort: "0.8", origine: "Maroc" },
      { nom: "Lodge", prix: "abc", confort: "0.5" },
      { nom: "Cabane", prix: "50", confort: "7" },
      { nom: "", prix: "10", confort: "0.1" },
      { nom: "Gîte", prix: "40", confort: "" },
    ],
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(products.length, before);
  assert.deepEqual([body.total, body.valid, body.invalid, body.canImport], [5, 2, 3, true]);
  assert.deepEqual(body.issues.filter((i: Row) => i.severity === "error").map((i: Row) => i.line), [3, 4, 5]);
  assert.ok(body.issues.some((i: Row) => i.severity === "warning" && i.line === 6));
  assert.ok(body.mappingIssues.some((i: Row) => i.severity === "warning" && /origine/.test(i.message)));
  assert.equal(body.sample.length, 2);
  assert.equal(body.sample[0].product.attributes.comfort, 0.8);
});

test("aperçu et import : destinations en double et mapping sans nom refusés", async () => {
  const dup = { catalogId: "catalog-heberg", rows: [{ a: "x", b: "y" }], mapping: [
    { sourceColumn: "a", targetField: "name" }, { sourceColumn: "b", targetField: "name" }] };
  const preview = await (await request("/api/catalog/import/preview", "POST", dup)).json();
  assert.equal(preview.canImport, false);
  const before = products.length;
  assert.equal((await request("/api/catalog/import/execute", "POST", dup)).status, 400);
  const noName = { catalogId: "catalog-heberg", rows: [{ a: "x" }], mapping: [{ sourceColumn: "a", targetField: "price" }] };
  assert.equal((await request("/api/catalog/import/execute", "POST", noName)).status, 400);
  assert.equal(products.length, before);
});

test("aperçu : isolation tenant/catalogue et corps invalide", async () => {
  const body = { mapping: guidedMapping, rows: [{ nom: "X" }] };
  assert.equal((await request("/api/catalog/import/preview", "POST", { ...body, catalogId: "catalog_tenant-b" })).status, 404);
  assert.equal((await request("/api/catalog/import/preview", "POST", { ...body, catalogId: "catalog-heberg" }, null)).status, 401);
  assert.equal((await request("/api/catalog/import/preview", "POST", { mapping: guidedMapping, rows: [] })).status, 400);
  assert.equal((await request("/api/catalog/import/preview", "POST", { mapping: guidedMapping, rows: ["x"] })).status, 400);
});

test("import confirmé : seules les lignes valides sont créées, embeddings déclenchés après l'écriture", async () => {
  process.env.AI_SERVICE_URL = "http://ai.invalid";
  const embedded: string[] = [];
  stub(prisma.product, "findUnique", (async ({ where }: { where: Row }) => products.find((p) => p.id === where.id) ?? null) as unknown as typeof prisma.product.findUnique);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith("/embed/product")) { embedded.push(JSON.parse(init!.body!).id); return new Response("{}", { status: 503 }); }
    return realFetch(url as never, init as never);
  }) as typeof fetch;
  try {
    const res = await request("/api/catalog/import/execute", "POST", {
      catalogId: "catalog-heberg", mapping: guidedMapping,
      rows: [{ nom: "Riad 2", prix: "90", confort: "0.8" }, { nom: "Mauvais", prix: "abc" }],
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual([body.created, body.skipped, body.embeddings], [1, 1, "queued"]);
    assert.match(body.errors[0], /Ligne 3/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const created = products.find((p) => p.name === "Riad 2")!;
    assert.deepEqual([created.tenantId, created.catalogId, created.price], ["tenant-a", "catalog-heberg", 90]);
    assert.deepEqual(embedded, [created.id]);
    assert.ok(!products.some((p) => p.name === "Mauvais"));
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.AI_SERVICE_URL;
  }
});

test("analyse : suggestions locales, fichier vide ou sans en-tête refusé", async () => {
  const headers = { Authorization: `${SCHEME} ${jwt.sign({ tenantId: "tenant-a", email: "a@example.test" }, process.env.JWT_SECRET!)}` };
  const send = async (csv: string) => {
    const form = new FormData();
    form.append("catalogId", "catalog-heberg");
    form.append("file", new Blob([csv], { type: "text/csv" }), "p.csv");
    return originalFetch(`${base}/api/catalog/import/parse`, { method: "POST", headers, body: form });
  };
  const ok = await (await send("Nom;Prix\nRiad;1\n".replace(/;/g, ","))).json();
  assert.deepEqual(ok.suggestedMapping.map((m: Row) => m.targetField), ["name", "price"]);
  assert.equal((await send("")).status, 400);
  assert.equal((await send("nom,prix\n")).status, 400);
});
