import { prisma } from "../lib/prisma";

/**
 * Rétention de RecommendationRequest (clés d'idempotence + réponse rejouable) : 30 jours.
 * Fenêtre d'idempotence garantie = 30 jours ; au-delà, une même clé serait traitée comme une nouvelle soumission.
 * Ne touche ni QuizSession ni UsageCounter (consommation mensuelle conservée), et ne supprime que des lignes
 * vieilles de 30 jours : une transaction en cours (quelques secondes) ne peut pas être concernée.
 */
export const RECOMMENDATION_REQUEST_RETENTION_DAYS = 30;
const BATCH = 1000;

export async function purgeRecommendationRequests(now = new Date(), days = RECOMMENDATION_REQUEST_RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 864e5);
  let total = 0;
  for (;;) {
    // Par lots, pour ne pas garder de long verrou ; SKIP LOCKED ignore toute ligne encore utilisée par une transaction.
    const deleted = await prisma.$executeRaw`
      DELETE FROM "RecommendationRequest" WHERE "id" IN (
        SELECT "id" FROM "RecommendationRequest" WHERE "createdAt" < ${cutoff} ORDER BY "createdAt" LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)`;
    total += deleted;
    if (deleted < BATCH) return total;
  }
}

let timer: NodeJS.Timeout | undefined;
/** Purge 60 s après le démarrage puis toutes les 24 h (désactivable : POAPO_RETENTION_JOB=off). Idempotent ; plusieurs instances sont sans risque. */
export function startRetentionJob(intervalMs = 24 * 3600_000, startDelayMs = 60_000): void {
  if (timer || process.env.POAPO_RETENTION_JOB === "off") return;
  const run = () => purgeRecommendationRequests().then(
    (n) => { if (n) console.log(`[retention] ${n} demande(s) de recommandation purgée(s)`); },
    (err) => console.error("[retention] purge échouée", err),
  );
  // Premier passage différé : ne pas concurrencer le démarrage à froid (réveil Render) ni les premières requêtes.
  setTimeout(() => void run(), startDelayMs).unref();
  timer = setInterval(() => void run(), intervalMs);
  timer.unref();
}
