import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuizPeriod } from "../src/services/quizPeriod";

const empty = { occasion: null, occasionLabel: null, startsAt: null, endsAt: null } as const;

test("période : occasion, dates et effacement", () => {
  const set = parseQuizPeriod({ occasion: "CHRISTMAS", startsAt: "2026-12-01T00:00:00.000Z", endsAt: "2026-12-24T23:59:59.000Z" }, empty) as Record<string, unknown>;
  assert.equal(set.occasion, "CHRISTMAS");
  assert.equal(set.occasionLabel, null);
  const cleared = parseQuizPeriod({ occasion: null, startsAt: null, endsAt: null }, { ...empty, occasion: "CHRISTMAS", startsAt: new Date() }) as Record<string, unknown>;
  assert.equal(cleared.occasion, null);
  assert.equal(cleared.startsAt, null);
});

test("période : validations", () => {
  assert.throws(() => parseQuizPeriod({ occasion: "NOPE" }, empty), /Occasion invalide/);
  assert.throws(() => parseQuizPeriod({ occasion: "CUSTOM" }, empty), /Précisez le nom/);
  assert.throws(() => parseQuizPeriod({ startsAt: "2026-12-24", endsAt: "2026-12-01" }, empty), /postérieure/);
  assert.throws(() => parseQuizPeriod({ startsAt: "pas une date" }, empty), /date valide/);
  const custom = parseQuizPeriod({ occasion: "CUSTOM", occasionLabel: "  Soldes d'été " }, empty) as Record<string, unknown>;
  assert.equal(custom.occasionLabel, "Soldes d'été");
});
