import { performance } from "node:perf_hooks";
import type { ExpressDraft, QuizAxis } from "@poapo/types";
import { recommendQuizWithEffects } from "./effectsRecommendation";
import type { BonusModel } from "./effectsEngine";
import { type ExpressContext, proposeExpressQuiz } from "./expressQuiz";
import { fetchRecommend } from "./quizRecommendations";
import { computeProfile } from "./scoring";
import { universalGenerator } from "./universalQuiz";

/**
 * Protocole d'évaluation sur un VRAI catalogue (lot 10D-2D) : prépare une évaluation à l'aveugle, sans rien écrire.
 * Trois variantes comparées avec le vrai moteur : historique, universel λ = 1 (défaut), universel β = 0,15 (essai).
 * Les « visiteurs » sont des intentions tirées au hasard (graine fixe) dans les questions réellement générées ; chacun est décrit
 * par une fiche en français que les juges lisent AVANT de voir les résultats. Les métriques automatiques et les jugements humains
 * sont produits séparément ; la correspondance variante ↔ code anonyme est stockée à part (key).
 */

export type VariantId = "legacy" | "universal_lambda1" | "universal_beta015";
export const VARIANTS: { id: VariantId; label: string; bonus: BonusModel | null }[] = [
  { id: "legacy", label: "Générateur historique (moteur seul)", bonus: null },
  { id: "universal_lambda1", label: "Universel · bonus par fenêtre λ = 1 (défaut)", bonus: { kind: "window_spread", lambda: 1 } },
  { id: "universal_beta015", label: "Universel · bonus constant β = 0,15 (essai)", bonus: { kind: "constant", beta: 0.15 } },
];

export interface Scenario { id: string; brief: string; wishes: { criterion: string; description: string; satisfied: (product: ProductLite) => boolean }[]; axisSigns: Record<string, number>; choices: Record<string, number>; budget: { questionIndex: number; answerIndex: number } | null }
export interface ProductLite { id: string; name: string; price: number | null; brand: string | null; attributes: Record<string, unknown> }
export interface VariantResult { top: { id: string; name: string; price: number | null; summary: string }[]; ms: number; satisfied: number; wishes: number; engineLoss: number | null; degraded: string[] }
export interface Evaluation {
  questions: { variant: "legacy" | "universal"; questions: { text: string; criterion: string | null; answers: string[] }[] };
  scenarios: Scenario[]; results: Record<string, Record<VariantId, VariantResult>>;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const isNeutral = (a: ExpressDraft["questions"][number]["answers"][number]) => !Object.keys(a.impacts).length && !!a.effects?.effects.length && a.effects.effects.every((e) => e.type === "none");
const summarise = (p: ProductLite) => Object.entries(p.attributes).filter(([, v]) => typeof v === "string" || typeof v === "boolean").slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(", ");

export async function runPilotEvaluation(
  context: ExpressContext, tenantId: string, options: { visitors?: number; seed?: number; strictBudget?: boolean } = {},
): Promise<Evaluation> {
  const saved = process.env.EXPRESS_UNIVERSAL_QUESTIONS;
  process.env.EXPRESS_UNIVERSAL_QUESTIONS = "1"; // en mémoire, pour ce calcul uniquement
  let legacyDraft: ExpressDraft | null, universalDraft: ExpressDraft | null;
  try {
    legacyDraft = proposeExpressQuiz(context, {}).draft;
    const universal = proposeExpressQuiz(context, { strictBudget: options.strictBudget === true }, universalGenerator);
    if (universal.analysis.generator !== "universal") throw new Error("Le générateur universel n'a rien produit d'exploitable pour ce catalogue : évaluation impossible.");
    universalDraft = universal.draft;
  } finally { if (saved === undefined) delete process.env.EXPRESS_UNIVERSAL_QUESTIONS; else process.env.EXPRESS_UNIVERSAL_QUESTIONS = saved; }
  if (!universalDraft) throw new Error("Aucun brouillon universel.");
  const products = new Map<string, ProductLite>(context.products.map((p) => [p.id, { id: p.id, name: p.name, price: p.price ?? null, brand: p.brand, attributes: (p.attributes && typeof p.attributes === "object" ? p.attributes : {}) as Record<string, unknown> }]));
  const labelOf = new Map([...(legacyDraft?.axes ?? []), ...universalDraft.axes].map((a) => [a.key, a.label]));
  const r = rng(options.seed ?? 1);
  const prices = context.products.map((p) => p.price).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);

