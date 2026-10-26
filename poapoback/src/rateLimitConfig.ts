export const DEFAULT_GLOBAL_RATE_LIMIT = 200;

/** Limite globale par IP. Le plafond peut être relevé pour des recettes isolées, jamais en production. */
export function globalRateLimitMax(env: NodeJS.ProcessEnv = process.env): number {
  if (env.NODE_ENV === "production") return DEFAULT_GLOBAL_RATE_LIMIT;
  const override = Number(env.POAPO_RATE_LIMIT_MAX);
  return Number.isInteger(override) && override > 0 ? override : DEFAULT_GLOBAL_RATE_LIMIT;
}
