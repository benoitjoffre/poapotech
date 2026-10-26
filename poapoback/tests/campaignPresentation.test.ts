import assert from "node:assert/strict";
import { test } from "node:test";
import { canDeleteCampaign, datesProblem, DIFFUSION_NOTE, otherCampaigns, quizAccess, sharedLabel, statusBlockedReason } from "../../poapoadmin/src/lib/campaignExperience";
import { STATUS_LABELS } from "../../poapoadmin/src/lib/campaigns";

test("campagne active n'est jamais présentée comme « en ligne »", () => {
  assert.equal(STATUS_LABELS.ACTIVE, "En cours");
  assert.ok(Object.values(STATUS_LABELS).every((label) => !/en ligne|diffus/i.test(label)));
  assert.match(DIFFUSION_NOTE, /n'activent ni ne désactivent l'accès public/);
});

test("accessibilité du quiz : boutique ET quiz actifs, indépendante de la campagne", () => {
  assert.equal(quizAccess(true, true)?.accessible, true);
  assert.equal(quizAccess(true, false)?.accessible, false);
  assert.equal(quizAccess(false, true)?.accessible, false);
  assert.equal(quizAccess(null, true), null);
  assert.equal(quizAccess(null, false)?.accessible, false);
});

test("partage : décompte des autres campagnes, sans copie", () => {
  const campaigns = [{ id: "a" }, { id: "b" }, { id: "c" }] as never[];
  assert.equal(otherCampaigns({ campaigns } as never, "a").length, 2);
  assert.equal(otherCampaigns(undefined).length, 0);
  assert.equal(sharedLabel(0), "Aucune autre campagne ne l'utilise");
  assert.equal(sharedLabel(1), "Partagée avec 1 autre campagne");
  assert.equal(sharedLabel(2), "Partagée avec 2 autres campagnes");
});

test("règles reflétées du serveur : suppression, dates, quiz inactif", () => {
  assert.equal(canDeleteCampaign("DRAFT"), true);
  assert.equal(canDeleteCampaign("ACTIVE"), false);
  assert.equal(datesProblem("2026-05-02", "2026-05-01") !== null, true);
  assert.equal(datesProblem("", "2026-05-01"), null);
  assert.ok(statusBlockedReason("SCHEDULED", true, ""));
  assert.ok(statusBlockedReason("ACTIVE", false, "2026-01-01"));
  assert.equal(statusBlockedReason("DRAFT", false, ""), null);
  assert.equal(statusBlockedReason("PAUSED", false, ""), null);
  assert.equal(statusBlockedReason("ACTIVE", true, ""), null);
});
