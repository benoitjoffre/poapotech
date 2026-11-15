/**
 * Mesure sur le VRAI moteur (service Python local + vrai modèle d'embeddings + PostgreSQL), sans simulation :
 *  - comparabilité des scores entre deux appels /recommend portant sur des ensembles de produits différents ;
 *  - latence des appels : historique (un appel), contraintes strictes (un appel filtré), préférences souples (deux appels en parallèle).
 * Crée un tenant isolé (supprimé à la fin). Lancer : node --import tsx tests/tools/realEngineLatency.ts [taille du catalogue]
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { QuizAxis } from "@poapo/types";
import { prisma } from "../../src/lib/prisma";
import { embeddingSummary, runEmbeddingBatch } from "../../src/services/embeddings";
import { fetchRecommend, recommendQuiz } from "../../src/services/quizRecommendations";
import { recommendQuizWithEffects } from "../../src/services/effectsRecommendation";
import { parseAnswerEffects } from "../../src/services/answerEffects";
import { computeProfile } from "../../src/services/scoring";
import { perfumeSeeded } from "../fixtures/selectionFixtures";

const size = Number(process.argv[2] ?? 60);
const trials = Number(process.argv[3] ?? 25);
const axes: QuizAxis[] = ["freshness", "woody", "sweetness", "intensity"].map((key) => ({ key, label: key, lowLabel: null, highLabel: null }));
const stats = (values: number[]) => { const s = [...values].sort((a, b) => a - b); const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return `médiane ${q(0.5).toFixed(0)} ms · p90 ${q(0.9).toFixed(0)} ms · max ${s[s.length - 1].toFixed(0)} ms`; };
const fx = (...effects: unknown[]) => { const p = parseAnswerEffects({ v: 1, effects }); if (!p.ok) throw new Error(p.errors.join()); return p.value; };

(async () => {
  const tenantId = `latency-${randomUUID()}`;
  try {
    await prisma.tenant.create({ data: { id: tenantId, email: `${tenantId}@example.test`, industry: "Parfumerie" } });
    const catalog = await prisma.catalog.create({ data: { tenantId, name: "Mesure", isDefault: true } });
    await prisma.product.createMany({ data: perfumeSeeded(size, 9).map((p) => ({
      tenantId, catalogId: catalog.id, name: `Parfum ${(p.attributes as Record<string, unknown>).famille} ${p.id}`, brand: p.brand ?? null, price: p.price ?? null, tags: [...(p.tags ?? [])], attributes: p.attributes as object,
    })) });
    const started = performance.now();
    while ((await embeddingSummary(tenantId)).ready < size) {
      if ((await runEmbeddingBatch()) === 0) await new Promise((r) => setTimeout(r, 500));
      if (performance.now() - started > 600000) throw new Error("embeddings non prêts");
    }
    console.log(`catalogue de ${size} produits : embeddings réels prêts en ${((performance.now() - started) / 1000).toFixed(1)} s`);
    const products = await prisma.product.findMany({ where: { tenantId }, select: { id: true, price: true, attributes: true } });
    const prices = products.map((p) => p.price!).sort((a, b) => a - b);
    const cap = prices[Math.floor(prices.length * 0.4)];
    const profile = (v: number) => computeProfile(axes, [{ freshness: v % 2 ? 0.25 : -0.25, woody: v % 3 ? 0.25 : -0.25 }]);
    const base = { tenantId, catalogId: catalog.id, industry: "Parfumerie", axes };

    // 1. Comparabilité : même profil, ensembles différents → mêmes scores pour les produits communs.
    let compared = 0, maxDiff = 0;
    for (let v = 0; v < 10; v++) {
      const full = await fetchRecommend({ ...base, profile: profile(v), topN: 10 });
      const half = products.filter((_, i) => i % 2 === 0).map((p) => p.id);
      const part = await fetchRecommend({ ...base, profile: profile(v), productIds: half, topN: 10 });
      const known = new Map(full.topN.map((t) => [t.id, t.score]));
      for (const item of part.topN) if (known.has(item.id)) { compared++; maxDiff = Math.max(maxDiff, Math.abs(known.get(item.id)! - item.score)); }
      // Et sur un même produit retrouvé dans un troisième ensemble réduit.
      const solo = await fetchRecommend({ ...base, profile: profile(v), productIds: [full.topN[0].id], topN: 1 });
      compared++; maxDiff = Math.max(maxDiff, Math.abs(solo.topN[0].score - full.topN[0].score));
    }
    console.log(`comparabilité des scores (vrai moteur) : ${compared} produits comparés entre appels, écart maximal ${maxDiff}`);

    // 2. Latences.
    const timed = async (fn: () => Promise<unknown>) => { const t = performance.now(); await fn(); return performance.now() - t; };
    const legacy: number[] = [], strict: number[] = [], soft: number[] = [], softFirst: number[] = [], softSecond: number[] = [];
    let degraded = 0, noMatch = 0;
    await recommendQuiz({ ...base, impacts: [{ freshness: 0.25 }] }); // préchauffage
    for (let v = 0; v < trials; v++) {
      const impacts = [{ freshness: v % 2 ? 0.25 : -0.25, woody: v % 3 ? 0.25 : -0.25 }];
      legacy.push(await timed(() => recommendQuiz({ ...base, impacts })));
      strict.push(await timed(() => recommendQuizWithEffects({ ...base, answers: [{ questionId: "q0", impacts: impacts[0], effects: null }, { questionId: "q1", impacts: {}, effects: fx({ type: "range", criterion: "price", mode: "strict", max: cap }) }] })));
      const family = ["Frais", "Floral", "Boisé", "Oriental", "Gourmand", "Fougère"][v % 6];
      let diag;
      soft.push(await timed(async () => {
        const r = await recommendQuizWithEffects({ ...base, answers: [{ questionId: "q0", impacts: impacts[0], effects: null }, { questionId: "q1", impacts: {}, effects: fx({ type: "category", criterion: "attribute.famille", mode: "soft", values: [family] }) }] });
        diag = r.diagnostics;
      }));
      const d = diag as unknown as { degraded: string[]; firstCall: { ms: number }; secondCall: { ms: number } | { skipped: true } } | undefined;
      if (d) { degraded += d.degraded.length; softFirst.push(d.firstCall.ms); if ("ms" in d.secondCall) softSecond.push(d.secondCall.ms); }
    }
    console.log(`latences sur ${size} produits, ${trials} essais :`);
    console.log(`  historique (1 appel, topN 1)                    : ${stats(legacy)}`);
    console.log(`  plafond strict (1 appel filtré)                 : ${stats(strict)}`);
    console.log(`  préférence souple (2 appels en parallèle) total : ${stats(soft)}`);
    console.log(`    dont premier appel (tous candidats)           : ${stats(softFirst)}`);
    console.log(`    dont second appel (produits exacts)           : ${stats(softSecond)}`);
    console.log(`  dégradations signalées (appel en échec / scores incomparables) : ${degraded}`);
    void noMatch;
  } finally {
    await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
