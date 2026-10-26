import type { NextFunction, Request, Response } from "express";

/** Endpoints appelés par le navigateur des visiteurs depuis le widget : sans cookie, ouverts à toute origine. */
const PUBLIC_ROUTES = new Set([
  "GET /api/embed/config",
  "GET /api/quiz/questions",
  "POST /api/quiz/submit",
  "POST /api/quiz/track",
  "POST /api/quiz/feedback",
  "GET /health",
  "GET /ready",
]);

export function isPublicRoute(method: string, path: string): boolean {
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const verb = method === "OPTIONS" ? "" : method;
  return PUBLIC_ROUTES.has(`${verb} ${normalized}`);
}

/** Origines autorisées pour l'administration : FRONTEND_URL et ADMIN_URL, plusieurs valeurs séparées par des virgules. */
export function adminOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.FRONTEND_URL ?? "http://localhost:5173", env.ADMIN_URL ?? "http://localhost:5174"]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/**
 * Public : Access-Control-Allow-Origin "*" sans credentials (l'API publique n'utilise ni cookie ni jeton).
 * Administration : origine de la liste uniquement, credentials autorisés ; toute autre origine navigateur est refusée (403).
 * Les requêtes sans Origin (curl, serveur à serveur) passent : l'authentification Bearer reste exigée par les routes.
 */
export function corsPolicy(env: NodeJS.ProcessEnv = process.env) {
  const allowed = adminOrigins(env);
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const preflight = req.method === "OPTIONS";
    const requested = preflight ? String(req.headers["access-control-request-method"] ?? "") : req.method;
    res.vary("Origin");
    if (!origin) return preflight ? void res.sendStatus(204) : next();

    if (isPublicRoute(requested, req.path)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    } else if (allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
      res.status(403).json({ error: "Origine non autorisée" });
      return;
    }
    if (preflight) {
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", String(req.headers["access-control-request-headers"] ?? "Content-Type"));
      res.setHeader("Access-Control-Max-Age", "600");
      res.sendStatus(204);
      return;
    }
    next();
  };
}
