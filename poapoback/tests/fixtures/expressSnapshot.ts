import type { ExpressDraft, QuizAxis } from "@poapo/types";
import { type ExpressContext, proposeExpressQuiz } from "../../src/services/expressQuiz";
import { computeProfile } from "../../src/services/scoring";
import { ALL_FIXTURES } from "./catalogProfileFixtures";

/** Même formule que poapoai/main.py generic_attribute_score (partie axes seulement ; le moteur Python n'est pas exécuté). */
function axisScore(profile: Record<string, number>, attributes: Record<string, unknown>): number {
  const shared = Object.entries(attributes).filter(([k, v]) => k in profile && typeof v === "number") as [string, number][];
  if (!shared.length) return 0;
  return 1 - Math.sqrt(shared.reduce((sum, [k, v]) => sum + (profile[k] - v) ** 2, 0)) / Math.sqrt(shared.length);
}

function simulate(draft: ExpressDraft, ctx: ExpressContext, pick: (n: number) => number): string[] {
  const axes: QuizAxis[] = draft.axes;
  const profile = computeProfile(axes, draft.questions.map((q) => q.answers[pick(q.answers.length)].impacts));
  return [...ctx.products]
    .sort((a, b) => axisScore(profile, b.attributes as Record<string, unknown>) - axisScore(profile, a.attributes as Record<string, unknown>) || a.id.localeCompare(b.id))
    .slice(0, 3).map((p) => p.id);
}

const VARIANTS = [{}, { questionCount: 3 }, { questionCount: 5 }, { questionCount: 7 }, { sector: "generic" }] as const;

/** Tout ce que la génération produit, hors `analysis.columns` (ajout du lot 10B). */
export function snapshotAll() {
  const out: Record<string, unknown> = {};
  for (const [name, build] of Object.entries(ALL_FIXTURES)) {
    out[name] = VARIANTS.map((options) => {
      const ctx = build();
      const proposal = proposeExpressQuiz(ctx, options as never);
      const { columns: _columns, ...analysis } = proposal.analysis as typeof proposal.analysis & { columns?: unknown };
      const top = proposal.draft
        ? { first: simulate(proposal.draft, ctx, () => 0), last: simulate(proposal.draft, ctx, (n) => n - 1) }
        : null;
      return JSON.parse(JSON.stringify({ options, analysis, draft: proposal.draft, alternatives: proposal.alternatives, top3Simulated: top }));
    });
  }
  return out;
}
