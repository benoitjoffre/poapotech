import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePlan, planFor, SECTORS, simulatedTable } from "./fixtures/universalComparison";

// Comparaison SIMULÉE (formule des axes + sémantique simulée) : les chiffres avec le vrai modèle sont produits hors suite (poapoai/tools/score_fixtures.py).
const run = (sectorIndex: number, generator: "legacy" | "universal", options = {}, bonus: Parameters<typeof evaluatePlan>[2] = null) => {
  const plan = planFor(SECTORS[sectorIndex], 60, generator, options);
  return evaluatePlan(plan, simulatedTable(plan), bonus, generator);
};
const lambda1 = { kind: "window_spread", lambda: 1 } as const;

test("avant/après : le générateur universel dépasse l'historique sur Top 1 et satisfaction des préférences, dans chaque secteur", () => {
  SECTORS.forEach((sector, i) => {
    const before = run(i, "legacy");
    const after = run(i, "universal", {}, lambda1);
    assert.ok(after.top1 > before.top1, `${sector.name} top1 ${before.top1} → ${after.top1}`);
    assert.ok(after.intentSat > before.intentSat, `${sector.name} satisfaction ${before.intentSat} → ${after.intentSat}`);
    assert.ok(after.criteria > before.criteria - 1, `${sector.name} critères couverts`);
    assert.equal(after.ablationNoEffect, 0, "aucune question à effets engagée sans effet sur les résultats");
  });
});

test("plafond strict : zéro dépassement, aucun produit hors plafond recommandé", () => {
  SECTORS.forEach((sector, i) => {
    const strict = run(i, "universal", { strictBudget: true }, lambda1);
    assert.equal(strict.violations, 0, sector.name);
    assert.ok(strict.capVisitors > 0);
    assert.ok(run(i, "legacy").violations > 0, "le générateur historique ne peut pas garantir un plafond");
  });
});

test("les deux formules de bonus restent déterministes et la formule par défaut n'est pas modifiée", () => {
  const a = run(0, "universal", {}, lambda1);
  assert.deepEqual(a, run(0, "universal", {}, lambda1));
  const experimental = run(0, "universal", {}, { kind: "constant", beta: 0.15 });
  assert.equal(experimental.questions, a.questions);
});
