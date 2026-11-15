/**
 * Expérience du lot 10D-2B.1 : comparaison des stratégies de récupération des candidats.
 * MOTEUR SIMULÉ : score = 0,6 × sémantique simulée (bruit reproductible, σ = 0,05) + 0,4 × proximité des axes (formule exacte de main.py).
 * Les chiffres décrivent la mécanique de récupération et de re-classement, pas la pertinence réelle en production.
 */
import { performance } from "node:perf_hooks";
import { parseAnswerEffects } from "../../src/services/answerEffects";
import { planCandidateSets, type RetrievalStrategy } from "../../src/services/candidateRetrieval";
import { quantile } from "../../src/services/catalogProfile";
import { rerankSoft, softDegrees, type EffectProduct, type SelectedAnswer } from "../../src/services/effectsEngine";
import { computeProfile } from "../../src/services/scoring";
import { axialScore, semantic } from "./fakeEngine";
import { perfumeSeeded, rng } from "./selectionFixtures";

export const AXES = ["freshness", "woody", "sweetness", "intensity"];
export const SCENARIOS = ["une_rare", "une_frequente", "compatibles", "trois_prefs", "contradictoires"] as const;
export type Scenario = typeof SCENARIOS[number];
export const STRATEGIES: (RetrievalStrategy | "aucune" | "top10" | "tous")[] = ["aucune", "top10", "exact", "union_single", "union_quota", "weighted", "exact+weighted", "exact+quota", "adaptive", "tous"];

const fx = (effect: unknown): SelectedAnswer["effects"] => {
  const parsed = parseAnswerEffects({ v: 1, effects: [effect] });
  if (!parsed.ok) throw new Error(parsed.errors.join(";"));
  return parsed.value;
};
const fam = (...values: string[]) => ({ type: "category", criterion: "attribute.famille", mode: "soft", values });
const genre = (value: string) => ({ type: "category", criterion: "attribute.genre", mode: "soft", values: [value] });

export interface Visitor {
  profile: Record<string, number>;
  answers: SelectedAnswer[];
  /** Produit « souhaité » : satisfait explicitement les préférences (au sens large pour les contradictoires). */
  accepts: (p: EffectProduct) => boolean;
  label: string;
}

export function buildCatalog(size: number): EffectProduct[] { return perfumeSeeded(size, 77) as EffectProduct[]; }
const attr = (p: EffectProduct, k: string) => (p.attributes as Record<string, unknown>)[k];

