import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { prisma } from "../src/lib/prisma";
import campaignsRouter from "../src/routes/campaigns";
import { quizErrorHandler } from "../src/services/quizzes";
import { effectiveStatus, effectiveStatusWhere } from "../src/services/campaigns";

type Row = Record<string, unknown>;

const catalogNames: Record<string, string> = {
  "catalog-a": "Catalogue principal",
  "catalog-voyages": "Voyages",
  "catalog-b": "Catalogue B",
};
const quizzes: Row[] = [
  { id: "coffee", tenantId: "tenant-a", catalogId: "catalog-a", name: "Mon café", active: true, useAllProducts: false, questions: 3, products: 2 },
  { id: "sleeping", tenantId: "tenant-a", catalogId: "catalog-voyages", name: "Quiz inactif", active: false, useAllProducts: true, questions: 1, products: 0 },
  { id: "foreign-quiz", tenantId: "tenant-b", catalogId: "catalog-b", name: "Quiz B", active: true, useAllProducts: true, questions: 5, products: 0 },
];
/** Produits actifs par catalogue, pour les quiz « tous les produits ». */
const activeProducts: Record<string, number> = { "catalog-a": 7, "catalog-voyages": 4, "catalog-b": 99 };
let productGroupWhere: Row | undefined;
const DAY = 24 * 60 * 60 * 1000;
let campaigns: Row[] = [];
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

/** Évaluateur minimal des filtres Prisma utilisés par la route (égalité, in, comparaisons, contains, AND/OR). */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === "AND") return (condition as Row[]).every((part) => matches(row, part));
    if (key === "OR") return (condition as Row[]).some((part) => matches(row, part));
    if (key === "quiz") {
      const quiz = quizzes.find((q) => q.id === row.quizId && q.tenantId === row.tenantId);
      return !!quiz && matches(quiz, condition as Row);
    }
    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (condition instanceof Date || typeof condition !== "object") {
      return value instanceof Date ? value.getTime() === (condition as Date).getTime() : value === condition;
    }
    const ops = condition as Row;
    return Object.entries(ops).every(([op, operand]) => {
      if (op === "mode") return true;
      if (op === "in") return (operand as unknown[]).includes(value);
      if (op === "contains") {
        return typeof value === "string" && value.toLowerCase().includes(String(operand).toLowerCase());
      }
      if (value === null || value === undefined) return false;
      const left = (value as Date).getTime();
      const right = (operand as Date).getTime();
      if (op === "gt") return left > right;
      if (op === "gte") return left >= right;
      if (op === "lt") return left < right;
      if (op === "lte") return left <= right;
      throw new Error(`Opérateur non simulé : ${op}`);
    });
  });
}

function withQuiz(row: Row) {
  const quiz = quizzes.find((q) => q.id === row.quizId && q.tenantId === row.tenantId);
  assert.ok(quiz, "la clé étrangère composite (tenantId, quizId) doit pointer vers un quiz du même tenant");
  return {
    ...row,
    quiz: {
      id: quiz.id, name: quiz.name, active: quiz.active, useAllProducts: quiz.useAllProducts,
      catalogId: quiz.catalogId, catalog: { id: quiz.catalogId, name: catalogNames[quiz.catalogId as string] },
      _count: { questions: quiz.questions, products: quiz.products },
    },
  };
}

function campaign(overrides: Row): Row {
  return {
    id: `seed-${++sequence}`, tenantId: "tenant-a", quizId: "coffee", name: "Campagne", occasion: "SPRING",
    occasionLabel: null, description: null, objectives: [], imageUrl: null, status: "DRAFT",
    startsAt: null, endsAt: null, createdAt: new Date(Date.now() - sequence * 1000), updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  const now = Date.now();
  campaigns = [
    campaign({ id: "draft-a", name: "Noël gourmand", occasion: "CHRISTMAS", description: "Coffrets de fin d'année" }),
    campaign({ id: "live-a", name: "Printemps", status: "ACTIVE", startsAt: new Date(now - DAY), endsAt: new Date(now + DAY) }),
    campaign({ id: "future-a", name: "Fête des mères", occasion: "MOTHERS_DAY", status: "SCHEDULED", startsAt: new Date(now + 3 * DAY) }),
    campaign({ id: "ended-a", name: "Soldes", occasion: "PROMOTION", status: "ACTIVE", startsAt: new Date(now - 3 * DAY), endsAt: new Date(now - DAY) }),
    campaign({ id: "paused-a", name: "Black Friday", occasion: "BLACK_FRIDAY", status: "PAUSED" }),
    campaign({ id: "foreign-campaign", tenantId: "tenant-b", quizId: "foreign-quiz", name: "Secret B" }),
  ];
});

