/**
 * Comparaison avant/après du lot 10D-2C : générateur historique (modèles sectoriels, axes 0–1) contre générateur universel
 * (critères tirés des données), sur les mêmes catalogues synthétiques Parfum, Café et Mode et les mêmes visiteurs.
 * Sources de scores : "simulé" (formule des axes + sémantique simulée) ou "réel" (code de main.py + vrai modèle d'embeddings,
 * sans base ni HTTP : voir poapoai/tools/score_fixtures.py). Les visiteurs répondent selon une intention latente, avec une
 * politique de réponse déterministe identique pour les deux générateurs.
 */
import type { ExpressDraft, QuizAxis } from "@poapo/types";
import { quantile } from "../../src/services/catalogProfile";
import { planCandidateSets } from "../../src/services/candidateRetrieval";
import { type BonusModel, rerankSoft, resolveStrict, softDegrees, type EffectProduct, type SelectedAnswer } from "../../src/services/effectsEngine";
import { type ExpressContext, type ExpressOptions, proposeExpressQuiz } from "../../src/services/expressQuiz";
import { computeProfile } from "../../src/services/scoring";
import { universalGenerator } from "../../src/services/universalQuiz";
import { axialScore, semantic } from "./fakeEngine";
import { SECTOR_CONFIGS, type SectorConfig } from "./bonusExperiment";
import { rng } from "./selectionFixtures";

export type Generator = "legacy" | "universal";
export interface Intent { axisSigns: Record<string, number>; category: string; category2: string | null; band: { min: number; max: number } | null; cap: number | null }
export interface Plan { sector: SectorConfig; products: EffectProduct[]; context: ExpressContext; draft: ExpressDraft; intents: Intent[]; picks: number[][]; profiles: Record<string, number>[] }

const attr = (p: EffectProduct, k: string) => (p.attributes as Record<string, unknown>)[k];
const humanize = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);
const isNeutral = (a: ExpressDraft["questions"][number]["answers"][number]) => !Object.keys(a.impacts).length && !!a.effects?.effects.length && a.effects.effects.every((e) => e.type === "none");

export function contextFor(sector: SectorConfig, size: number): { products: EffectProduct[]; context: ExpressContext } {
  const products = sector.build(size);
  const axes: QuizAxis[] = sector.axes.map((key) => ({ key, label: key, lowLabel: null, highLabel: null }));
  return {
    products,
    context: {
      catalogId: "c", catalogName: sector.name, catalogDescription: null, industry: sector.industry, existingAxes: axes,
      products: products.map((p) => ({ id: p.id, name: p.id, brand: p.brand ?? null, price: p.price ?? null, description: null, tags: [...(p.tags ?? [])], attributes: p.attributes, embeddingReady: false })),
    },
  };
}

export function buildIntents(sector: SectorConfig, products: EffectProduct[], count = 60): Intent[] {
  const r = rng(21);
  const r2 = rng(22); // flux séparé : l'ajout de la seconde préférence ne change pas les intentions déjà tirées
  const values = [...new Set(products.map((p) => String(attr(p, sector.cats[0]))))].sort();
  const values2 = [...new Set(products.map((p) => String(attr(p, sector.cats[1]))))].sort();
  const prices = products.map((p) => p.price!).sort((a, b) => a - b);
  return Array.from({ length: count }, () => {
    const axisSigns = Object.fromEntries(sector.axes.map((a) => [a, r() < 0.6 ? (r() < 0.5 ? -1 : 1) : 0]));
    const category = values[Math.floor(r() * values.length)];
    const useBand = r() < 0.5;
    const cap = useBand ? null : quantile(prices, [0.35, 0.5, 0.65][Math.floor(r() * 3)]);
    const category2 = r2() < 0.5 ? values2[Math.floor(r2() * values2.length)] : null;
    return { axisSigns, category, category2, band: useBand ? { min: quantile(prices, 0.2), max: quantile(prices, 0.6) } : null, cap };
  });
}

