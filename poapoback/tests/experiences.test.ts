import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExperienceListItem } from "@poapo/types";
import {
  campaignCountLabel, filterExperiences, sortExperiences, totalsOf, type ExperienceFilters,
} from "../../poapoadmin/src/lib/experiences";

const item = (id: string, patch: Partial<ExperienceListItem> = {}): ExperienceListItem => ({
  id, name: id, quizTitle: id, industry: "", isDefault: false, catalog: { id: "c1", name: "Principal" },
  accessible: true, questionCount: 3, hasDraft: false, draftUpdatedAt: null, correction: null,
  updatedAt: "2026-10-01T00:00:00.000Z", lastModifiedAt: "2026-10-01T00:00:00.000Z", stats: null, campaigns: [], ...patch,
});
const none: ExperienceFilters = { query: "", availability: "all", draft: "all", catalogId: "" };
const ids = (items: ExperienceListItem[]) => items.map((entry) => entry.id);

const sample = [
  item("a", { name: "Café du matin", hasDraft: true }),
  item("b", { name: "Idées cadeaux", accessible: false, catalog: { id: "c2", name: "Second" } }),
  item("c", { name: "Ma routine beauté", hasDraft: true, accessible: false }),
];

test("expériences : recherche insensible à la casse et aux accents", () => {
  assert.deepEqual(ids(filterExperiences(sample, { ...none, query: "CAFE" })), ["a"]);
  assert.deepEqual(ids(filterExperiences(sample, { ...none, query: " idees " })), ["b"]);
  assert.deepEqual(ids(filterExperiences(sample, { ...none, query: "zzz" })), []);
  assert.deepEqual(ids(filterExperiences([], none)), []);
});

test("expériences : filtres de disponibilité, de brouillon et de catalogue combinés", () => {
  assert.deepEqual(ids(filterExperiences(sample, { ...none, availability: "accessible" })), ["a"]);
  assert.deepEqual(ids(filterExperiences(sample, { ...none, availability: "inactive" })), ["b", "c"]);
  assert.deepEqual(ids(filterExperiences(sample, { ...none, draft: "with" })), ["a", "c"]);
  assert.deepEqual(ids(filterExperiences(sample, { ...none, draft: "without" })), ["b"]);
  assert.deepEqual(ids(filterExperiences(sample, { ...none, availability: "inactive", draft: "with" })), ["c"]);
  assert.deepEqual(ids(filterExperiences(sample, { ...none, catalogId: "c2" })), ["b"]);
});

test("expériences : tri par modification (égalités par nom) ou par nom, sans muter l'entrée", () => {
  const list = [
    item("x", { name: "Zèbre", lastModifiedAt: "2026-10-02T00:00:00.000Z" }),
    item("y", { name: "Abeille", lastModifiedAt: "2026-10-03T00:00:00.000Z" }),
    item("z", { name: "Éléphant", lastModifiedAt: "2026-10-02T00:00:00.000Z" }),
  ];
  assert.deepEqual(ids(sortExperiences(list, "recent")), ["y", "z", "x"]);
  assert.deepEqual(ids(sortExperiences(list, "name")), ["y", "z", "x"]);
  assert.deepEqual(ids(list), ["x", "y", "z"]);
});

test("expériences : totaux sans chiffres inventés quand les statistiques sont absentes", () => {
  assert.deepEqual(totalsOf([]), { accessible: 0, started: 0, completed: 0 });
  assert.deepEqual(totalsOf([item("a"), item("b", { accessible: false, stats: { started: 4, completed: 2, productClicks: 1 } })]),
    { accessible: 1, started: 4, completed: 2 });
  assert.equal(campaignCountLabel(0), "Aucune campagne");
  assert.equal(campaignCountLabel(1), "1 campagne");
  assert.equal(campaignCountLabel(3), "3 campagnes");
});
