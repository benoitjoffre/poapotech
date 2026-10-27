import assert from "node:assert/strict";
import { test } from "node:test";
import { productionEnvProblems } from "../src/services/productionEnv";

const valid = {
  NODE_ENV: "production", DATABASE_URL: "postgres://x", JWT_SECRET: "a".repeat(40), AI_SERVICE_URL: "https://poapo-ai.onrender.com",
  AI_SERVICE_TOKEN: "t", FRONTEND_URL: "https://w.onrender.com", ADMIN_URL: "https://a.onrender.com",
  AUTH0_DOMAIN: "poapo.eu.auth0.com", AUTH0_AUDIENCE: "https://api.poapo.app",
} as NodeJS.ProcessEnv;

test("production : variables obligatoires et valeurs d'exemple refusées", () => {
  assert.deepEqual(productionEnvProblems(valid), []);
  assert.deepEqual(productionEnvProblems({ NODE_ENV: "development" } as NodeJS.ProcessEnv), []);
  assert.equal(productionEnvProblems({ NODE_ENV: "production" } as NodeJS.ProcessEnv).length, 8);
  assert.match(productionEnvProblems({ ...valid, JWT_SECRET: "change_me_to_a_long_random_string_in_production" }).join(), /JWT_SECRET/);
  assert.match(productionEnvProblems({ ...valid, JWT_SECRET: "court" }).join(), /JWT_SECRET/);
  assert.match(productionEnvProblems({ ...valid, ADMIN_URL: "http://localhost:5174" }).join(), /ADMIN_URL/);
});