/** Politique de réponse identique pour les deux générateurs : l'intention latente détermine la réponse choisie à chaque question. */
export function answerFor(question: ExpressDraft["questions"][number], intent: Intent, sector: SectorConfig): number {
  const neutral = question.answers.findIndex(isNeutral);
  const kind = question.info?.kind;
  if (kind === "choice") {
    const label = question.info!.criterion.toLowerCase();
    const wanted = label === humanize(sector.cats[0]).toLowerCase() ? intent.category : label === humanize(sector.cats[1]).toLowerCase() ? intent.category2 : null;
    if (!wanted) return neutral;
    const at = question.answers.findIndex((a) => a.effects?.effects.some((e) => e.type === "category" && e.values.includes(wanted)));
    return at >= 0 ? at : neutral;
  }
  if (kind === "budget") {
    const ranges = question.answers.map((a) => a.effects?.effects.find((e) => e.type === "range") as { mode: string; min?: number; max?: number } | undefined);
    if (intent.cap !== null) {
      // Plafond voulu : réponse strict si elle existe, sinon la tranche « jusqu'à » la plus haute sous le plafond (préférence souple).
      const strict = ranges.map((r, i) => ({ r, i })).filter((x) => x.r?.max !== undefined && (x.r.mode === "strict" || question.answers.every((a) => !a.effects?.effects.some((e) => e.type === "range" && e.mode === "strict"))));
      if (!strict.length) return neutral;
      const under = strict.filter((x) => x.r!.max! <= intent.cap!);
      return (under.length ? under.sort((a, b) => b.r!.max! - a.r!.max!)[0] : strict.sort((a, b) => a.r!.max! - b.r!.max!)[0]).i;
    }
    const band = intent.band!;
    const overlap = (r?: { min?: number; max?: number }) => r ? Math.max(0, Math.min(r.max ?? Infinity, band.max) - Math.max(r.min ?? -Infinity, band.min)) : -1;
    const best = ranges.map((r, i) => ({ i, o: overlap(r) })).sort((a, b) => b.o - a.o || a.i - b.i)[0];
    return best.o > 0 ? best.i : neutral;
  }
  // Axe (ou question historique) : réponse la plus alignée sur le sens voulu ; aucune intention → réponse neutre ou la plus faible en impact.
  const align = question.answers.map((a, i) => ({ i, v: Object.entries(a.impacts).reduce((s, [k, x]) => s + (intent.axisSigns[k] ?? 0) * x, 0), mag: Object.values(a.impacts).reduce((s, x) => s + Math.abs(x), 0) }));
  const wants = align.some((a) => a.v !== 0);
  if (!wants) return neutral >= 0 ? neutral : align.sort((a, b) => a.mag - b.mag || a.i - b.i)[0].i;
  return align.sort((a, b) => b.v - a.v || a.i - b.i)[0].i;
}

export function planFor(sector: SectorConfig, size: number, generator: Generator, options: ExpressOptions = {}): Plan {
  const { products, context } = contextFor(sector, size);
  process.env.EXPRESS_UNIVERSAL_QUESTIONS = "1";
  const proposal = proposeExpressQuiz(context, options, generator === "universal" ? universalGenerator : undefined);
  const draft = proposal.draft!;
  const intents = buildIntents(sector, products);
  const picks = intents.map((intent) => draft.questions.map((q) => answerFor(q, intent, sector)));
  const profiles = picks.map((pick) => computeProfile(draft.axes, pick.map((a, i) => draft.questions[i].answers[a].impacts)));
  return { sector, products, context, draft, intents, picks, profiles };
}

export interface ScoreTable { score: (visitor: number, product: EffectProduct) => number }
export const simulatedTable = (plan: Plan, sigma = 0.05): ScoreTable => ({ score: (v, p) => 0.6 * semantic(p.id, sigma) + 0.4 * axialScore(plan.profiles[v], p.attributes) });
export const realTable = (plan: Plan, matrix: number[][]): ScoreTable => {
  const index = new Map(plan.products.map((p, i) => [p.id, i]));
  return { score: (v, p) => matrix[v][index.get(p.id)!] };
};

export interface Metrics {
  sector: string; generator: string; bonus: string; questions: number; criteria: number; axes: number; redundantWarnings: number;
  top1: number; top3: number; intentSat: number; axisPct: number; engineLoss: number; diversity: number; violations: number; capVisitors: number; noMatch: number; ablationNoEffect: number; effectQuestions: number; visitors: number;
}

