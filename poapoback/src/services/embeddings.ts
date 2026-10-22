import { prisma } from "../lib/prisma";
import { catalogAxes } from "./catalogs";

/**
 * Recalcule l'embedding d'un produit via poapoai (texte sémantique incluant les axes de son catalogue).
 * Appelé en arrière-plan après une écriture : sans AI_SERVICE_URL ou en cas d'échec, l'ancien embedding reste.
 */
export async function triggerEmbedding(productId: string, tenantId: string): Promise<void> {
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
      tags: product.tags,
      attributes: product.attributes,
      axes: await catalogAxes(tenantId, product.catalogId),
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

/** Recalcule les embeddings l'un après l'autre, pour ne pas saturer le service IA après une écriture groupée. */
export function triggerEmbeddings(productIds: string[], tenantId: string): Promise<void> {
  return productIds.reduce<Promise<void>>(
    (chain, productId) => chain.then(() => triggerEmbedding(productId, tenantId).catch((err) => console.error("[embedding]", err))),
    Promise.resolve(),
  );
}