before(async () => {
  process.env.JWT_SECRET = "multi-quiz-tests-only";
  stub(prisma.tenant, "findUnique", (async () => null) as typeof prisma.tenant.findUnique);
  stub(prisma.quiz, "upsert", (async () => {
    throw new Error("Une campagne ne doit jamais créer de quiz par défaut");
  }) as typeof prisma.quiz.upsert);
  stub(prisma.quiz, "findFirst", (async ({ where }: { where: { id: string; tenantId: string } }) => {
    const quiz = quizzes.find((q) => q.id === where.id && q.tenantId === where.tenantId);
    return quiz ? { ...quiz, products: [] } : null;
  }) as typeof prisma.quiz.findFirst);
  stub(prisma.product, "groupBy", (async ({ where }: { where: Row & { catalogId: { in: string[] } } }) => {
    productGroupWhere = where;
    return where.catalogId.in.map((catalogId) => ({ catalogId, _count: { _all: activeProducts[catalogId] ?? 0 } }));
  }) as unknown as typeof prisma.product.groupBy);
  stub(prisma.campaign, "findFirst", (async ({ where }: { where: Row }) => {
    const row = campaigns.find((c) => matches(c, where));
    return row ? withQuiz(row) : null;
  }) as typeof prisma.campaign.findFirst);
  stub(prisma.campaign, "findMany", (async ({ where, select }: { where: Row; select?: Row }) => {
    const rows = campaigns.filter((c) => matches(c, where));
    return select ? rows : rows.map(withQuiz);
  }) as typeof prisma.campaign.findMany);
  stub(prisma.campaign, "create", (async ({ data }: { data: Row }) => {
    const row = campaign({ ...data, id: `created-${++sequence}`, createdAt: new Date(), updatedAt: new Date() });
    const joined = withQuiz(row);
    campaigns.push(row);
    return joined;
  }) as typeof prisma.campaign.create);
  stub(prisma.campaign, "update", (async ({ where, data }: { where: { id: string }; data: Row }) => {
    const row = campaigns.find((c) => c.id === where.id);
    assert.ok(row);
    Object.assign(row, data, { updatedAt: new Date() });
    return withQuiz(row);
  }) as typeof prisma.campaign.update);
  stub(prisma.campaign, "deleteMany", (async ({ where }: { where: Row }) => {
    const before = campaigns.length;
    campaigns = campaigns.filter((c) => !matches(c, where));
    return { count: before - campaigns.length };
  }) as typeof prisma.campaign.deleteMany);

  const app = express();
  app.use(express.json());
  app.use("/api/campaigns", campaignsRouter);
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

async function request(path: string, method = "GET", body?: unknown, token: Record<string, unknown> | null = { tenantId: "tenant-a", email: "a@example.test" }) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${jwt.sign(token, process.env.JWT_SECRET!)}`;
  return originalFetch(`${base}/api/campaigns${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const validInput = { quizId: "coffee", name: "Noël 2026", occasion: "CHRISTMAS", objectives: ["Augmenter le panier moyen", "  "] };

test("authentification requise et super-admin sans tenant refusé", async () => {
  assert.equal((await request("", "GET", undefined, null)).status, 401);
  const res = await request("", "GET", undefined, { tenantId: "super-admin", email: "root@example.test", isSuperAdmin: true });
  assert.equal(res.status, 403);
});

test("la liste ne contient que les campagnes du tenant, avec statuts calculés et compteurs", async () => {
  const res = await request("");
  assert.equal(res.status, 200);
  const body = await res.json();
  const ids = body.data.map((c: Row) => c.id);
  assert.ok(!ids.includes("foreign-campaign"));
  assert.equal(ids.length, 5);
  const byId = Object.fromEntries(body.data.map((c: Row) => [c.id, c.effectiveStatus]));
  assert.deepEqual(byId, { "draft-a": "DRAFT", "live-a": "ACTIVE", "future-a": "SCHEDULED", "ended-a": "COMPLETED", "paused-a": "PAUSED" });
  assert.deepEqual(body.counts, { total: 5, DRAFT: 1, SCHEDULED: 1, ACTIVE: 1, PAUSED: 1, COMPLETED: 1 });
  const live = body.data.find((c: Row) => c.id === "live-a");
  assert.deepEqual(live.quiz, {
    id: "coffee", name: "Mon café", active: true, questionCount: 3, productCount: 2,
    catalog: { id: "catalog-a", name: "Catalogue principal" },
  });
});

test("filtres par statut calculé, recherche et paramètres invalides", async () => {
  for (const [status, expected] of [["ACTIVE", ["live-a"]], ["SCHEDULED", ["future-a"]], ["COMPLETED", ["ended-a"]], ["DRAFT", ["draft-a"]], ["PAUSED", ["paused-a"]]]) {
    const body = await (await request(`?status=${status}`)).json();
    assert.deepEqual(body.data.map((c: Row) => c.id), expected, status);
    assert.equal(body.counts.total, 5, "les compteurs ignorent les filtres");
  }
  const search = await (await request("?search=fin%20d'ann%C3%A9e")).json();
  assert.deepEqual(search.data.map((c: Row) => c.id), ["draft-a"]);
  const secret = await (await request("?search=Secret")).json();
  assert.equal(secret.data.length, 0);
  assert.equal((await request("?status=LIVE")).status, 400);
  assert.equal((await request("?occasion=EASTER")).status, 400);
  assert.equal((await request("?sort=__proto__")).status, 400);
});

test("effectiveStatusWhere est cohérent avec effectiveStatus pour toutes les combinaisons", () => {
  const now = new Date();
  const dates = [null, new Date(now.getTime() - 2 * DAY), new Date(now.getTime() + 2 * DAY)];
  for (const status of ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED"] as const) {
    for (const startsAt of dates) {
      for (const endsAt of dates) {
        const row = { status, startsAt, endsAt };
        const computed = effectiveStatus(row, now);
        for (const candidate of ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED"] as const) {
          assert.equal(matches(row, effectiveStatusWhere(candidate, now) as Row), candidate === computed, `${status} ${startsAt} ${endsAt} → ${candidate}`);
        }
      }
    }
  }
});

test("création : tenant imposé par le token, brouillon par défaut, objectifs nettoyés", async () => {
  const res = await request("", "POST", { ...validInput, tenantId: "tenant-b", id: "forced", status: undefined });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.tenantId, "tenant-a");
  assert.notEqual(body.id, "forced");
  assert.equal(body.status, "DRAFT");
  assert.equal(body.effectiveStatus, "DRAFT");
  assert.deepEqual(body.objectives, ["Augmenter le panier moyen"]);
});

test("création : quiz requis, quiz d'un autre tenant refusé", async () => {
  assert.equal((await request("", "POST", { ...validInput, quizId: undefined })).status, 400);
  assert.equal((await request("", "POST", { ...validInput, quizId: "foreign-quiz" })).status, 404);
  assert.equal(campaigns.length, 6);
});

test("validations des champs", async () => {
  const cases: Row[] = [
    { name: "  " },
    { name: "x".repeat(121) },
    { occasion: "EASTER" },
    { occasion: "CUSTOM" },
    { status: "LIVE" },
    { status: "SCHEDULED" },
    { startsAt: "pas une date" },
    { startsAt: "2026-12-10T00:00:00.000Z", endsAt: "2026-12-01T00:00:00.000Z" },
    { objectives: "Vendre" },
    { objectives: Array.from({ length: 11 }, (_, i) => `Objectif ${i}`) },
    { imageUrl: "javascript:alert(1)" },
  ];
  for (const patch of cases) {
    const res = await request("", "POST", { ...validInput, ...patch });
    assert.equal(res.status, 400, JSON.stringify(patch));
  }
  const custom = await request("", "POST", { ...validInput, occasion: "CUSTOM", occasionLabel: "Anniversaire boutique" });
  assert.equal(custom.status, 201);
});

test("programmer ou activer une campagne exige un quiz actif", async () => {
  const startsAt = new Date(Date.now() + DAY).toISOString();
  assert.equal((await request("", "POST", { ...validInput, quizId: "sleeping", status: "SCHEDULED", startsAt })).status, 400);
  assert.equal((await request("", "POST", { ...validInput, quizId: "sleeping", status: "ACTIVE" })).status, 400);
  assert.equal((await request("", "POST", { ...validInput, quizId: "sleeping" })).status, 201);
  assert.equal((await request("/draft-a", "PUT", { quizId: "sleeping", status: "ACTIVE" })).status, 400);
});

test("une campagne d'un autre tenant est introuvable pour toutes les opérations", async () => {
  assert.equal((await request("/foreign-campaign")).status, 404);
  assert.equal((await request("/foreign-campaign", "PUT", { name: "Piratée" })).status, 404);
  assert.equal((await request("/foreign-campaign/duplicate", "POST")).status, 404);
  assert.equal((await request("/foreign-campaign", "DELETE")).status, 404);
  const foreign = campaigns.find((c) => c.id === "foreign-campaign");
  assert.equal(foreign?.name, "Secret B");
  assert.equal(campaigns.length, 6);
});

test("modification : bascule en ligne / pause et changement de quiz contrôlé", async () => {
  const paused = await request("/live-a", "PUT", { status: "PAUSED", tenantId: "tenant-b" });
  assert.equal(paused.status, 200);
  const body = await paused.json();
  assert.equal(body.effectiveStatus, "PAUSED");
  assert.equal(body.tenantId, "tenant-a");
  assert.equal((await (await request("/live-a", "PUT", { status: "ACTIVE" })).json()).effectiveStatus, "ACTIVE");
  assert.equal((await request("/live-a", "PUT", { quizId: "foreign-quiz" })).status, 404);
  assert.equal((await request("/live-a", "PUT", { endsAt: new Date(Date.now() - 2 * DAY).toISOString() })).status, 400);
});

test("duplication en brouillon sans dates", async () => {
  const res = await request("/live-a/duplicate", "POST");
  assert.equal(res.status, 201);
  const copy = await res.json();
  assert.equal(copy.name, "Printemps (copie)");
  assert.equal(copy.status, "DRAFT");
  assert.equal(copy.startsAt, null);
  assert.equal(copy.endsAt, null);
  assert.equal(copy.quizId, "coffee");
  assert.equal(copy.tenantId, "tenant-a");
});

test("seuls les brouillons peuvent être supprimés", async () => {
  assert.equal((await request("/live-a", "DELETE")).status, 409);
  assert.equal((await request("/paused-a", "DELETE")).status, 409);
  assert.equal((await request("/draft-a", "DELETE")).status, 204);
  assert.equal((await request("/draft-a")).status, 404);
});

test("multi-catalogue : filtre par catalogue, compteurs limités au catalogue et produits comptés par catalogue", async () => {
  campaigns.push(campaign({ id: "voyage-a", quizId: "sleeping", name: "Évasion" }));
  const body = await (await request("?catalogId=catalog-voyages")).json();
  assert.deepEqual(body.data.map((c: Row) => c.id), ["voyage-a"]);
  assert.deepEqual(body.counts, { total: 1, DRAFT: 1, SCHEDULED: 0, ACTIVE: 0, PAUSED: 0, COMPLETED: 0 });
  const quiz = body.data[0].quiz;
  assert.deepEqual(quiz.catalog, { id: "catalog-voyages", name: "Voyages" });
  assert.equal(quiz.productCount, 4, "« tous les produits » = produits actifs du catalogue du quiz, pas du tenant");
  assert.deepEqual(productGroupWhere, { tenantId: "tenant-a", active: true, catalogId: { in: ["catalog-voyages"] } });

  const foreign = await (await request("?catalogId=catalog-b")).json();
  assert.equal(foreign.data.length, 0, "un catalogue d'un autre tenant ne révèle aucune campagne");
  assert.equal(foreign.counts.total, 0);
});
