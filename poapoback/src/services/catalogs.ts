import type { Prisma } from "@prisma/client";
import type { Catalog as CatalogDto, CatalogRef, QuizAxis } from "@poapo/types";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { parseAxes } from "./axes";
import { QuizError } from "./quizzes";

type CatalogDb = Prisma.TransactionClient | typeof prisma;

export const CATALOG_LIMITS = { name: 80, description: 500 } as const;
export const DEFAULT_CATALOG_NAME = "Catalogue principal";

export const catalogRefSelect = { id: true, name: true } satisfies Prisma.CatalogSelect;

/** Identifiant déterministe, identique à celui créé par la migration add_catalogs. */
export function defaultCatalogId(tenantId: string) {
  return `catalog_${tenantId}`;
}

/** Catalogue par défaut du tenant, créé au premier besoin (nouveaux tenants). */
export async function ensureDefaultCatalog(tenantId: string, db: CatalogDb = prisma) {
  const existing = await db.catalog.findFirst({ where: { tenantId, isDefault: true } });
  if (existing) return existing;
  return db.catalog.upsert({
    where: { id: defaultCatalogId(tenantId) },
    update: {},
    create: { id: defaultCatalogId(tenantId), tenantId, name: DEFAULT_CATALOG_NAME, isDefault: true },
  });
}

/**
 * Catalogue du tenant désigné par `catalogId` ; le catalogue par défaut si `catalogId` est absent
 * (compatibilité des API antérieures au multi-catalogue).
 */
export async function resolveCatalog(tenantId: string, catalogId: unknown, db: CatalogDb = prisma) {
  if (catalogId === undefined || catalogId === null || catalogId === "") return ensureDefaultCatalog(tenantId, db);
  if (typeof catalogId !== "string") throw new QuizError(400, "catalogId invalide");
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, tenantId } });
  if (!catalog) throw new QuizError(404, "Catalogue introuvable");
  return catalog;
}

/**
 * Réunion des axes des quiz d'un catalogue. Sert uniquement à l'édition et à l'import des produits
 * (validation des valeurs, suggestions de mapping, texte d'embedding). La recommandation utilise
 * toujours les axes du quiz sélectionné, jamais cette réunion.
 */
export async function catalogAxes(tenantId: string, catalogId: string): Promise<QuizAxis[]> {
  const quizzes = await prisma.quiz.findMany({
    where: { tenantId, catalogId },
    select: { axes: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  const byKey = new Map<string, QuizAxis>();
  for (const quiz of quizzes) {
    for (const axis of parseAxes(quiz.axes)) if (!byKey.has(axis.key)) byKey.set(axis.key, axis);
  }
  return [...byKey.values()];
}

/** Vérifie que tous les produits appartiennent au tenant et au catalogue, et renvoie la liste dédoublonnée. */
export async function validateCatalogProducts(
  tenantId: string,
  catalogId: string,
  productIds: string[] | undefined,
  db: CatalogDb = prisma,
) {
  if (productIds === undefined) return undefined;
  const uniqueProductIds = [...new Set(productIds)];
  if (uniqueProductIds.length === 0) return uniqueProductIds;
  const rows = await db.product.findMany({
    where: { tenantId, id: { in: uniqueProductIds } },
    select: { id: true, catalogId: true },
  });
  if (rows.length !== uniqueProductIds.length) {
    throw new QuizError(400, "Certains produits n'appartiennent pas à votre compte");
  }
  if (rows.some((row) => row.catalogId !== catalogId)) {
    throw new QuizError(400, "Certains produits n'appartiennent pas au catalogue de ce quiz");
  }
  return uniqueProductIds;
}

/**
 * Tenant réel du compte : le token peut porter un tenantId logique (super-admin)
 * ou celui d'un tenant supprimé ; on se rabat alors sur le tenant de même e-mail.
 */
export async function resolveAccountTenantId(req: AuthRequest): Promise<string | null> {
  const fromToken = await prisma.tenant.findUnique({ where: { id: req.tenant!.tenantId }, select: { id: true } });
  if (fromToken) return fromToken.id;
  const byEmail = await prisma.tenant.findUnique({
    where: { email: req.tenant!.email.toLowerCase().trim() },
    select: { id: true },
  });
  return byEmail?.id ?? null;
}

export function toCatalogRef(catalog: { id: string; name: string }): CatalogRef {
  return { id: catalog.id, name: catalog.name };
}

export function serializeCatalog(catalog: Prisma.CatalogGetPayload<object>): CatalogDto {
  return {
    id: catalog.id,
    tenantId: catalog.tenantId,
    name: catalog.name,
    description: catalog.description,
    isDefault: catalog.isDefault,
    createdAt: catalog.createdAt.toISOString(),
    updatedAt: catalog.updatedAt.toISOString(),
  };
}

/** Valide le corps d'un POST/PUT /api/catalogs. */
export function parseCatalogInput(raw: unknown, creating: boolean) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new QuizError(400, "Catalogue invalide");
  const body = raw as Record<string, unknown>;
  const data: { name?: string; description?: string | null } = {};

  if (creating || body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) throw new QuizError(400, "Le nom du catalogue est requis");
    if (body.name.trim().length > CATALOG_LIMITS.name) {
      throw new QuizError(400, `Le nom du catalogue doit faire ${CATALOG_LIMITS.name} caractères maximum`);
    }
    data.name = body.name.trim();
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      throw new QuizError(400, "La description doit être un texte");
    }
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (description.length > CATALOG_LIMITS.description) {
      throw new QuizError(400, `La description doit faire ${CATALOG_LIMITS.description} caractères maximum`);
    }
    data.description = description || null;
  }
  return data;
}
