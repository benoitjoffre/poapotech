/** Essai à blanc du protocole d'évaluation sur un catalogue SYNTHÉTIQUE (tenant isolé supprimé ensuite, vrai moteur Python). Usage : node --import tsx tests/tools/pilotDryRun.ts <dossier de sortie> */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../../src/lib/prisma";
import { embeddingSummary, runEmbeddingBatch } from "../../src/services/embeddings";
import { loadExpressContext } from "../../src/services/expressQuiz";
import { automaticMetrics, blindSheet, runPilotEvaluation } from "../../src/services/pilotEvaluation";
import { perfumeSeeded } from "../fixtures/selectionFixtures";
(async () => {
  const tenantId = `pilotdry-${randomUUID()}`;
  try {
    await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test`, industry: "Parfumerie" } });
    const catalog = await prisma.catalog.create({ data: { tenantId, name: "Essai", isDefault: true } });
    const size = 120;
    await prisma.product.createMany({ data: perfumeSeeded(size, 3).map((p) => ({ tenantId, catalogId: catalog.id, name: `Parfum ${(p.attributes as any).famille} ${p.id}`, brand: p.brand ?? null, price: p.price ?? null, tags: [...(p.tags ?? [])], attributes: p.attributes as object })) });
    while ((await embeddingSummary(tenantId)).ready < size) { if ((await runEmbeddingBatch()) === 0) await new Promise((r) => setTimeout(r, 500)); }
    const context = await loadExpressContext(tenantId, catalog.id);
    const evaluation = await runPilotEvaluation(context, tenantId, { visitors: 30, seed: 1 });
    const { csv, key } = blindSheet(evaluation, 7);
    const out = process.argv[2]; mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/feuille.csv`, csv); writeFileSync(`${out}/cle.json`, JSON.stringify(key, null, 1));
    console.log(JSON.stringify(automaticMetrics(evaluation), null, 1));
    console.log(csv.split("\n").slice(0, 4).join("\n"));
    console.log("fiche exemple:", evaluation.scenarios[2].brief);
  } finally { await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined); await prisma.$disconnect(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
