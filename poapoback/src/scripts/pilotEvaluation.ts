/**
 * Prépare l'évaluation à l'aveugle d'un catalogue réel (lecture seule : aucune écriture en base, aucune publication).
 * Usage : npx tsx src/scripts/pilotEvaluation.ts --tenant <id> --catalog <id> [--visitors 30] [--seed 1] [--out ./pilot-evaluation] [--strict-budget]
 * Exige le service Python (AI_SERVICE_URL) et des produits aux embeddings prêts. À n'utiliser qu'avec l'accord du commerçant.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/prisma";
import { loadExpressContext } from "../services/expressQuiz";
import { automaticMetrics, blindSheet, runPilotEvaluation } from "../services/pilotEvaluation";

const arg = (name: string, fallback?: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };

(async () => {
  const tenantId = arg("tenant"), catalogId = arg("catalog");
  if (!tenantId || !catalogId) throw new Error("--tenant et --catalog sont requis");
  const out = arg("out", "./pilot-evaluation")!;
  mkdirSync(out, { recursive: true });
  const context = await loadExpressContext(tenantId, catalogId);
  const evaluation = await runPilotEvaluation(context, tenantId, { visitors: Number(arg("visitors", "30")), seed: Number(arg("seed", "1")), strictBudget: process.argv.includes("--strict-budget") });
  const { csv, key } = blindSheet(evaluation, Number(arg("seed", "1")) + 6);
  writeFileSync(join(out, "feuille-evaluation-aveugle.csv"), csv);
  writeFileSync(join(out, "cle-des-variantes.json"), JSON.stringify(key, null, 1));
  writeFileSync(join(out, "questions-generees.json"), JSON.stringify(evaluation.questions, null, 1));
  writeFileSync(join(out, "metriques-automatiques.json"), JSON.stringify(automaticMetrics(evaluation), null, 1));
  console.log(`Évaluation préparée dans ${out} (${evaluation.scenarios.length} visiteurs). La clé des variantes ne doit être ouverte qu'après les jugements.`);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
