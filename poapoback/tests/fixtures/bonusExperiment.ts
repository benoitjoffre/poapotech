/**
 * Expérience du lot 10D-2B.2 : stabilité du bonus de préférence (Parfum, Café, Mode ; 1, 2 et 3 préférences).
 * Deux sources de scores, à ne jamais confondre :
 *  - "simulé" : 0,6 × sémantique simulée (bruit reproductible) + 0,4 × axes ;
 *  - "réel"   : scores calculés par le code de poapoai/main.py (modèle d'embeddings réel, product_to_text, profile_to_text,
 *               cosine_similarity, generic_attribute_score) sur les produits des fixtures — SANS base de données ni service HTTP
 *               (voir poapoai/tools/score_fixtures.py). Ce n'est pas un test de production : les produits sont synthétiques.
 */
import { performance } from "node:perf_hooks";
import { parseAnswerEffects } from "../../src/services/answerEffects";
import { planCandidateSets, type RetrievalStrategy } from "../../src/services/candidateRetrieval";
import { quantile } from "../../src/services/catalogProfile";
import { rerankSoft, softDegrees, type BonusModel, type EffectProduct, type SelectedAnswer } from "../../src/services/effectsEngine";
import { computeProfile } from "../../src/services/scoring";
import { axialScore, semantic } from "./fakeEngine";
import { coffeeSeeded, fashionSeeded, perfumeSeeded, rng } from "./selectionFixtures";

export interface SectorConfig { name: string; industry: string; axes: string[]; cats: [string, string]; build: (size: number) => EffectProduct[] }
export const SECTOR_CONFIGS: SectorConfig[] = [
  { name: "Parfum", industry: "Parfum", axes: ["freshness", "woody", "sweetness", "intensity"], cats: ["famille", "genre"], build: (n) => perfumeSeeded(n, 77) as EffectProduct[] },
  { name: "Café", industry: "Café", axes: ["acidity", "intensity"], cats: ["origine", "torrefaction"], build: (n) => coffeeSeeded(n, 78) as EffectProduct[] },
  { name: "Mode", industry: "Mode", axes: ["confort"], cats: ["categorie", "couleur"], build: (n) => fashionSeeded(n, 79) as EffectProduct[] },
];
export const PREF_SCENARIOS = ["1_pref", "2_prefs", "3_prefs", "2_contradictoires"] as const;
export type PrefScenario = typeof PREF_SCENARIOS[number];

const attr = (p: EffectProduct, k: string) => (p.attributes as Record<string, unknown>)[k];
const fx = (effect: unknown): SelectedAnswer["effects"] => {
  const parsed = parseAnswerEffects({ v: 1, effects: [effect] });
  if (!parsed.ok) throw new Error(parsed.errors.join(";"));
  return parsed.value;
};
const cat = (name: string, value: string) => ({ type: "category", criterion: `attribute.${name}`, mode: "soft", values: [value] });

export interface Visitor { profile: Record<string, number>; answers: SelectedAnswer[]; accepts: (p: EffectProduct) => boolean; label: string }

/** Profils (indépendants du scénario) : même tirage pour toutes les expériences d'un secteur et d'une taille. */
export function buildProfiles(sector: SectorConfig, count = 60): Record<string, number>[] {
  const r = rng(5);
  return Array.from({ length: count }, () => {
    const impacts = sector.axes.flatMap((a) => (r() < 0.6 ? [{ [a]: r() < 0.5 ? -0.25 : 0.25 }] : []));
    return computeProfile(sector.axes.map((key) => ({ key, label: key })), impacts);
  });
}

export function buildVisitors(sector: SectorConfig, products: EffectProduct[], scenario: PrefScenario, count = 60): Visitor[] {
  const r = rng(11);
  const values = (name: string) => {
    const counts = new Map<string, number>();
    products.forEach((p) => counts.set(String(attr(p, name)), (counts.get(String(attr(p, name))) ?? 0) + 1));
    return [...counts.entries()].filter(([, c]) => c >= 2).map(([v]) => v).sort();
  };
  const [c1, c2] = sector.cats;
  const v1 = values(c1), v2 = values(c2);
  const prices = products.map((p) => p.price!).sort((a, b) => a - b);
  const band = { min: quantile(prices, 0.2), max: quantile(prices, 0.6) };
  const bandEffect = { type: "range", criterion: "price", mode: "soft", min: band.min, max: band.max };
  const inBand = (p: EffectProduct) => p.price! >= band.min && p.price! <= band.max;
  return buildProfiles(sector, count).map((profile) => {
    const A = v1[Math.floor(r() * v1.length)];
    const B = v1[(v1.indexOf(A) + 1 + Math.floor(r() * (v1.length - 1))) % v1.length];
    const G = v2[Math.floor(r() * v2.length)];
    const ans = (...e: unknown[]): SelectedAnswer[] => e.map((x, i) => ({ questionId: `q${i}`, effects: fx(x) }));
    switch (scenario) {
      case "1_pref": return { profile, answers: ans(cat(c1, A)), accepts: (p) => attr(p, c1) === A, label: `${c1} ${A}` };
      case "2_prefs": return { profile, answers: ans(cat(c1, A), bandEffect), accepts: (p) => attr(p, c1) === A && inBand(p), label: `${c1} ${A} + prix` };
      case "3_prefs": return { profile, answers: ans(cat(c1, A), cat(c2, G), bandEffect), accepts: (p) => attr(p, c1) === A && attr(p, c2) === G && inBand(p), label: `${c1} ${A} + ${c2} ${G} + prix` };
      case "2_contradictoires": return { profile, answers: ans(cat(c1, A), cat(c1, B)), accepts: (p) => [A, B].includes(String(attr(p, c1))), label: `${c1} ${A} ou ${B}` };
    }
  });
}

