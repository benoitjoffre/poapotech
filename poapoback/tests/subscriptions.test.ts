import assert from "node:assert/strict";
import { test } from "node:test";
import { computeEffective, parsePlanChange } from "../src/services/subscriptions";
import { entitlementsOf, limitReached, parseIdempotencyKey, submissionFingerprint } from "../src/services/entitlements";
import { PLAN_CATALOG } from "../src/services/planCatalog";

const base = { plan: "PRO", status: "ACTIVE", source: "PROMO", startsAt: new Date("2026-01-01"), endsAt: null } as const;

test("plan effectif : promo valide, expirée, annulée, pas encore commencée, absente", () => {
  const now = new Date("2026-06-01");
  assert.deepEqual([computeEffective(base, now).plan, computeEffective(base, now).promotional], ["PRO", true]);
  const expired = computeEffective({ ...base, endsAt: new Date("2026-05-01") }, now);
  assert.deepEqual([expired.plan, expired.status, expired.storedPlan, expired.promotional], ["STARTER", "EXPIRED", "PRO", false]);
  assert.equal(computeEffective({ ...base, endsAt: new Date("2026-06-02") }, now).plan, "PRO");
  assert.equal(computeEffective({ ...base, endsAt: now }, now).plan, "STARTER"); // échéance incluse
  assert.deepEqual([computeEffective({ ...base, status: "CANCELED" }, now).plan, computeEffective({ ...base, status: "CANCELED" }, now).status], ["STARTER", "CANCELED"]);
  assert.equal(computeEffective({ ...base, startsAt: new Date("2026-07-01") }, now).plan, "STARTER");
  assert.equal(computeEffective(null, now).plan, "STARTER");
  assert.equal(computeEffective({ ...base, plan: "BUSINESS", source: "LEGACY" }, now).promotional, false);
});

test("grille des formules : valeurs convenues, BUSINESS illimité", () => {
  assert.deepEqual(PLAN_CATALOG.STARTER.limits, { catalogs: 1, publishedExperiences: 1, recommendationsPerMonth: 100 });
  assert.deepEqual(PLAN_CATALOG.PRO.limits, { catalogs: 5, publishedExperiences: 10, recommendationsPerMonth: 5000 });
  assert.deepEqual(Object.values(PLAN_CATALOG.BUSINESS.limits), [null, null, null]);
  assert.equal(entitlementsOf(computeEffective(null)).features.campaigns, false);
  assert.equal(limitReached(null, 1e9), false);
  assert.equal(limitReached(1, 1), true);
});

test("changement de plan : validation stricte", () => {
  const now = new Date("2026-06-01");
  assert.throws(() => parsePlanChange({ plan: "FREE" }, now), /Plan invalide/);
  assert.throws(() => parsePlanChange({ plan: "PRO", endsAt: "2026-01-01" }, now), /futur/);
  assert.throws(() => parsePlanChange({ plan: "PRO", endsAt: "pas une date" }, now), /invalide/);
  assert.deepEqual(parsePlanChange({ plan: "BUSINESS" }, now), { plan: "BUSINESS", endsAt: null });
  assert.equal(parsePlanChange({ plan: "PRO", endsAt: "2026-12-31" }, now).endsAt?.toISOString().slice(0, 10), "2026-12-31");
});

test("clé d'idempotence et empreinte", () => {
  assert.equal(parseIdempotencyKey(undefined), null);
  assert.equal(parseIdempotencyKey("a".repeat(36)), "a".repeat(36));
  for (const bad of ["court", "a b".repeat(10), 42, "x".repeat(101)]) assert.throws(() => parseIdempotencyKey(bad));
  const a = [{ questionId: "q1", answerId: "a1" }, { questionId: "q2", answerId: "a2" }];
  assert.equal(submissionFingerprint("z", a), submissionFingerprint("z", [...a].reverse()));
  assert.notEqual(submissionFingerprint("z", a), submissionFingerprint("z", [a[0], { questionId: "q2", answerId: "a3" }]));
  assert.notEqual(submissionFingerprint("z", a), submissionFingerprint("y", a));
});
