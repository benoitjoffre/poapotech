import { prisma } from "../lib/prisma";

export type DependencyState = "ok" | "down" | "not_configured";

export interface Readiness {
  /** Prêt à servir l'administration et le widget : seule la base est bloquante. */
  ready: boolean;
  database: DependencyState;
  /** Moteur Python (recommandation, embeddings, génération) : dégradé s'il est arrêté, jamais bloquant pour l'API. */
  ai: DependencyState;
}

async function probe(url: string, timeoutMs: number): Promise<DependencyState> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? "ok" : "down";
  } catch {
    return "down";
  }
}

export async function checkReadiness(env: NodeJS.ProcessEnv = process.env): Promise<Readiness> {
  const database = await Promise.race<DependencyState>([
    prisma.$queryRaw`SELECT 1`.then(() => "ok" as const, () => "down" as const),
    new Promise<DependencyState>((resolve) => setTimeout(() => resolve("down"), 3000).unref()),
  ]);
  const ai: DependencyState = env.AI_SERVICE_URL ? await probe(`${env.AI_SERVICE_URL}/ready`, 3000) : "not_configured";
  return { ready: database === "ok", database, ai };
}