/** Source de scores : (indice visiteur, produit) → score du moteur. */
export interface ScoreSource { name: string; score: (visitor: number, product: EffectProduct) => number }
export const simulatedScores = (sector: SectorConfig, profiles: Record<string, number>[], sigma = 0.05): ScoreSource => ({
  name: "simulé", score: (v, p) => 0.6 * semantic(p.id, sigma) + 0.4 * axialScore(profiles[v], p.attributes),
});
export const tableScores = (table: number[][], products: EffectProduct[]): ScoreSource => {
  const index = new Map(products.map((p, i) => [p.id, i]));
  return { name: "réel", score: (v, p) => table[v][index.get(p.id)!] };
};

export type BonusSpec = { label: string; model: BonusModel | null };
export interface Row {
  sector: string; size: number; scenario: string; source: string; method: string; strategy: string; visitors: number;
  top1: number; top3: number; top1Changed: number; top3Changed: number; engineLoss: number; engineRankMedian: number; axisPct: number; prefSat: number; missing: number; coverage: number; nodeMs: number;
}

/** `reference` d'un bonus ancré = écart des scores du PREMIER appel (général) : identique quelle que soit la stratégie de récupération. */
export function evaluate(
  sector: SectorConfig, size: number, scenario: PrefScenario, source: (profiles: Record<string, number>[], products: EffectProduct[]) => ScoreSource,
  spec: BonusSpec, strategy: RetrievalStrategy | "general", count = 60,
): Row {
  const products = sector.build(size);
  const visitors = buildVisitors(sector, products, scenario, count);
  const profiles = visitors.map((v) => v.profile);
  const engine = source(profiles, products);
  let top1 = 0, top3 = 0, c1 = 0, c3 = 0, loss = 0, axisPct = 0, prefSat = 0, missing = 0, cover = 0, n = 0, nodeMs = 0;
  const ranks: number[] = [];
  visitors.forEach((v, vi) => {
    const scored = products.map((p) => ({ id: p.id, score: engine.score(vi, p) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const rank = new Map(scored.map((s, i) => [s.id, i + 1]));
    const axial = products.map((p) => axialScore(v.profile, p.attributes)).sort((a, b) => a - b);
    const median = quantile(axial, 0.5);
    const relevant = new Set(products.filter((p) => v.accepts(p) && axialScore(v.profile, p.attributes) >= median).map((p) => p.id));
    if (!relevant.size) return;
    n++;
    const started = performance.now();
    const general = scored.slice(0, 10);
    const merged = new Map(general.map((s) => [s.id, s.score]));
    if (strategy !== "general") {
      for (const ids of planCandidateSets(strategy, products, v.answers).calls) { const set = new Set(ids); for (const s of scored.filter((x) => set.has(x.id)).slice(0, 10)) merged.set(s.id, s.score); }
    }
    const window = [...merged].map(([id, score]) => ({ id, score }));
    const reference = general[0].score - general[general.length - 1].score;
    const ranked = spec.model ? rerankSoft(window, products, v.answers, { bonus: spec.model, reference }).ranked : rerankSoft(window, products, v.answers, { lambda: 0 }).ranked;
    nodeMs += performance.now() - started;
    const winner = ranked[0].id;
    top1 += relevant.has(winner) ? 1 : 0;
    top3 += ranked.slice(0, 3).filter((x) => relevant.has(x.id)).length / Math.min(3, ranked.length);
    c1 += winner !== scored[0].id ? 1 : 0;
    c3 += ranked.slice(0, 3).map((x) => x.id).join() !== scored.slice(0, 3).map((x) => x.id).join() ? 1 : 0;
    const range = scored[0].score - scored[scored.length - 1].score || 1;
    loss += (scored[0].score - scored.find((s) => s.id === winner)!.score) / range;
    ranks.push(rank.get(winner)!);
    const winnerProduct = products.find((p) => p.id === winner)!;
    const wa = axialScore(v.profile, winnerProduct.attributes);
    axisPct += axial.filter((a) => a <= wa).length / axial.length;
    const d = softDegrees(products, v.answers).byProduct.get(winner);
    prefSat += d ? d.perCriterion.reduce((s, x) => s + x, 0) / d.perCriterion.length : 0;
    missing += [...relevant].filter((id) => !merged.has(id)).length;
    cover += window.some((w) => relevant.has(w.id)) ? 1 : 0;
  });
  ranks.sort((a, b) => a - b);
  return { sector: sector.name, size, scenario, source: engine.name, method: spec.label, strategy, visitors: n, top1: top1 / n, top3: top3 / n, top1Changed: c1 / n, top3Changed: c3 / n, engineLoss: loss / n, engineRankMedian: ranks[Math.floor(ranks.length / 2)], axisPct: axisPct / n, prefSat: prefSat / n, missing: missing / n, coverage: cover / n, nodeMs: nodeMs / n };
}
