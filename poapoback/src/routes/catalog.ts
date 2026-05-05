import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { verifyToken, AuthRequest } from "../middleware/auth";
import type { ProductCreateInput, ProductUpdateInput } from "@poapo/types";

const router = Router();
router.use(verifyToken);

// GET /api/catalog/products?page=1&pageSize=20&search=&active=
router.get("/products", async (req: AuthRequest, res: Response) => {
  const tenantId = req.tenant!.tenantId;
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
  const search = req.query.search as string | undefined;
  const activeFilter = req.query.active;

  const where = {
    tenantId,
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
        priceTier: true,
        imageUrl: true,
        olfactoryFamily: true,
        genderTarget: true,
        freshness: true,
        intensity: true,
        sweetness: true,
        active: true,
        featured: true,
        createdAt: true,
      },
    }),
    prisma.product.count({ where }),
  ]);

  res.json({ data, total, page, pageSize });
});

// GET /api/catalog/products/:id
router.get("/products/:id", async (req: AuthRequest, res: Response) => {
  const productId = String(req.params.id);
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId: req.tenant!.tenantId },
  });
  if (!product) {
    res.status(404).json({ error: "Produit introuvable" });
    return;
  }
  res.json(product);
});

// POST /api/catalog/products
router.post("/products", async (req: AuthRequest, res: Response) => {
  const body = req.body as ProductCreateInput;
  if (!body.name?.trim()) {
    res.status(400).json({ error: "Le champ 'name' est obligatoire" });
    return;
  }

  const product = await prisma.product.create({
    data: {
      tenantId: req.tenant!.tenantId,
      name: body.name.trim(),
      brand: body.brand ?? null,
      description: body.description ?? null,
      price: body.price ?? null,
      priceTier: body.priceTier ?? null,
      imageUrl: body.imageUrl ?? null,
      purchaseUrl: body.purchaseUrl ?? null,
      concentration: body.concentration ?? null,
      active: body.active ?? true,
      featured: body.featured ?? false,
      topNotes: body.topNotes ?? [],
      heartNotes: body.heartNotes ?? [],
      baseNotes: body.baseNotes ?? [],
      olfactoryFamily: body.olfactoryFamily ?? null,
      subFamily: body.subFamily ?? null,
      genderTarget: body.genderTarget ?? null,
      tags: body.tags ?? [],
      freshness: body.freshness ?? null,
      intensity: body.intensity ?? null,
      sweetness: body.sweetness ?? null,
      seasons: body.seasons ?? [],
      occasions: body.occasions ?? [],
      timeOfDay: body.timeOfDay ?? [],
    },
  });

  // Déclencher l'embedding en arrière-plan (non bloquant)
  triggerEmbedding(product.id, req.tenant!.tenantId).catch(console.error);

  res.status(201).json(product);
});

// PUT /api/catalog/products/:id
router.put("/products/:id", async (req: AuthRequest, res: Response) => {
  const productId = String(req.params.id);
  const existing = await prisma.product.findFirst({
    where: { id: productId, tenantId: req.tenant!.tenantId },
  });
  if (!existing) {
    res.status(404).json({ error: "Produit introuvable" });
    return;
  }

  const body = req.body as ProductUpdateInput;
  const updated = await prisma.product.update({
    where: { id: productId },
    data: {
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.brand !== undefined && { brand: body.brand }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.price !== undefined && { price: body.price }),
      ...(body.priceTier !== undefined && { priceTier: body.priceTier }),
      ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl }),
      ...(body.purchaseUrl !== undefined && { purchaseUrl: body.purchaseUrl }),
      ...(body.concentration !== undefined && { concentration: body.concentration }),
      ...(body.active !== undefined && { active: body.active }),
      ...(body.featured !== undefined && { featured: body.featured }),
      ...(body.topNotes !== undefined && { topNotes: body.topNotes }),
      ...(body.heartNotes !== undefined && { heartNotes: body.heartNotes }),
      ...(body.baseNotes !== undefined && { baseNotes: body.baseNotes }),
      ...(body.olfactoryFamily !== undefined && { olfactoryFamily: body.olfactoryFamily }),
      ...(body.subFamily !== undefined && { subFamily: body.subFamily }),
      ...(body.genderTarget !== undefined && { genderTarget: body.genderTarget }),
      ...(body.tags !== undefined && { tags: body.tags }),
      ...(body.freshness !== undefined && { freshness: body.freshness }),
      ...(body.intensity !== undefined && { intensity: body.intensity }),
      ...(body.sweetness !== undefined && { sweetness: body.sweetness }),
      ...(body.seasons !== undefined && { seasons: body.seasons }),
      ...(body.occasions !== undefined && { occasions: body.occasions }),
      ...(body.timeOfDay !== undefined && { timeOfDay: body.timeOfDay }),
    },
  });

  // Re-embed si les données olfactives ont changé
  const olfactoryChanged = [
    "name",
    "brand",
    "description",
    "olfactoryFamily",
    "subFamily",
    "topNotes",
    "heartNotes",
    "baseNotes",
    "tags",
    "freshness",
    "intensity",
    "sweetness",
  ].some((k) => k in body);

  if (olfactoryChanged) {
    triggerEmbedding(updated.id, req.tenant!.tenantId).catch(console.error);
  }

  res.json(updated);
});

// DELETE /api/catalog/products/:id
router.delete("/products/:id", async (req: AuthRequest, res: Response) => {
  const productId = String(req.params.id);
  const existing = await prisma.product.findFirst({
    where: { id: productId, tenantId: req.tenant!.tenantId },
  });
  if (!existing) {
    res.status(404).json({ error: "Produit introuvable" });
    return;
  }
  await prisma.product.delete({ where: { id: productId } });
  res.json({ ok: true });
});

// ─── AI embedding (fire & forget) ────────────────────────────────────────────
async function triggerEmbedding(productId: string, tenantId: string): Promise<void> {
  const aiUrl = process.env.AI_SERVICE_URL;
  if (!aiUrl) return;

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return;

  const response = await fetch(`${aiUrl}/embed/product`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: product.id,
      name: product.name,
      brand: product.brand,
      description: product.description,
      olfactoryFamily: product.olfactoryFamily,
      subFamily: product.subFamily,
      topNotes: product.topNotes,
      heartNotes: product.heartNotes,
      baseNotes: product.baseNotes,
      tags: product.tags,
      freshness: product.freshness,
      intensity: product.intensity,
      sweetness: product.sweetness,
    }),
  });

  if (response.ok) {
    const { embedding } = (await response.json()) as { embedding: number[] };
    await prisma.product.update({
      where: { id: productId },
      data: { embedding },
    });
  }
}

export default router;
