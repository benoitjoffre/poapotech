// Exécution manuelle ou cron externe : npm run retention:purge
import { prisma } from "../lib/prisma";
import { purgeRecommendationRequests } from "../services/recommendationRetention";

purgeRecommendationRequests()
  .then((n) => console.log(`${n} demande(s) purgée(s)`))
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
