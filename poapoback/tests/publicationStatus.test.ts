import assert from "node:assert/strict";
import { test } from "node:test";
import { canPublishAndActivate, publicationStatus, type ServerPublicationState } from "../../poapoadmin/src/lib/publicationStatus";

const live: ServerPublicationState = { shopActive: true, accessible: true, questionCount: 3, hasDraft: false };

test("première publication : rien en ligne → brouillon non publié, jamais « Publié »", () => {
  const s = publicationStatus({ ...live, accessible: false, questionCount: 0, hasDraft: true }, false);
  assert.equal(s.id, "unpublished");
  assert.doesNotMatch(s.label, /^Publié/);
  assert.equal(canPublishAndActivate(s, true), true);
});

test("enregistrement sans publication : brouillon enregistré sur une version publiée → modifications non publiées", () => {
  assert.equal(publicationStatus({ ...live, hasDraft: true }, false).id, "changes");
});

test("modifications locales non enregistrées → modifications non publiées", () => {
  assert.equal(publicationStatus(live, true).id, "changes");
});

test("publié et accessible : rien à publier", () => {
  const s = publicationStatus(live, false);
  assert.equal(s.id, "live");
  assert.equal(canPublishAndActivate(s, true), false);
});

test("quiz désactivé : publié mais désactivé, republication possible", () => {
  const s = publicationStatus({ ...live, accessible: false }, false);
  assert.equal(s.id, "disabled");
  assert.equal(s.reason, "Quiz désactivé");
  assert.equal(canPublishAndActivate(s, true), true);
});

test("boutique désactivée : l'action ne peut pas corriger, la raison est indiquée", () => {
  const s = publicationStatus({ shopActive: false, accessible: false, questionCount: 3, hasDraft: false }, false);
  assert.equal(s.id, "disabled");
  assert.equal(s.reason, "Boutique désactivée");
  assert.equal(canPublishAndActivate(s, false), false);
});

test("la présence d'une campagne n'intervient pas dans le statut", () => {
  assert.deepEqual(publicationStatus(live, false), publicationStatus({ ...live }, false));
});
