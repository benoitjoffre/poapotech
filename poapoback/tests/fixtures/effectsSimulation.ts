/**
 * Simulation du lot 10D-2A. IMPORTANT : le moteur Python (embeddings) n'est PAS exécuté. Le score « moteur » est un proxy :
 *   0,6 × sémantique simulée (bruit reproductible d'écart-type σ) + 0,4 × proximité sur les axes (formule exacte de poapoai/main.py).
 * Les chiffres mesurent donc la mécanique de re-classement, pas la pertinence réelle en production.
 */
import { computeProfile } from "../../src/services/scoring";
import { quantile } from "../../src/services/catalogProfile";
import { parseAnswerEffects, type AnswerEffects } from "../../src/services/answerEffects";
import { exactSoftMatches, rerankSoft, resolveStrict, type EffectProduct, type SelectedAnswer } from "../../src/services/effectsEngine";
import { coffeeSeeded, fashionSeeded, perfumeSeeded, rng } from "./selectionFixtures";

export interface Sector { name: string; products: (n: number) => EffectProduct[]; axes: string[]; category: string }
export const SECTORS: Sector[] = [
  { name: "Parfum", products: (n) => perfumeSeeded(n, 11) as EffectProduct[], axes: ["freshness", "woody", "sweetness", "intensity"], category: "famille" },
  { name: "Café", products: (n) => coffeeSeeded(n, 12) as EffectProduct[], axes: ["acidity", "intensity"], category: "origine" },
  { name: "Mode", products: (n) => fashionSeeded(n, 13) as EffectProduct[], axes: ["confort"], category: "categorie" },
];

const attr = (p: EffectProduct, key: string) => (p.attributes as Record<string, unknown>)[key];
const num = (value: unknown) => (typeof value === "number" ? value : null);

/** Formule exacte de poapoai/main.py generic_attribute_score. */
function axial(profile: Record<string, number>, p: EffectProduct, axes: string[]): number {
  const shared = axes.flatMap((k) => (num(attr(p, k)) !== null ? [[profile[k], num(attr(p, k))!] as const] : []));
  if (!shared.length) return 0;
  return 1 - Math.sqrt(shared.reduce((s, [w, a]) => s + (w - a) ** 2, 0)) / Math.sqrt(shared.length);
}

