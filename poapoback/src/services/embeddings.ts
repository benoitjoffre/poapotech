import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { catalogAxes } from "./catalogs";
import { AiServiceError, callAiService } from "./aiClient";

/**
 * File d'embeddings persistée sur Product (embeddingStatus) : PENDING → PROCESSING → READY | FAILED.
 * Un produit n'est « prêt » que lorsque son embedding correspond à son contenu actuel.
 * Les écritures marquent seulement les produits ; le worker les traite (reprise après redémarrage,
 * bail contre les traitements concurrents, relances espacées, échec définitif visible).
 */
export const MAX_EMBEDDING_ATTEMPTS = 5;
const LEASE_MS = 2 * 60_000;
const BATCH_SIZE = 10;
const EMBED_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 3_000;
const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];

export interface EmbeddingSummary {
  total: number;
  ready: number;
  pending: number;
  processing: number;
  failed: number;
  lastError: string | null;
}

export function embeddingBackoffMs(attempts: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];
}

/** Marque des produits du tenant comme à recalculer (contenu modifié). Les traitements en cours sont invalidés par la version. */
export async function enqueueEmbeddings(productIds: string[], tenantId: string): Promise<void> {
  if (productIds.length === 0) return;
  const scope = { tenantId, id: { in: productIds } };
  await prisma.product.updateMany({
    where: { ...scope, embeddingStatus: { not: "PROCESSING" } },
    data: {
      embeddingStatus: "PENDING", embeddingVersion: { increment: 1 }, embeddingAttempts: 0,
      embeddingError: null, embeddingNextAttemptAt: null, embeddingLockedUntil: null,
    },
  });
  // Déjà en cours : on invalide seulement le résultat ; le worker remettra le produit en file à la fin.
  await prisma.product.updateMany({
    where: { ...scope, embeddingStatus: "PROCESSING" },
    data: { embeddingVersion: { increment: 1 } },
  });
  kickEmbeddingWorker();
}

/** Remet en file les produits en échec (et avance les relances en attente) du tenant, éventuellement d'un catalogue. */
export async function retryEmbeddings(tenantId: string, catalogId?: string): Promise<number> {
  const { count } = await prisma.product.updateMany({
    where: { tenantId, ...(catalogId && { catalogId }), embeddingStatus: { in: ["FAILED", "PENDING"] } },
    data: { embeddingStatus: "PENDING", embeddingAttempts: 0, embeddingError: null, embeddingNextAttemptAt: null },
  });
  kickEmbeddingWorker();
  return count;
}

export async function embeddingSummary(tenantId: string, catalogId?: string): Promise<EmbeddingSummary> {
  const where = { tenantId, ...(catalogId && { catalogId }) };
  const groups = await prisma.product.groupBy({ by: ["embeddingStatus"], where, _count: { _all: true } });
  const count = (status: string) => groups.find((g) => g.embeddingStatus === status)?._count._all ?? 0;
  const failed = count("FAILED");
  const last = failed
    ? await prisma.product.findFirst({ where: { ...where, embeddingStatus: "FAILED" }, orderBy: { updatedAt: "desc" }, select: { embeddingError: true } })
    : null;
  return {
    total: groups.reduce((sum, g) => sum + g._count._all, 0),
    ready: count("READY"), pending: count("PENDING"), processing: count("PROCESSING"), failed,
    lastError: last?.embeddingError ?? null,
  };
}

