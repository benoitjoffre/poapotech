import assert from "node:assert/strict";
import { test } from "node:test";
import { profileColumns } from "../src/services/catalogProfile";
import { ANSWER_EFFECTS_LIMITS, parseAnswerEffects, validateEffectsAgainstCatalog, validateEffectsWithImpacts } from "../src/services/answerEffects";
import { computeProfile } from "../src/services/scoring";
import { perfumeSeeded } from "./fixtures/selectionFixtures";

const ok = (raw: unknown) => {
  const parsed = parseAnswerEffects(raw);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.errors.join("; "));
  return parsed.value;
};
const bad = (raw: unknown) => {
  const parsed = parseAnswerEffects(raw);
  assert.equal(parsed.ok, false, JSON.stringify(raw));
  return parsed.ok ? [] : parsed.errors.join(" | ");
};

test("absence d'effets : null et undefined = ancien comportement, liste vide", () => {
  assert.deepEqual(ok(null).effects, []);
  assert.deepEqual(ok(undefined).effects, []);
  assert.deepEqual(ok({ v: 1, effects: [] }).effects, []);
});

test("les six cas d'usage sont représentables", () => {
  const value = ok({ v: 1, effects: [
    { type: "category", criterion: "attribute.famille", mode: "soft", values: ["Floral"] },
    { type: "range", criterion: "price", mode: "soft", min: 40, max: 80 },
    { type: "range", criterion: "price", mode: "strict", max: 60 },
    { type: "category", criterion: "attribute.taille", mode: "strict", values: ["M", "L"], onMissing: "exclude" },
  ] });
  assert.equal(value.effects.length, 4);
  assert.deepEqual(ok({ v: 1, effects: [{ type: "axis", axis: "intensite" }] }).effects, [{ type: "axis", axis: "intensite" }]);
  assert.deepEqual(ok({ v: 1, effects: [{ type: "none", criterion: "attribute.famille" }] }).effects[0], { type: "none", criterion: "attribute.famille" });
});

test("validation stricte : version, champs inconnus, mode obligatoire, bornes, caractéristique", () => {
  assert.match(bad({ v: 2, effects: [] }), /Version/);
  assert.match(bad({ v: 1, effects: [], extra: 1 }), /champ inconnu/);
  assert.match(bad({ v: 1, effects: [{ type: "category", criterion: "attribute.x", values: ["a"] }] }), /mode/);
  assert.match(bad({ v: 1, effects: [{ type: "category", criterion: "attribute.x", mode: "soft", values: [] }] }), /valeurs/);
  assert.match(bad({ v: 1, effects: [{ type: "category", criterion: "attribute.x", mode: "soft", values: ["a"], poids: 3 }] }), /champ inconnu/);
  assert.match(bad({ v: 1, effects: [{ type: "range", criterion: "price", mode: "strict" }] }), /min ou max/);
  assert.match(bad({ v: 1, effects: [{ type: "range", criterion: "price", mode: "strict", min: 50, max: 10 }] }), /min supérieur/);
  assert.match(bad({ v: 1, effects: [{ type: "range", criterion: "price", mode: "strict", max: -1 }] }), /négatif/);
  assert.match(bad({ v: 1, effects: [{ type: "range", criterion: "brand", mode: "soft", max: 1 }] }), /plage numérique/);
  assert.match(bad({ v: 1, effects: [{ type: "category", criterion: "name", mode: "soft", values: ["a"] }] }), /invalide/);
  assert.match(bad({ v: 1, effects: [{ type: "category", criterion: "attribute.__proto__", mode: "soft", values: ["a"] }] }), /invalide/);
  assert.match(bad({ v: 1, effects: [{ type: "wizard" }] }), /type inconnu/);
  assert.match(bad({ v: 1, effects: [{ type: "category", criterion: "attribute.x", mode: "soft", values: ["a"], onMissing: "exclude" }] }), /strictes/);
  assert.match(bad("texte"), /objet/);
  assert.match(bad({ v: 1, effects: Array.from({ length: ANSWER_EFFECTS_LIMITS.maxEffects + 1 }, () => ({ type: "none", criterion: "price" })) }), /maximum/);
});

test("compatibilité avec impacts : l'effet d'axe ne duplique pas le delta mais exige un impact", () => {
  const effects = ok({ v: 1, effects: [{ type: "axis", axis: "intensite" }] });
  assert.deepEqual(validateEffectsWithImpacts(effects, { intensite: 0.25 }), []);
  assert.equal(validateEffectsWithImpacts(effects, {}).length, 1);
  assert.equal(validateEffectsWithImpacts(effects, { intensite: 0 }).length, 1);
  // Le profil ne dépend que des impacts : des effets, quels qu'ils soient, ne le changent pas.
  const axes = [{ key: "intensite", label: "Intensité" }];
  assert.deepEqual(computeProfile(axes, [{ intensite: 0.25 }]), { intensite: 0.75 });
});

