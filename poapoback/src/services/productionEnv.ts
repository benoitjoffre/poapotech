const REQUIRED = ["DATABASE_URL", "JWT_SECRET", "AI_SERVICE_URL", "AI_SERVICE_TOKEN", "FRONTEND_URL", "ADMIN_URL", "AUTH0_DOMAIN", "AUTH0_AUDIENCE"] as const;
const PLACEHOLDER = /change_me|changeme|secret$/i;

/** Problèmes de configuration bloquants en production (liste vide hors production ou si tout est correct). */
export function productionEnvProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const problems: string[] = REQUIRED.filter((key) => !env[key]?.trim()).map((key) => `${key} manquante`);
  const jwt = env.JWT_SECRET?.trim();
  if (jwt && (jwt.length < 32 || PLACEHOLDER.test(jwt))) problems.push("JWT_SECRET trop court (32 caractères minimum) ou valeur d'exemple");
  for (const key of ["AI_SERVICE_URL", "FRONTEND_URL", "ADMIN_URL"] as const) {
    if (env[key]?.split(",").some((value) => /localhost|127\.0\.0\.1/.test(value))) problems.push(`${key} pointe vers localhost`);
  }
  return problems;
}

export function assertProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  const problems = productionEnvProblems(env);
  if (problems.length) throw new Error(`Configuration de production invalide : ${problems.join(" ; ")}`);
}
