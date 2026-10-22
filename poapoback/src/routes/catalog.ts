import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { verifyToken, AuthRequest } from "../middleware/auth";
import type { ProductCreateInput, ProductUpdateInput } from "@poapo/types";
import { invalidAxisValue, isProductAttributes } from "../services/axes";
import { catalogAxes, resolveAccountTenantId, resolveCatalog } from "../services/catalogs";
import { asyncRoute, QuizError } from "../services/quizzes";
import { triggerEmbedding } from "../services/embeddings";

const router = Router();
router.use(verifyToken);

/** Vérifie la forme des attributs et que les valeurs des axes du catalogue restent entre 0 et 1. */
async function attributesError(tenantId: string, catalogId: string, attributes: unknown): Promise<string | null> {
  if (attributes === undefined) return null;
  if (!isProductAttributes(attributes)) return "Le champ 'attributes' doit être un objet JSON";
  const axes = await catalogAxes(tenantId, catalogId);
  const invalid = invalidAxisValue(attributes, axes.map((axis) => axis.key));
  return invalid ? `L'axe « ${invalid} » doit être un nombre entre 0 et 1` : null;
}

async function resolveTenantId(req: AuthRequest): Promise<string> {
  const tenantId = await resolveAccountTenantId(req);
  if (!tenantId) throw new QuizError(400, "Aucun tenant valide associé à ce compte");
  return tenantId;
}

// GET /api/catalog/products?page=1&pageSize=20&search=&active=&catalogId=
// Sans catalogId : tous les produits du tenant (comportement historique).
router.get("/products", asyncRoute(async (req: AuthRequest, res: Response) => {
  const tenantId = await resolveTenantId(req);
  const catalogId = req.query.catalogId;
  if (catalogId !== undefined && (typeof catalogId !== "string" || !catalogId)) {
    throw new QuizError(400, "catalogId invalide");
  }
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
  const search = req.query.search as string | undefined;
  const activeFilter = req.query.active;

  const where = {
    tenantId,
    ...(catalogId && { catalogId }),
    ...(activeFilter !== undefined ? { active: activeFilter === "true" } : {}),
    ...(search
      ? {
          OR: [{ name: { contains: search, mode: "insensitive" as const } }, { brand: { contains: search, mode: "insensitive" as const } }],
        }
      : {}),
  };

  const [data, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        brand: true,
        price: true,
        imageUrl: true,
        tags: true,
        attributes: true,
        active: true,
        featured: true,
        createdAt: true,
        catalogId: true,
        catalog: { select: { id: true, name: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  res.json({ data, total, page, pageSize });
}));

// GET /api/catalog/products/:id
router.get("/products/:id", asyncRoute(async (req: AuthRequest, res: Response) => {
  const tenantId = await resolveTenantId(req);
  const productId = String(req.params.id);
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
  });
  if (!product) {
    res.status(404).json({ error: "Produit introuvable" });
    return;
  }
  res.json(product);
}));

// POST /api/catalog/products
router.post("/products", asyncRoute(async (req: AuthRequest, res: Response) => {
  const tenantId = await resolveTenantId(req);
  const body = req.body as ProductCreateInput;
  if (!body.name?.trim()) {
    res.status(400).json({ error: "Le champ 'name' est obligatoire" });
    return;
  }
  const catalog = await resolveCatalog(tenantId, body.catalogId);
  const createError = await attributesError(tenantId, catalog.id, body.attributes);
  if (createError) {
    res.status(400).json({ error: createError });
    return;
  }

  const product = await prisma.product.create({
    data: {
      tenantId,
      catalogId: catalog.id,
      name: body.name.trim(),
      brand: body.brand ?? null,
      description: body.description ?? null,
      price: body.price ?? null,
      imageUrl: body.imageUrl ?? null,
      purchaseUrl: body.purchaseUrl ?? null,
      active: body.active ?? true,
      featured: body.featured ?? false,
      tags: body.tags ?? [],
      attributes: body.attributes ?? {},
    },
  });

  // Déclencher l'embedding en arrière-plan (non bloquant)
  triggerEmbedding(product.id, tenantId).catch(console.error);

  res.status(201).json(product);
}));

// PUT /api/catalog/products/:id
router.put("/products/:id", asyncRoute(async (req: AuthRequest, res: Response) => {
  const tenantId = await resolveTenantId(req);
  const productId = String(req.params.id);
  const existing = await prisma.product.findFirst({
    where: { id: productId, tenantId },
  });
  if (!existing) {
    res.status(404).json({ error: "Produit introuvable" });
    return;
  }

  const body = req.body as ProductUpdateInput;
  const catalogId = body.catalogId === undefined ? existing.catalogId : (await resolveCatalog(tenantId, body.catalogId)).id;
  const catalogChanged = catalogId !== existing.catalogId;
  if (catalogChanged) {
    const selections = await prisma.quizProduct.count({ where: { productId } });
    if (selections > 0) {
      throw new QuizError(
        409,
        `Ce produit est sélectionné dans ${selections} quiz de son catalogue actuel : retirez-le de ces sélections avant de le déplacer`,
      );
    }
  }
  const updateError = await attributesError(tenantId, catalogId, body.attributes);
  if (updateError) {
    res.status(400).json({ error: updateError });
    return;
  }
  const updated = await prisma.product.update({
    where: { id: productId },
    data: {
      ...(catalogChanged && { catalogId }),
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.brand !== undefined && { brand: body.brand }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.price !== undefined && { price: body.price }),
      ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl }),
      ...(body.purchaseUrl !== undefined && { purchaseUrl: body.purchaseUrl }),
      ...(body.active !== undefined && { active: body.active }),
      ...(body.featured !== undefined && { featured: body.featured }),
      ...(body.tags !== undefined && { tags: body.tags }),
      ...(body.attributes !== undefined && { attributes: body.attributes }),
    },
  });

  // Re-embed si le contenu décrivant le produit a changé
  // Les axes du nouveau catalogue entrent dans le texte d'embedding.
  const descriptionChanged = catalogChanged || ["name", "brand", "description", "tags", "attributes"].some((k) => k in body);
  if (descriptionChanged) {
    triggerEmbedding(updated.id, tenantId).catch(console.error);
  }

  res.json(updated);
}));

// DELETE /api/catalog/products/:id
router.delete("/products/:id", asyncRoute(async (req: AuthRequest, res: Response) => {
  const tenantId = await resolveTenantId(req);
  const productId = String(req.params.id);
  const existing = await prisma.product.findFirst({
    where: { id: productId, tenantId },
  });
  if (!existing) {
    res.status(404).json({ error: "Produit introuvable" });
    return;
  }
  await prisma.product.delete({ where: { id: productId } });
  res.json({ ok: true });
}));

export default router;