export function buildVisitors(products: EffectProduct[], scenario: Scenario, count = 60): Visitor[] {
  const r = rng(5);
  const counts = new Map<string, number>();
  products.forEach((p) => counts.set(String(attr(p, "famille")), (counts.get(String(attr(p, "famille"))) ?? 0) + 1));
  const families = [...counts.keys()].sort();
  const byFreq = [...counts.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const prices = products.map((p) => p.price!).sort((a, b) => a - b);
  const band = { min: quantile(prices, 0.2), max: quantile(prices, 0.6) };
  const bandEffect = { type: "range", criterion: "price", mode: "soft", min: band.min, max: band.max };
  const inBand = (p: EffectProduct) => p.price! >= band.min && p.price! <= band.max;
  const genres = ["Femme", "Homme", "Mixte"];
  return Array.from({ length: count }, (_, v) => {
    const impacts = AXES.flatMap((a) => (r() < 0.6 ? [{ [a]: r() < 0.5 ? -0.25 : 0.25 }] : []));
    const profile = computeProfile(AXES.map((key) => ({ key, label: key })), impacts);
    const A = families[Math.floor(r() * families.length)];
    const B = families[(families.indexOf(A) + 1 + Math.floor(r() * (families.length - 1))) % families.length];
    const G = genres[Math.floor(r() * genres.length)];
    const rare = byFreq[0][0], frequent = byFreq[byFreq.length - 1][0];
    const ans = (...effects: unknown[]): SelectedAnswer[] => effects.map((e, i) => ({ questionId: `q${i}`, effects: fx(e) }));
    switch (scenario) {
      case "une_rare": return { profile, answers: ans(fam(rare)), accepts: (p) => attr(p, "famille") === rare, label: `famille ${rare}` };
      case "une_frequente": return { profile, answers: ans(fam(frequent)), accepts: (p) => attr(p, "famille") === frequent, label: `famille ${frequent}` };
      case "compatibles": return { profile, answers: ans(fam(A), bandEffect), accepts: (p) => attr(p, "famille") === A && inBand(p), label: `famille ${A} + prix ${Math.round(band.min)}–${Math.round(band.max)}` };
      case "trois_prefs": return { profile, answers: ans(fam(A), genre(G), bandEffect), accepts: (p) => attr(p, "famille") === A && attr(p, "genre") === G && inBand(p), label: `famille ${A} + genre ${G} + prix` };
      case "contradictoires": return { profile, answers: ans(fam(A), fam(B)), accepts: (p) => [A, B].includes(String(attr(p, "famille"))), label: `famille ${A} ou ${B}` };
    }
  });
}

export interface Row {
  size: number; scenario: Scenario; strategy: string; lambda: number; visitors: number;
  top1: number; top3: number; coverage: number; missing: number; diversity: number; engineLoss: number; axisPct: number; prefSat: number;
  nodeMs: number; pythonCalls: number;
}

export function evaluateStrategy(size: number, scenario: Scenario, strategy: string, lambda: number): Row {
  const products = buildCatalog(size);
  const visitors = buildVisitors(products, scenario);
  const byId = new Map(products.map((p) => [p.id, p]));
  let top1 = 0, top3 = 0, cover = 0, missing = 0, loss = 0, axisPct = 0, prefSat = 0, nodeMs = 0, calls = 0, n = 0;
  const winners = new Set<string>();
  for (const v of visitors) {
    const scored = products.map((p) => ({ id: p.id, score: 0.6 * semantic(p.id, 0.05) + 0.4 * axialScore(v.profile, p.attributes) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const axial = products.map((p) => axialScore(v.profile, p.attributes)).sort((a, b) => a - b);
    const median = quantile(axial, 0.5);
    const relevant = new Set(products.filter((p) => v.accepts(p) && axialScore(v.profile, p.attributes) >= median).map((p) => p.id));
    if (!relevant.size) continue;
    n++;
    const started = performance.now();
    let window: { id: string; score: number }[];
    let extra = 0;
    const top = (ids: string[] | null) => scored.filter((s) => !ids || ids.includes(s.id)).slice(0, 10);
    if (strategy === "tous") window = scored;
    else if (strategy === "aucune") window = scored.slice(0, 1);
    else {
      const plan = strategy === "top10" ? { calls: [] as string[][] } : planCandidateSets(strategy as RetrievalStrategy, products, v.answers);
      const merged = new Map<string, number>();
      for (const item of top(null)) merged.set(item.id, item.score);
      for (const ids of plan.calls) for (const item of top(ids)) merged.set(item.id, item.score);
      window = [...merged].map(([id, score]) => ({ id, score }));
      extra = plan.calls.length;
    }
    const ranked = strategy === "aucune" ? window : rerankSoft(window, products, v.answers, { lambda }).ranked;
    nodeMs += performance.now() - started;
    calls += strategy === "aucune" || strategy === "tous" ? 1 : 1 + extra;
    const winner = ranked[0].id;
    winners.add(winner);
    top1 += relevant.has(winner) ? 1 : 0;
    top3 += ranked.slice(0, 3).filter((x) => relevant.has(x.id)).length / Math.min(3, ranked.length);
    cover += window.some((w) => relevant.has(w.id)) ? 1 : 0;
    missing += [...relevant].filter((id) => !window.some((w) => w.id === id)).length;
    const range = scored[0].score - scored[scored.length - 1].score || 1;
    loss += (scored[0].score - scored.find((s) => s.id === winner)!.score) / range;
    const winnerAxial = axialScore(v.profile, byId.get(winner)!.attributes);
    axisPct += axial.filter((a) => a <= winnerAxial).length / axial.length;
    const degrees = softDegrees(products, v.answers).byProduct.get(winner);
    prefSat += degrees ? degrees.perCriterion.reduce((s, x) => s + x, 0) / degrees.perCriterion.length : 0;
  }
  return { size, scenario, strategy, lambda, visitors: n, top1: top1 / n, top3: top3 / n, coverage: cover / n, missing: missing / n, diversity: winners.size / n, engineLoss: loss / n, axisPct: axisPct / n, prefSat: prefSat / n, nodeMs: nodeMs / n, pythonCalls: calls / n };
}

export function exampleCases(size: number, scenario: Scenario, a: RetrievalStrategy, b: RetrievalStrategy, lambda: number, limit = 3, lambdaB = lambda) {
  const products = buildCatalog(size);
  const byId = new Map(products.map((p) => [p.id, p]));
  const out: string[] = [];
  for (const v of buildVisitors(products, scenario)) {
    const scored = products.map((p) => ({ id: p.id, score: 0.6 * semantic(p.id, 0.05) + 0.4 * axialScore(v.profile, p.attributes) })).sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
    const pick = (s: RetrievalStrategy, l: number) => {
      const plan = planCandidateSets(s, products, v.answers);
      const merged = new Map<string, number>();
      for (const item of scored.slice(0, 10)) merged.set(item.id, item.score);
      for (const ids of plan.calls) for (const item of scored.filter((x) => ids.includes(x.id)).slice(0, 10)) merged.set(item.id, item.score);
      return rerankSoft([...merged].map(([id, score]) => ({ id, score })), products, v.answers, { lambda: l }).ranked[0].id;
    };
    const wa = pick(a, lambda), wb = pick(b, lambdaB);
    if (wa === wb) continue;
    const describe = (id: string) => { const p = byId.get(id)!; return `${id} (${attr(p, "famille")}, ${attr(p, "genre")}, ${p.price} €, moteur ${(scored.find((s) => s.id === id)!.score).toFixed(3)} / rang ${scored.findIndex((s) => s.id === id) + 1})`; };
    out.push(`${v.label} | engine top1 ${describe(scored[0].id)} | ${a}: ${describe(wa)} ${v.accepts(byId.get(wa)!) ? "✔" : "✘"} | ${b}: ${describe(wb)} ${v.accepts(byId.get(wb)!) ? "✔" : "✘"}`);
    if (out.length >= limit) break;
  }
  return out;
}
