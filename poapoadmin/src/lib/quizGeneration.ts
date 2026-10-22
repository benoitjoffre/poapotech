import type { QuizDraft, QuizGenerationMode, QuizGenerationObjective, QuizGenerationProduct } from "@poapo/types";

export const OBJECTIVE_LABELS: Record<QuizGenerationObjective, { title: string; hint: string }> = {
  GIFT_FINDER: { title: "Trouver un cadeau", hint: "Le client cherche pour quelqu'un d'autre" },
  PRODUCT_DISCOVERY: { title: "Faire découvrir", hint: "Orienter vers le produit le plus adapté à ses goûts" },
  CROSS_SELL: { title: "Vente complémentaire", hint: "Proposer un produit qui complète ses habitudes" },
  HIGHLIGHT_NEW: { title: "Mettre en avant les nouveautés", hint: "Valoriser les nouveaux produits sélectionnés" },
  CLEAR_STOCK: { title: "Écouler le stock", hint: "Mettre en avant les produits à déstocker" },
};

export const OBJECTIVES = Object.keys(OBJECTIVE_LABELS) as QuizGenerationObjective[];

export const MODE_LABELS: Record<QuizGenerationMode, string> = {
  AXES: "Recommandation par axes",
  SEMANTIC: "Repli sémantique",
};

/** Doit rester aligné sur DISCRIMINANT_SPREAD côté backend : purement indicatif ici. */
export const DISCRIMINANT_SPREAD = 0.2;

export function axisSpread(products: QuizGenerationProduct[], key: string): { valued: number; spread: number } {
  const values = products.map((product) => product.axisValues[key]).filter((value): value is number => value !== undefined);
  return { valued: values.length, spread: values.length ? Math.max(...values) - Math.min(...values) : 0 };
}

/** Mode que le backend choisira pour cette sélection, ou null s'il refusera la génération. */
export function expectedMode(products: QuizGenerationProduct[], axisKeys: string[]): QuizGenerationMode | null {
  const discriminant = axisKeys.some((key) => {
    const { valued, spread } = axisSpread(products, key);
    return valued >= 2 && spread >= DISCRIMINANT_SPREAD - 1e-9;
  });
  if (discriminant) return "AXES";
  return products.some((product) => product.hasEmbedding) ? "SEMANTIC" : null;
}

export function formatImpact(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

/** Brouillon envoyé à l'API : les produits visés par l'IA sont indicatifs et ne sont jamais enregistrés. */
export function draftPayload(draft: QuizDraft): QuizDraft {
  return {
    ...draft,
    questions: draft.questions.map((question) => ({
      text: question.text,
      helpText: question.helpText?.trim() ? question.helpText : null,
      answers: question.answers.map((answer) => ({ text: answer.text, emoji: answer.emoji?.trim() ? answer.emoji : null, impacts: answer.impacts })),
    })),
  };
}