  // Fiches visiteurs : intention tirée dans les questions réellement générées.
  const scenarios: Scenario[] = Array.from({ length: options.visitors ?? 30 }, (_, n) => {
    const axisSigns: Record<string, number> = {};
    for (const axis of [...new Set([...(legacyDraft?.axes ?? []), ...universalDraft!.axes].map((a) => a.key))]) axisSigns[axis] = r() < 0.6 ? (r() < 0.5 ? -1 : 1) : 0;
    const choices: Record<string, number> = {};
    const wishes: Scenario["wishes"] = [];
    let budget: Scenario["budget"] = null;
    universalDraft!.questions.forEach((q, qi) => {
      if (q.info?.kind === "choice" && r() < 0.5) {
        const real = q.answers.map((a, i) => ({ a, i })).filter((x) => !isNeutral(x.a));
        const pick = real[Math.floor(r() * real.length)];
        choices[String(qi)] = pick.i;
        const effect = pick.a.effects!.effects[0];
        if (effect.type === "category") {
          const key = effect.criterion.replace(/^attribute\./, "");
          wishes.push({ criterion: q.info.criterion, description: `${q.info.criterion} : ${pick.a.text}`, satisfied: (p) => String(p.attributes[key]).toLowerCase() === effect.values[0].toLowerCase() });
        }
      }
      if (q.info?.kind === "budget" && prices.length && r() < 0.5) {
        const ranged = q.answers.map((a, i) => ({ a, i, e: a.effects?.effects.find((e) => e.type === "range") as { min?: number; max?: number } | undefined })).filter((x) => x.e);
        const pick = ranged[Math.floor(r() * ranged.length)];
        budget = { questionIndex: qi, answerIndex: pick.i };
        wishes.push({ criterion: "Prix", description: `Budget : ${pick.a.text}`, satisfied: (p) => p.price !== null && (pick.e!.min === undefined || p.price >= pick.e!.min) && (pick.e!.max === undefined || p.price <= pick.e!.max) });
      }
    });
    const axisWishes = Object.entries(axisSigns).filter(([, s]) => s !== 0).map(([k, s]) => `${labelOf.get(k) ?? k} : ${s > 0 ? "élevé" : "faible"}`);
    return { id: `S${String(n + 1).padStart(2, "0")}`, brief: [...wishes.map((w) => w.description), ...axisWishes].join(" · ") || "Aucune préférence particulière", wishes, axisSigns, choices, budget };
  });

