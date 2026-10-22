export type AiServiceErrorKind = "not_configured" | "unavailable" | "timeout" | "invalid_output";

export class AiServiceError extends Error {
  constructor(public kind: AiServiceErrorKind, message: string, public details: string[] = []) {
    super(message);
    this.name = "AiServiceError";
  }
}

interface AiErrorBody {
  detail?: { code?: string; message?: string; errors?: unknown } | string;
}

/** Appelle le service IA (poapoai) en JSON, avec délai d'attente et erreurs typées. */
export async function callAiService<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const aiUrl = process.env.AI_SERVICE_URL;
  if (!aiUrl) throw new AiServiceError("not_configured", "Service IA non configuré");

  let response: Response;
  try {
    response = await fetch(`${aiUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new AiServiceError("timeout", "Le service IA n'a pas répondu à temps");
    }
    throw new AiServiceError("unavailable", "Service IA injoignable");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AiServiceError(response.ok ? "invalid_output" : "unavailable", "Réponse illisible du service IA");
  }

  if (response.ok) return payload as T;

  const detail = (payload as AiErrorBody | null)?.detail;
  const code = typeof detail === "object" && detail ? detail.code : undefined;
  if (response.status === 504 || code === "ai_timeout") {
    throw new AiServiceError("timeout", "Délai de génération dépassé");
  }
  if (code === "invalid_ai_output") {
    const errors = typeof detail === "object" && Array.isArray(detail.errors) ? detail.errors.map(String) : [];
    throw new AiServiceError("invalid_output", "Réponse IA invalide", errors);
  }
  if (code === "ai_not_configured") throw new AiServiceError("not_configured", "OpenAI non configuré sur le service IA");
  throw new AiServiceError("unavailable", `Erreur du service IA (${response.status})`);
}