function noise(id: string, visitor: number, sigma: number): number {
  let h = 2166136261;
  for (const c of `${id}|${visitor}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((((h >>> 0) / 4294967296) - 0.5) * 2) * sigma * Math.sqrt(3);
}

export interface Visitor {
  id: number;
  profile: Record<string, number>;
  category: string;
  /** Plage de prix souhaitée (souple) ou plafond (strict). */
  band: { min: number; max: number } | null;
  cap: number | null;
}

export function makeVisitors(products: EffectProduct[], sector: Sector, count: number, seed: number): Visitor[] {
  const r = rng(seed);
  const counts = new Map<string, number>();
  for (const p of products) counts.set(String(attr(p, sector.category)), (counts.get(String(attr(p, sector.category))) ?? 0) + 1);
  const categories = [...counts.entries()].filter(([, c]) => c >= 2).map(([v]) => v).sort();
  const prices = products.map((p) => p.price!).sort((a, b) => a - b);
  return Array.from({ length: count }, (_, id) => {
    const impacts = sector.axes.flatMap((axis) => (r() < 0.6 ? [{ [axis]: r() < 0.5 ? -0.25 : 0.25 }] : []));
    const profile = computeProfile(sector.axes.map((key) => ({ key, label: key })), impacts);
    const kind = r();
    const q = (x: number) => quantile(prices, x);
    return {
      id, profile, category: categories[Math.floor(r() * categories.length)],
      band: kind < 0.5 ? { min: q(0.2), max: q(0.65) } : null,
      cap: kind >= 0.5 ? q(0.35 + r() * 0.3) : null,
    };
  });
}

const cap = (v: Visitor): AnswerEffects | null => v.cap === null ? null : parseOk({ v: 1, effects: [{ type: "range", criterion: "price", mode: "strict", max: v.cap }] });
const soft = (v: Visitor, sector: Sector): AnswerEffects => parseOk({ v: 1, effects: [
  { type: "category", criterion: `attribute.${sector.category}`, mode: "soft", values: [v.category] },
  ...(v.band ? [{ type: "range", criterion: "price", mode: "soft", min: v.band.min, max: v.band.max }] : []),
] });
function parseOk(raw: unknown): AnswerEffects {
  const parsed = parseAnswerEffects(raw);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.value;
}

export interface Row { strategy: string; window: string; lambda: number; top1Rel: number; top3Prec: number; recallInWindow: number; missedRelevant: number; violations: number; scoreLoss: number; distinctTop1: number; visitors: number }

/** Évalue une stratégie sur un secteur. window : nombre de candidats re-classés (null = tous les candidats notés). */
export function evaluate(sector: Sector, size: number, sigma: number, window: number | null | "dual", lambda: number, visitors = 150): Row {
  const products = sector.products(size);
  const byId = new Map(products.map((p) => [p.id, p]));
  const people = makeVisitors(products, sector, visitors, 99);
  let top1 = 0, top3 = 0, recall = 0, missed = 0, violations = 0, loss = 0, counted = 0;
  const tops = new Set<string>();
  for (const v of people) {
    const strictAnswer: SelectedAnswer[] = [{ questionId: "budget", effects: cap(v) }, { questionId: "pref", effects: soft(v, sector) }];
    const strict = resolveStrict(products, strictAnswer);
    const pool = strict.candidateIds ? products.filter((p) => strict.candidateIds!.includes(p.id)) : products;
    if (!pool.length) continue;
    const scored = pool.map((p) => ({ id: p.id, score: 0.6 * (0.5 + noise(p.id, v.id, sigma)) + 0.4 * axial(v.profile, p, sector.axes) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const axialScores = pool.map((p) => axial(v.profile, p, sector.axes)).sort((a, b) => a - b);
    const median = quantile(axialScores, 0.5);
    // Pertinence indépendante du score moteur : bonne catégorie, prix dans la plage souhaitée, proximité des axes au-dessus de la médiane.
    const relevant = new Set(pool.filter((p) => String(attr(p, sector.category)) === v.category &&
      (!v.band || (p.price! >= v.band.min && p.price! <= v.band.max)) && axial(v.profile, p, sector.axes) >= median).map((p) => p.id));
    let win = scored.slice(0, window === null || window === "dual" ? (window === "dual" ? 10 : scored.length) : window);
    if (window === "dual") {
      // Deux appels au moteur : les 10 meilleurs de tous les candidats + les 10 meilleurs parmi ceux qui répondent exactement
      // aux préférences souples (second appel avec productIds = ces produits). Rien n'est retiré : la première fenêtre reste entière.
      const preferred = new Set(exactSoftMatches(pool, strictAnswer));
      const second = scored.filter((x) => preferred.has(x.id)).slice(0, 10);
      const seen = new Set(win.map((w) => w.id));
      win = [...win, ...second.filter((x) => !seen.has(x.id))];
    }
    const ranked = rerankSoft(win, products, strictAnswer, { lambda }).ranked;
    counted++;
    top1 += relevant.has(ranked[0].id) ? 1 : 0;
    top3 += ranked.slice(0, 3).filter((r) => relevant.has(r.id)).length / Math.min(3, ranked.length);
    recall += win.some((w) => relevant.has(w.id)) ? 1 : 0;
    missed += [...relevant].filter((id) => !win.some((w) => w.id === id)).length;
    violations += v.cap !== null && byId.get(ranked[0].id)!.price! > v.cap ? 1 : 0;
    const spread = scored[0].score - scored[scored.length - 1].score || 1;
    loss += (scored[0].score - scored.find((s) => s.id === ranked[0].id)!.score) / spread;
    tops.add(ranked[0].id);
  }
  return {
    strategy: sector.name, window: window === null ? "tous" : String(window), lambda, top1Rel: top1 / counted, top3Prec: top3 / counted,
    recallInWindow: recall / counted, missedRelevant: missed / counted, violations, scoreLoss: loss / counted, distinctTop1: tops.size, visitors: counted,
  };
}

/** Référence sans aucun effet : le moteur seul, sur tout le catalogue (ni plafond, ni préférence). */
export function baseline(sector: Sector, size: number, sigma: number, visitors = 150): Row {
  const products = sector.products(size);
  const byId = new Map(products.map((p) => [p.id, p]));
  const people = makeVisitors(products, sector, visitors, 99);
  let top1 = 0, top3 = 0, violations = 0;
  const tops = new Set<string>();
  for (const v of people) {
    const scored = products.map((p) => ({ id: p.id, score: 0.6 * (0.5 + noise(p.id, v.id, sigma)) + 0.4 * axial(v.profile, p, sector.axes) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const axialScores = products.map((p) => axial(v.profile, p, sector.axes)).sort((a, b) => a - b);
    const median = quantile(axialScores, 0.5);
    const pool = v.cap === null ? products : products.filter((p) => p.price! <= v.cap!);
    const relevant = new Set(pool.filter((p) => String(attr(p, sector.category)) === v.category && (!v.band || (p.price! >= v.band.min && p.price! <= v.band.max)) && axial(v.profile, p, sector.axes) >= median).map((p) => p.id));
    top1 += relevant.has(scored[0].id) ? 1 : 0;
    top3 += scored.slice(0, 3).filter((s) => relevant.has(s.id)).length / 3;
    violations += v.cap !== null && byId.get(scored[0].id)!.price! > v.cap ? 1 : 0;
    tops.add(scored[0].id);
  }
  return { strategy: sector.name, window: "moteur seul", lambda: 0, top1Rel: top1 / people.length, top3Prec: top3 / people.length, recallInWindow: 1, missedRelevant: 0, violations, scoreLoss: 0, distinctTop1: tops.size, visitors: people.length };
}