test("cohérence avec le catalogue : contrainte stricte refusée sur une donnée peu fiable", () => {
  const products = perfumeSeeded(60).map((p, i) => i % 2 ? { ...p, attributes: { ...(p.attributes as object), genre: undefined } } : p);
  const profiles = profileColumns(products, { axisKeys: ["freshness"] });
  const strictGenre = ok({ v: 1, effects: [{ type: "category", criterion: "attribute.genre", mode: "strict", values: ["Femme"] }] });
  assert.match(validateEffectsAgainstCatalog(strictGenre, profiles).join(" "), /Contrainte stricte refusée.*50 %/);
  const softGenre = ok({ v: 1, effects: [{ type: "category", criterion: "attribute.genre", mode: "soft", values: ["Femme"] }] });
  assert.deepEqual(validateEffectsAgainstCatalog(softGenre, profiles), [], "une préférence souple reste acceptée à couverture partielle");
  const strictPrice = ok({ v: 1, effects: [{ type: "range", criterion: "price", mode: "strict", max: 80 }] });
  assert.deepEqual(validateEffectsAgainstCatalog(strictPrice, profiles), []);
  const wrongType = ok({ v: 1, effects: [{ type: "category", criterion: "price", mode: "soft", values: ["50"] }] });
  assert.match(validateEffectsAgainstCatalog(wrongType, profiles).join(" "), /numérique/);
  const unknown = ok({ v: 1, effects: [{ type: "none", criterion: "attribute.inexistant" }] });
  assert.match(validateEffectsAgainstCatalog(unknown, profiles).join(" "), /introuvable/);
  const sku = ok({ v: 1, effects: [{ type: "category", criterion: "attribute.sku", mode: "soft", values: ["1"] }] });
  assert.match(validateEffectsAgainstCatalog(sku, profiles).join(" "), /IDENTIFIER_LIKE/);
});

// ─── Validation de publication ────────────────────────────────────────────────

import type { QuizEditorDraft } from "@poapo/types";
import { inspectQuizStructure } from "../src/services/quizPublicationDiagnostic";

const draftWith = (answers: { impacts: Record<string, number>; effects?: unknown }[]): QuizEditorDraft => ({
  schemaVersion: 1,
  config: { name: "q", catalogId: "c", industry: "", axes: [{ key: "intensite", label: "Intensité", lowLabel: null, highLabel: null }], quizTitle: "t", ctaText: "c", active: true, useAllProducts: true, productIds: [] },
  questions: [{
    id: "q1", text: "Q", helpText: null, imageUrl: null, type: "single", order: 0, active: true, abVariant: null, conditionAnswerId: null,
    answers: answers.map((a, i) => ({ id: `a${i}`, text: `R${i}`, emoji: null, imageUrl: null, active: true, order: i, impacts: a.impacts, ...(a.effects ? { effects: a.effects as never } : {}) })),
  }],
} as QuizEditorDraft);

test("publication : une réponse à effets valides seuls n'est pas « sans effet » ; une réponse inerte l'est toujours", () => {
  const draft = draftWith([
    { impacts: {}, effects: { v: 1, effects: [{ type: "range", criterion: "price", mode: "strict", max: 50 }] } },
    { impacts: {}, effects: { v: 1, effects: [{ type: "none", criterion: "price" }] } },
    { impacts: {} },
    { impacts: { intensite: 0.25 } },
  ]);
  const { errors, warnings } = inspectQuizStructure(draft);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.filter((w) => w.code === "NO_IMPACT").map((w) => w.answerId), ["a2"]);
});

test("publication : effets invalides, axe inconnu ou sans impact = erreurs bloquantes", () => {
  const { errors } = inspectQuizStructure(draftWith([
    { impacts: {}, effects: { v: 1, effects: [{ type: "category", criterion: "attribute.x", values: ["a"] }] } },
    { impacts: {}, effects: { v: 1, effects: [{ type: "axis", axis: "intensite" }] } },
    { impacts: { intensite: 0.25 }, effects: { v: 1, effects: [{ type: "axis", axis: "inconnu" }] } },
  ]));
  assert.deepEqual([...new Set(errors.filter((e) => e.code === "INVALID_EFFECTS").map((e) => e.answerId))].sort(), ["a0", "a1", "a2"]);
});
