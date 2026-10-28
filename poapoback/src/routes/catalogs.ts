import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import type { CatalogSummary } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { verifyToken, AuthRequest } from "../middleware/auth";
import { ensureDefaultCatalog, parseCatalogInput, resolveAccountTenantId, serializeCatalog } from "../services/catalogs";
import { asyncRoute, QuizError } from "../services/quizzes";
import productEnrichmentRouter from "./productEnrichment";
import { assertResourceQuota, requireFeature, withTenantLock } from "../services/entitlements";

// Gestion des catalogues d'un tenant : chaque produit et chaque quiz appartient à un seul catalogue.
const router = Router();
router.use(verifyToken);
router.use("/:catalogId/enrichment", requireFeature("aiEnrichment", ["GET", "POST", "PUT", "PATCH", "DELETE"]), productEnrichmentRouter);

async function tenantOf(req: AuthRequest): Promise<string> {
  const tenantId = await resolveAccountTenantId(req);
  if (!tenantId) throw new QuizError(403, "Aucun tenant valide associé à ce compte");
  return tenantId;
}

async function findCatalog(tenantId: string, id: unknown) {
  if (typeof id !== "string" || !id) throw new QuizError(404, "Catalogue introuvable");
  const catalog = await prisma.catalog.findFirst({ where: { id, tenantId } });
  if (!catalog) throw new QuizError(404, "Catalogue introuvable");
  return catalog;
}

function duplicateName(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new QuizError(409, "Un catalogue porte déjà ce nom");
  }
  throw err;
}

/** Compteurs par catalogue, calculés en trois requêtes groupées toutes filtrées par tenant. */
async function summarize(tenantId: string, catalogIds: string[]) {
  const [products, activeProducts, quizzes] = await Promise.all([
    prisma.product.groupBy({ by: ["catalogId"], where: { tenantId, catalogId: { in: catalogIds } }, _count: { _all: true } }),
    prisma.product.groupBy({
      by: ["catalogId"],
      where: { tenantId, catalogId: { in: catalogIds }, active: true },
      _count: { _all: true },
    }),
    prisma.quiz.findMany({
      where: { tenantId, catalogId: { in: catalogIds } },
      select: { catalogId: true, _count: { select: { campaigns: true } } },
    }),
  ]);
  const productCount = new Map(products.map((row) => [row.catalogId, row._count._all]));
  const activeCount = new Map(activeProducts.map((row) => [row.catalogId, row._count._all]));
  const quizCount = new Map<string, number>();
  const campaignCount = new Map<string, number>();
  for (const quiz of quizzes) {
    quizCount.set(quiz.catalogId, (quizCount.get(quiz.catalogId) ?? 0) + 1);
    campaignCount.set(quiz.catalogId, (campaignCount.get(quiz.catalogId) ?? 0) + quiz._count.campaigns);
  }
  return (catalog: Prisma.CatalogGetPayload<object>): CatalogSummary => ({
    ...serializeCatalog(catalog),
    productCount: productCount.get(catalog.id) ?? 0,
    activeProductCount: activeCount.get(catalog.id) ?? 0,
    quizCount: quizCount.get(catalog.id) ?? 0,
    campaignCount: campaignCount.get(catalog.id) ?? 0,
  });
}

// GET /api/catalogs — catalogue par défaut en premier, puis ordre alphabétique
router.get("/", asyncRoute(async (req: AuthRequest, res: Response) => {
  const tenantId = await tenantOf(req);
  await ensureDefaultCatalog(tenantId);
  const catalogs = await prisma.catalog.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  const toSummary = await summarize(tenantId, catalogs.map((catalog) => catalog.id));
  res.json(catalogs.map(toSummary));
}));

router.post("/", asyncRoute(async (req: AuthRequest, res: Response) => {
  const tenantId = await tenantOf(req);
  const data = parseCatalogInput(req.body, true);
  // Le catalogue par défaut doit exister avant tout autre : les anciennes API s'y rattachent.
  await ensureDefaultCatalog(tenantId);
  const catalog = await withTenantLock(tenantId, async (db) => {
    await assertResourceQuota(db, tenantId, "catalogs");
    return db.catalog
      .create({ data: { tenantId, name: data.name!, description: data.description ?? null, isDefault: false } })
      .catch(duplicateName);
  });
  res.status(201).json((await summarize(tenantId, [catalog.id]))(catalog));
}));

router.get("/:id", asyncRoute(async (req: AuthRequest, res: Response) => {
  const tenantId = await tenantOf(req);
  const catalog = await findCatalog(tenantId, req.params.id);
  res.json((await summarize(tenantId, [catalog.id]))(catalog));
}));

router.put("/:id", asyncRoute(async (req: AuthRequest, res: Response) => {
  const tenantId = await tenantOf(req);
  const existing = await findCatalog(tenantId, req.params.id);
  const data = parseCatalogInput(req.body, false);
  const catalog = await prisma.catalog.update({ where: { id: existing.id }, data }).catch(duplicateName);
  res.json((await summarize(tenantId, [catalog.id]))(catalog));
}));

// Suppression réservée aux catalogues secondaires vides : aucune donnée n'est déplacée ni supprimée en cascade.
router.delete("/:id", asyncRoute(async (req: AuthRequest, res: Response) => {
  const tenantId = await tenantOf(req);
  const catalog = await findCatalog(tenantId, req.params.id);
  if (catalog.isDefault) throw new QuizError(409, "Le catalogue principal ne peut pas être supprimé");
  const [products, quizzes] = await Promise.all([
    prisma.product.count({ where: { tenantId, catalogId: catalog.id } }),
    prisma.quiz.count({ where: { tenantId, catalogId: catalog.id } }),
  ]);
  if (products || quizzes) {
    throw new QuizError(409, `Ce catalogue contient ${products} produit(s) et ${quizzes} quiz : videz-le avant de le supprimer`);
  }
  await prisma.catalog.delete({ where: { id: catalog.id } });
  res.json({ ok: true });
}));

export default router;