/** Le moteur Python est-il prêt (modèle chargé) ? Sans lui, on ne consomme aucune tentative. */
export async function aiEngineStatus(): Promise<"ready" | "unavailable" | "not_configured"> {
  const aiUrl = process.env.AI_SERVICE_URL;
  if (!aiUrl) return "not_configured";
  try {
    const response = await fetch(`${aiUrl}/ready`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return response.ok ? "ready" : "unavailable";
  } catch {
    return "unavailable";
  }
}

interface Claimed { id: string; tenantId: string; embeddingVersion: number; embeddingAttempts: number }

/** Réclame un lot de façon atomique (SKIP LOCKED) : deux workers ne prennent jamais le même produit. */
async function claimBatch(limit: number): Promise<Claimed[]> {
  // Baux expirés ayant épuisé leurs tentatives : échec définitif plutôt que boucle infinie.
  await prisma.$executeRaw`
    UPDATE "Product" SET "embeddingStatus" = 'FAILED', "embeddingLockedUntil" = NULL,
      "embeddingError" = 'Traitement interrompu à répétition'
    WHERE "embeddingStatus" = 'PROCESSING' AND "embeddingLockedUntil" < now() AND "embeddingAttempts" >= ${MAX_EMBEDDING_ATTEMPTS}`;
  return prisma.$queryRaw<Claimed[]>`
    UPDATE "Product" SET "embeddingStatus" = 'PROCESSING', "embeddingAttempts" = "embeddingAttempts" + 1,
      "embeddingLockedUntil" = now() + (${LEASE_MS} * interval '1 millisecond')
    WHERE id IN (
      SELECT id FROM "Product"
      WHERE ("embeddingStatus" = 'PENDING' AND ("embeddingNextAttemptAt" IS NULL OR "embeddingNextAttemptAt" <= now()))
         OR ("embeddingStatus" = 'PROCESSING' AND "embeddingLockedUntil" < now())
      ORDER BY "updatedAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id, "tenantId", "embeddingVersion", "embeddingAttempts"`;
}

async function processOne(item: Claimed): Promise<void> {
  const owned = { id: item.id, embeddingStatus: "PROCESSING" as const, embeddingVersion: item.embeddingVersion };
  try {
    const product = await prisma.product.findFirst({ where: { id: item.id, tenantId: item.tenantId } });
    if (!product) return;
    const { embedding } = await callAiService<{ embedding: number[] }>("/embed/product", {
      id: product.id, name: product.name, brand: product.brand, description: product.description,
      tags: product.tags, attributes: product.attributes,
      axes: await catalogAxes(item.tenantId, product.catalogId),
    }, EMBED_TIMEOUT_MS);
    if (!Array.isArray(embedding) || embedding.length === 0) throw new AiServiceError("invalid_output", "Embedding vide");
    const done = await prisma.product.updateMany({
      where: owned,
      data: {
        embedding, embeddingStatus: "READY", embeddingAttempts: 0, embeddingError: null,
        embeddingNextAttemptAt: null, embeddingLockedUntil: null, embeddingUpdatedAt: new Date(),
      },
    });
    if (done.count === 0) await requeueIfStale(item);
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    const final = item.embeddingAttempts >= MAX_EMBEDDING_ATTEMPTS;
    const failed = await prisma.product.updateMany({
      where: owned,
      data: final
        ? { embeddingStatus: "FAILED", embeddingError: message, embeddingLockedUntil: null }
        : { embeddingStatus: "PENDING", embeddingError: message, embeddingLockedUntil: null,
            embeddingNextAttemptAt: new Date(Date.now() + embeddingBackoffMs(item.embeddingAttempts)) },
    });
    if (failed.count === 0) await requeueIfStale(item);
    console.error(`[embedding] ${item.id}: ${message}`);
  }
}

/** Le contenu a changé pendant le calcul : le résultat est écarté et le produit repart en file. */
async function requeueIfStale(item: Claimed): Promise<void> {
  await prisma.product.updateMany({
    where: { id: item.id, embeddingStatus: "PROCESSING", embeddingVersion: { not: item.embeddingVersion } },
    data: { embeddingStatus: "PENDING", embeddingAttempts: 0, embeddingNextAttemptAt: null, embeddingLockedUntil: null },
  });
}

let running = false;

/** Traite un lot. Retourne le nombre de produits réclamés (0 : rien à faire ou moteur indisponible). */
export async function runEmbeddingBatch(limit = BATCH_SIZE): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    if ((await aiEngineStatus()) !== "ready") return 0;
    const batch = await claimBatch(limit);
    for (const item of batch) await processOne(item); // un par un : on ne sature pas le service IA
    return batch.length;
  } catch (err) {
    console.error("[embedding] worker", err instanceof Prisma.PrismaClientKnownRequestError ? err.code : err);
    return 0;
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;

export function kickEmbeddingWorker(): void {
  if (!timer) return; // worker non démarré (tests, scripts) : la file reste en base
  void drain();
}

async function drain(): Promise<void> {
  while ((await runEmbeddingBatch()) > 0);
}

export function startEmbeddingWorker(intervalMs = Number(process.env.EMBEDDING_WORKER_INTERVAL_MS ?? 5000)): void {
  if (timer || process.env.EMBEDDING_WORKER === "off") return;
  timer = setInterval(() => void drain(), intervalMs);
  timer.unref();
  void drain();
}

export function stopEmbeddingWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
