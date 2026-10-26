import type { QuizAxis } from "@poapo/types";
import { prisma } from "../lib/prisma";
import { computeProfile } from "./scoring";
import { QuizError } from "./quizzes";

/** Le modèle est chargé au démarrage de poapoai : au-delà de ce délai le service est considéré indisponible. */
export const RECOMMEND_TIMEOUT_MS = 10_000;

export interface RecommendationInput {
  tenantId: string;
  catalogId: string;
  industry: string;
  axes: QuizAxis[];
  productIds?: string[];
  impacts: unknown[];
}

/** Shared by public submission and read-only authenticated preview. No writes here. */
export async function recommendQuiz(input: RecommendationInput) {
  const aiUrl = process.env.AI_SERVICE_URL;
  if (!aiUrl) throw new QuizError(503, "Service IA non disponible");
  if (input.productIds?.length === 0) throw new QuizError(422, "Aucun produit sélectionné pour ce quiz");
  const { impacts, ...scope } = input;
  const profile = computeProfile(input.axes, impacts);
  let response: Response;
  try {
    response = await fetch(`${aiUrl}/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...scope, profile }),
      signal: AbortSignal.timeout(RECOMMEND_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    console.error("[recommend]", timedOut ? "timeout" : "service unreachable", err);
    throw timedOut
      ? new QuizError(504, "Le moteur de recommandation met trop de temps à répondre. Réessayez dans un instant.")
      : new QuizError(503, "Le moteur de recommandation est momentanément indisponible. Réessayez dans un instant.");
  }
  if (!response.ok) {
    console.error("[recommend] AI service status", response.status);
    throw new QuizError(response.status === 503 ? 503 : 502, "Le moteur de recommandation n'a pas pu calculer le résultat. Réessayez dans un instant.");
  }
  const { productId, explanation, profileSummary } = await response.json() as {
    productId: string; explanation: string[]; profileSummary: Record<string, unknown>;
  };
  if (input.productIds && !input.productIds.includes(productId)) {
    throw new QuizError(502, "Le produit recommandé ne fait pas partie de ce quiz");
  }
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId: input.tenantId, catalogId: input.catalogId, active: true },
    select: {
      id: true, name: true, brand: true, description: true, price: true,
      imageUrl: true, purchaseUrl: true, tags: true, attributes: true,
    },
  });
  if (!product) throw new QuizError(502, "La recommandation renvoyée ne correspond à aucun produit");
  return { product, explanation, profileSummary };
}