/** Évalue un plan. `bonus` null = classement du moteur seul (générateur historique, qui n'a aucun effet). */
export function evaluatePlan(plan: Plan, table: ScoreTable, bonus: BonusModel | null, label: string, retrieval: "exact" = "exact"): Metrics {
  const { products, draft, intents, picks, sector } = plan;
  const byId = new Map(products.map((p) => [p.id, p]));
  const engaged = draft.questions.map(() => false);
  let top1 = 0, top3 = 0, sat = 0, axisPct = 0, loss = 0, violations = 0, capVisitors = 0, noMatch = 0, n = 0;
  const winners = new Set<string>();
  const ablation: number[] = draft.questions.map(() => 0);
  const rank = (visitor: number, selected: SelectedAnswer[], useEffects: boolean): { ranked: { id: string }[]; strictState: string } => {
    const strict = useEffects ? resolveStrict(products, selected) : null;
    if (strict && (strict.state === "no_match" || strict.state === "unreliable")) return { ranked: [], strictState: strict.state };
    const candidates = strict?.candidateIds ? products.filter((p) => strict.candidateIds!.includes(p.id)) : products;
    const scored = candidates.map((p) => ({ id: p.id, score: table.score(visitor, p) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    if (!useEffects || !bonus) return { ranked: scored, strictState: "none" };
    const general = scored.slice(0, 10);
    const merged = new Map(general.map((s) => [s.id, s.score]));
    for (const ids of planCandidateSets(retrieval, candidates, selected).calls) { const set = new Set(ids); for (const s of scored.filter((x) => set.has(x.id)).slice(0, 10)) merged.set(s.id, s.score); }
    const reference = general[0].score - general[general.length - 1].score;
    return { ranked: rerankSoft([...merged].map(([id, score]) => ({ id, score })), candidates, selected, { bonus, reference }).ranked, strictState: "ok" };
  };
  intents.forEach((intent, v) => {
    const selected: SelectedAnswer[] = picks[v].map((a, i) => ({ questionId: `q${i}`, effects: draft.questions[i].answers[a].effects ?? null }));
    const { ranked, strictState } = rank(v, selected, !!bonus);
    n++;
    if (intent.cap !== null) capVisitors++;
    if (!ranked.length) { noMatch += strictState === "no_match" ? 1 : 0; return; }
    const winner = ranked[0].id;
    const winnerProduct = byId.get(winner)!;
    // Référence indépendante des générateurs : classement du moteur seul sur tout le catalogue pour le MÊME profil.
    const all = products.map((p) => ({ id: p.id, score: table.score(v, p) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const intentProfile = computeProfile(sector.axes.map((key) => ({ key, label: key })), sector.axes.flatMap((a) => (intent.axisSigns[a] ? [{ [a]: intent.axisSigns[a] * 0.25 }] : [])));
    const axial = products.map((p) => axialScore(intentProfile, p.attributes)).sort((a, b) => a - b);
    const median = quantile(axial, 0.5);
    const accepts = (p: EffectProduct) => attr(p, sector.cats[0]) === intent.category && (intent.category2 === null || attr(p, sector.cats[1]) === intent.category2) && (intent.band ? p.price! >= intent.band.min && p.price! <= intent.band.max : intent.cap !== null ? p.price! <= intent.cap : true);
    const relevant = (p: EffectProduct) => accepts(p) && axialScore(intentProfile, p.attributes) >= median;
    top1 += relevant(winnerProduct) ? 1 : 0;
    top3 += ranked.slice(0, 3).filter((x) => relevant(byId.get(x.id)!)).length / Math.min(3, ranked.length);
    const okCategory = attr(winnerProduct, sector.cats[0]) === intent.category ? 1 : 0;
    const okBudget = intent.band ? (winnerProduct.price! >= intent.band.min && winnerProduct.price! <= intent.band.max ? 1 : 0) : (winnerProduct.price! <= intent.cap! ? 1 : 0);
    const okCategory2 = intent.category2 === null ? 0 : attr(winnerProduct, sector.cats[1]) === intent.category2 ? 1 : 0;
    sat += (okCategory + okBudget + okCategory2) / (2 + (intent.category2 === null ? 0 : 1));
    axisPct += axial.filter((a) => a <= axialScore(intentProfile, winnerProduct.attributes)).length / axial.length;
    const range = all[0].score - all[all.length - 1].score || 1;
    loss += (all[0].score - table.score(v, winnerProduct)) / range;
    if (intent.cap !== null && winnerProduct.price! > intent.cap) violations++;
    winners.add(winner);
    // Ablation des questions à effets (le profil ne change pas : mêmes scores) : remplacer la réponse par la réponse neutre.
    draft.questions.forEach((q, qi) => {
      if (!bonus || !q.info || q.info.kind === "axis") return;
      const neutral = q.answers.findIndex(isNeutral);
      if (neutral < 0 || neutral === picks[v][qi]) return;
      engaged[qi] = true;
      const altered = selected.map((s, i) => (i === qi ? { ...s, effects: q.answers[neutral].effects ?? null } : s));
      const alt = rank(v, altered, true).ranked[0]?.id;
      if (alt !== winner) ablation[qi]++;
    });
  });
  const effectIdx = draft.questions.map((q, i) => (q.info && q.info.kind !== "axis" ? i : -1)).filter((i) => i >= 0);
  const criteriaCount = new Set([...draft.axes.map((a) => a.key), ...draft.questions.filter((q) => q.info && q.info.kind !== "axis").map((q) => q.info!.criterion)]).size;
  const { products: _p } = plan;
  void _p; void softDegrees;
  return {
    sector: sector.name, generator: label.split("|")[0], bonus: label.split("|")[1] ?? "—", questions: draft.questions.length, criteria: criteriaCount, axes: draft.axes.length,
    redundantWarnings: 0, top1: top1 / n, top3: top3 / n, intentSat: sat / n, axisPct: axisPct / n, engineLoss: loss / n, diversity: winners.size / n, violations, capVisitors, noMatch,
    ablationNoEffect: effectIdx.filter((i) => engaged[i] && ablation[i] === 0).length, effectQuestions: effectIdx.filter((i) => engaged[i]).length, visitors: n,
  };
}

export const SECTORS = SECTOR_CONFIGS;