  const pickFor = (draft: ExpressDraft, s: Scenario, universal: boolean): number[] => draft.questions.map((q, qi) => {
    if (universal && s.choices[String(qi)] !== undefined) return s.choices[String(qi)];
    if (universal && s.budget?.questionIndex === qi) return s.budget.answerIndex;
    const neutral = q.answers.findIndex(isNeutral);
    const align = q.answers.map((a, i) => ({ i, v: Object.entries(a.impacts).reduce((sum, [k, x]) => sum + (s.axisSigns[k] ?? 0) * x, 0) }));
    return align.some((x) => x.v !== 0) ? align.sort((a, b) => b.v - a.v || a.i - b.i)[0].i : neutral >= 0 ? neutral : 0;
  });
  const axesOf = (draft: ExpressDraft): QuizAxis[] => draft.axes.map(({ key, label, lowLabel, highLabel }) => ({ key, label, lowLabel, highLabel }));
  const base = { tenantId, catalogId: context.catalogId, industry: context.industry };
  const results: Evaluation["results"] = {};
  for (const s of scenarios) {
    results[s.id] = {} as Record<VariantId, VariantResult>;
    for (const variant of VARIANTS) {
      const draft = variant.id === "legacy" ? legacyDraft : universalDraft;
      if (!draft) continue;
      const picks = pickFor(draft, s, variant.id !== "legacy");
      const axes = axesOf(draft);
      const started = performance.now();
      let ids: string[]; let degraded: string[] = [];
      let profile: Record<string, number>;
      if (variant.id === "legacy") {
        profile = computeProfile(axes, picks.map((a, i) => draft.questions[i].answers[a].impacts));
        const rec = await fetchRecommend({ ...base, axes, profile, topN: 3 });
        ids = rec.topN.map((t) => t.id);
      } else {
        profile = computeProfile(axes, picks.map((a, i) => draft.questions[i].answers[a].impacts));
        const rec = await recommendQuizWithEffects({ ...base, axes, answers: picks.map((a, i) => ({ questionId: `q${i}`, impacts: draft.questions[i].answers[a].impacts, effects: draft.questions[i].answers[a].effects })) }, undefined, { forceEffectsPath: true, resultCount: 3, bonus: variant.bonus! });
        ids = (rec.ranking ?? [{ id: rec.product.id }]).map((x) => x.id);
        degraded = rec.diagnostics?.degraded ?? [];
      }
      const ms = performance.now() - started;
      const top = ids.map((id) => products.get(id)!).filter(Boolean);
      // Perte de score du moteur seul (même profil) : score du produit retenu mesuré par le moteur lui-même (comparable entre appels).
      let engineLoss: number | null = null;
      if (top[0]) {
        const best = await fetchRecommend({ ...base, axes, profile, topN: 10 });
        const mine = await fetchRecommend({ ...base, axes, profile, productIds: [top[0].id], topN: 1 });
        const spread = best.topN[0].score - best.topN[best.topN.length - 1].score || 1;
        engineLoss = (best.topN[0].score - mine.topN[0].score) / spread;
      }
      results[s.id][variant.id] = {
        top: top.map((p) => ({ id: p.id, name: p.name, price: p.price, summary: summarise(p) })), ms, degraded, engineLoss,
        satisfied: top[0] ? s.wishes.filter((w) => w.satisfied(top[0])).length : 0, wishes: s.wishes.length,
      };
    }
  }
  const describe = (draft: ExpressDraft, variant: "legacy" | "universal") => ({ variant, questions: draft.questions.map((q) => ({ text: q.text, criterion: q.info?.criterion ?? null, answers: q.answers.map((a) => a.text) })) });
  return { questions: describe(universalDraft, "universal"), scenarios, results };
}

/** Feuille d'évaluation À L'AVEUGLE : ordre des variantes mélangé par scénario (graine), codes X/Y/Z ; la clé est un fichier distinct. */
export function blindSheet(evaluation: Evaluation, seed = 7): { csv: string; key: Record<string, Record<string, VariantId>> } {
  const r = rng(seed);
  const codes = ["X", "Y", "Z"];
  const key: Record<string, Record<string, VariantId>> = {};
  const rows = ["scenario;fiche visiteur;variante;rang;produit;prix;caractéristiques;cohérence du Top 1 (1-5);pertinence du Top 3 (1-5);préférences respectées (oui/non);qualité du compromis (1-5);question ambiguë ou inutile (texte)"];
  for (const scenario of evaluation.scenarios) {
    const order = VARIANTS.map((v) => v.id).sort(() => r() - 0.5);
    key[scenario.id] = {};
    order.forEach((id, i) => {
      key[scenario.id][codes[i]] = id;
      const result = evaluation.results[scenario.id][id];
      (result?.top ?? []).forEach((p, rank) => rows.push([scenario.id, scenario.brief, codes[i], String(rank + 1), p.name, p.price === null ? "" : String(p.price), p.summary, "", "", "", "", ""].map((c) => `"${c.replace(/"/g, '""')}"`).join(";")));
    });
  }
  return { csv: rows.join("\n") + "\n", key };
}

export function automaticMetrics(evaluation: Evaluation) {
  const out: Record<string, unknown> = {};
  for (const variant of VARIANTS) {
    const rows = evaluation.scenarios.map((s) => evaluation.results[s.id][variant.id]).filter(Boolean);
    const withWishes = rows.filter((x) => x.wishes > 0);
    const ms = rows.map((x) => x.ms).sort((a, b) => a - b);
    out[variant.id] = {
      label: variant.label, scenarios: rows.length,
      preferenceSatisfaction: withWishes.length ? withWishes.reduce((s, x) => s + x.satisfied / x.wishes, 0) / withWishes.length : null,
      engineLoss: rows.reduce((s, x) => s + (x.engineLoss ?? 0), 0) / Math.max(rows.length, 1),
      diversity: new Set(rows.map((x) => x.top[0]?.id)).size / Math.max(rows.length, 1),
      latencyMs: { median: ms[Math.floor(ms.length / 2)], p90: ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.9))] },
      degradedRuns: rows.filter((x) => x.degraded.length).length,
    };
  }
  return out;
}
