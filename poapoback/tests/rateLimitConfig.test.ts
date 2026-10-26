import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_GLOBAL_RATE_LIMIT, globalRateLimitMax } from "../src/rateLimitConfig";

test("la limite globale par défaut reste à 200 requêtes", () => {
  assert.equal(globalRateLimitMax({}), DEFAULT_GLOBAL_RATE_LIMIT);
  assert.equal(DEFAULT_GLOBAL_RATE_LIMIT, 200);
});

test("une recette isolée peut relever la limite hors production", () => {
  assert.equal(globalRateLimitMax({ NODE_ENV: "test", POAPO_RATE_LIMIT_MAX: "100000" }), 100000);
});

test("la production ignore toujours le plafond relevé", () => {
  assert.equal(globalRateLimitMax({ NODE_ENV: "production", POAPO_RATE_LIMIT_MAX: "100000" }), 200);
});

test("une valeur invalide retombe sur la limite par défaut", () => {
  for (const value of ["0", "-5", "abc", "1.5", ""]) assert.equal(globalRateLimitMax({ POAPO_RATE_LIMIT_MAX: value }), 200);
});
