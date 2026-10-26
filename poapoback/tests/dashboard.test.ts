import assert from "node:assert/strict";
import { test } from "node:test";
import type { DashboardExperience } from "@poapo/types";
import { selectNextAction } from "../src/services/dashboard";

const experience = (id: string, patch: Partial<DashboardExperience> = {}): DashboardExperience => ({
  id, name: id, catalog: { id: "catalog", name: "Catalogue" }, accessible: true, hasDraft: false,
  draftUpdatedAt: null, correction: null, started: 0, completed: 0, productClicks: 0, ...patch,
});

test("accueil : création sans expérience et sans correction", () => {
  assert.deepEqual(selectNextAction([]), { kind: "create", quizId: null });
  assert.deepEqual(selectNextAction([experience("active")]), { kind: "create", quizId: null });
});

test("accueil : brouillon le plus récent prioritaire, égalités départagées par identifiant", () => {
  const a = experience("a", { hasDraft: true, draftUpdatedAt: "2026-10-23T12:00:00.000Z" });
  const b = experience("b", { hasDraft: true, draftUpdatedAt: a.draftUpdatedAt });
  const old = experience("old", { hasDraft: true, draftUpdatedAt: "2026-10-22T12:00:00.000Z" });
  const incomplete = experience("incomplete", { correction: "Aucun produit actif recommandable." });
  assert.deepEqual(selectNextAction([incomplete, old, b, a]), { kind: "draft", quizId: "a" });
  assert.deepEqual(selectNextAction([a, b, old, incomplete]), { kind: "draft", quizId: "a" });
});

test("accueil : désactivation seule non assimilée à une erreur", () => {
  assert.deepEqual(selectNextAction([experience("inactive", { accessible: false })]), { kind: "create", quizId: null });
  assert.deepEqual(selectNextAction([experience("inactive", { accessible: false }),
    experience("missing", { correction: "Aucune question active." })]), { kind: "correction", quizId: "missing" });
});
