import assert from "node:assert/strict";
import { test } from "node:test";
import { fillDaily, parseResultsFilters, previousWindow, sumCounts } from "../src/services/results";
import { buildQuestionStats } from "../src/services/resultsDetail";

const now = new Date("2026-05-30T12:00:00.000Z");

test("filtres : 30 jours par défaut, validation des dates et des identifiants", () => {
  const f = parseResultsFilters({}, now);
  assert.equal(f.days, 30);
  assert.equal(f.to.toISOString(), "2026-05-31T00:00:00.000Z");
  assert.equal(f.from.toISOString(), "2026-05-01T00:00:00.000Z");
  assert.throws(() => parseResultsFilters({ from: "nope" }, now), /invalide/);
  assert.throws(() => parseResultsFilters({ from: "2026-05-30", to: "2026-05-01" }, now), /précéder/);
  assert.throws(() => parseResultsFilters({ from: "2020-01-01", to: "2026-01-01" }, now), /366/);
  assert.throws(() => parseResultsFilters({ quizId: ["a"] }, now), /invalide/);
  assert.equal(parseResultsFilters({ quizId: "q1", catalogId: "c1" }, now).catalogId, "c1");
});

test("fenêtre précédente de même durée et série quotidienne complétée", () => {
  const f = parseResultsFilters({ from: "2026-05-08T00:00:00Z", to: "2026-05-15T00:00:00Z" }, now);
  const prev = previousWindow(f);
  assert.equal(prev.to.toISOString(), f.from.toISOString());
  assert.equal(prev.to.getTime() - prev.from.getTime(), f.to.getTime() - f.from.getTime());
  const daily = fillDaily(f.from, f.to, new Map([["2026-05-10", { started: 3, completed: 2, recommendations: 2, productClicks: 1 }]]));
  assert.equal(daily.length, 7);
  assert.equal(daily[2].started, 3);
  assert.equal(daily[0].started, 0);
});

test("périodes : exactement N jours UTC, [from, to[, séries et période précédente alignées", () => {
  const cases = ["2026-05-30T12:00:00Z", "2026-03-01T00:00:00Z", "2026-01-01T00:00:00Z", "2024-03-01T23:59:59Z", "2026-12-31T23:59:59.999Z"];
  for (const at of cases) for (const n of [7, 30, 90]) {
    const to = new Date(Date.UTC(new Date(at).getUTCFullYear(), new Date(at).getUTCMonth(), new Date(at).getUTCDate() + 1));
    const f = parseResultsFilters({ from: new Date(to.getTime() - n * 86400000).toISOString(), to: to.toISOString() }, new Date(at));
    assert.equal(f.days, n);
    const daily = fillDaily(f.from, f.to, new Map());
    assert.equal(daily.length, n, `${at} ${n}`);
    assert.equal(daily[n - 1].date, new Date(at).toISOString().slice(0, 10));
    const prev = previousWindow(f);
    assert.equal(fillDaily(prev.from, prev.to, new Map()).length, n);
    assert.equal(prev.to.getTime(), f.from.getTime());
    const dflt = parseResultsFilters({}, new Date(at));
    assert.equal(fillDaily(dflt.from, dflt.to, new Map()).length, 30);
  }
  // Un instant en milieu de journée est élargi aux jours UTC entiers.
  const f = parseResultsFilters({ from: "2026-05-01T10:00:00Z", to: "2026-05-08T10:00:00Z" }, now);
  assert.equal(f.from.toISOString(), "2026-05-01T00:00:00.000Z");
  assert.equal(f.to.toISOString(), "2026-05-09T00:00:00.000Z");
  assert.equal(f.days, 8);
});

test("sumCounts additionne chaque quiz une seule fois", () => {
  const total = sumCounts([
    { started: 2, completed: 1, recommendations: 1, productClicks: 0 },
    { started: 3, completed: 2, recommendations: 2, productClicks: 4 },
  ]);
  assert.deepEqual(total, { started: 5, completed: 3, recommendations: 3, productClicks: 4 });
});

test("questions : libellés fiables, étapes inconnues ignorées et comptées à part", () => {
  const questions = [
    { id: "q1", text: "Quel voyage ?", answers: [{ id: "a1", text: "Plage" }, { id: "a2", text: "Ville" }] },
    { id: "q2", text: "Budget ?", answers: [{ id: "a3", text: "Petit" }] },
  ];
  const result = buildQuestionStats([
    { questionId: "q2", answerId: null, type: "step_view", count: 4 },
    { questionId: "q1", answerId: null, type: "step_view", count: 10 },
    { questionId: "q1", answerId: "a1", type: "step_answer", count: 3 },
    { questionId: "q1", answerId: "a2", type: "step_answer", count: 5 },
    { questionId: "q1", answerId: "gone", type: "step_answer", count: 1 },
    { questionId: "legacy-step", answerId: null, type: "step_view", count: 9 },
  ], questions);
  assert.deepEqual(result.questions.map((q) => q.label), ["Quel voyage ?", "Budget ?"]);
  assert.equal(result.questions[0].answers, 9);
  assert.deepEqual(result.questions[0].options.map((o) => o.label), ["Ville", "Plage"]);
  assert.equal(result.unmatchedSteps, 1);
});
