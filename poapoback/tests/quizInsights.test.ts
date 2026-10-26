import assert from "node:assert/strict";
import { test } from "node:test";
import { computeIndicators } from "../src/services/quizMetrics";
import { localInsightsFromSnapshot, type MetricsSnapshot } from "../src/services/quizInsights";

function snapshot(counts: { started: number; completed: number; recommendations: number; productClicks: number }, extra: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  const indicators = computeIndicators(counts);
  return {
    ...counts,
    recentAbandons: 0,
    completionRate: indicators.completionRate,
    clicksPer100Recommendations: indicators.clicksPer100Recommendations,
    consistent: indicators.consistency.consistent,
    topProducts: [],
    unansweredSteps: [],
    ...extra,
  };
}

const FORBIDDEN = [/CTR/i, /feedback/i, /conversion/i, /ventes?\b/i, /chiffre d'affaires/i, /visiteurs/i, /récurrents/i];
const text = (insights: ReturnType<typeof localInsightsFromSnapshot>) => insights.map((i) => `${i.title} ${i.insight} ${i.actions.join(" ")}`).join(" ");

test("low reliable completion is reported with one decimal", () => {
  const insights = localInsightsFromSnapshot(snapshot({ started: 30, completed: 9, recommendations: 9, productClicks: 0 }));
  assert.equal(insights[0].title, "Complétion faible");
  assert.match(insights[0].insight, /30,0 %/);
});

test("unreliable completion is never interpreted as a performance", () => {
  const insights = localInsightsFromSnapshot(snapshot({ started: 3, completed: 5, recommendations: 5, productClicks: 0 }));
  assert.ok(!insights.some((i) => i.title === "Complétion faible"));
  const check = insights.find((i) => i.title === "Données à vérifier");
  assert.ok(check);
  assert.match(check.insight, /Plus de quiz terminés que de démarrages/);
  assert.ok(!/\d+ ?%/.test(text(insights)), "no capped or invented rate");
});

test("inconsistent sessions are flagged", () => {
  const insights = localInsightsFromSnapshot(snapshot({ started: 10, completed: 8, recommendations: 6, productClicks: 0 }));
  assert.match(insights.find((i) => i.title === "Données à vérifier")!.insight, /8 quiz terminés pour 6 recommandations/);
});

test("clicks are presented as indicative, never as CTR or sales", () => {
  const insights = localInsightsFromSnapshot(snapshot({ started: 40, completed: 20, recommendations: 20, productClicks: 2 }));
  const clicks = insights.find((i) => i.title === "Peu de clics produits");
  assert.ok(clicks);
  assert.match(clicks.insight, /10,0 clics produits pour 100 recommandations \(indicatif/);
  for (const pattern of FORBIDDEN) assert.ok(!pattern.test(text(insights)), `no ${pattern}`);
});

test("steps use raw views and answers, healthy data has no forbidden wording", () => {
  const withStep = localInsightsFromSnapshot(snapshot({ started: 10, completed: 8, recommendations: 8, productClicks: 4 }, {
    unansweredSteps: [{ step: "q2", views: 10, answers: 6 }],
  }));
  assert.match(withStep[0].insight, /q2 compte 10 vues pour 6 réponses/);
  const healthy = localInsightsFromSnapshot(snapshot({ started: 10, completed: 8, recommendations: 8, productClicks: 4 }));
  assert.equal(healthy[0].title, "Pas d'alerte");
  for (const pattern of FORBIDDEN) assert.ok(!pattern.test(text(healthy)), `no ${pattern}`);
});
