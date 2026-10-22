import type { AxisEstimate, AxisEstimateConfidence, EnrichmentProduct, ProductEnrichmentResult, ProductEnrichmentUpdate } from "@poapo/types";

export const CONFIDENCE_LABELS: Record<AxisEstimateConfidence, string> = {
  low: "Confiance faible",
  medium: "Confiance moyenne",
  high: "Confiance élevée",
};

/** Décision du commerçant pour une estimation : valeur (modifiable) et validation explicite. */
export interface AxisDecision {
  value: string;
  accepted: boolean;
}

export type ProductDecisions = Record<string, AxisDecision>;

export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/** Une valeur existante (même invalide) doit être remplacée explicitement. */
export function hasExistingValue(product: EnrichmentProduct | undefined, result: ProductEnrichmentResult, axis: string): boolean {
  return result.currentValues[axis] !== null || !!product?.invalidAxes.includes(axis);
}

/**
 * Validation par défaut : seules les valeurs manquantes estimées avec une confiance moyenne ou élevée sont pré-cochées.
 * Une valeur existante n'est jamais pré-cochée pour remplacement.
 */
export function defaultDecision(estimate: AxisEstimate, existing: boolean): AxisDecision {
  const value = estimate.value === null ? "" : String(estimate.value);
  return { value, accepted: !existing && estimate.status === "estimated" && estimate.confidence !== "low" };
}

export function buildUpdates(
  results: ProductEnrichmentResult[],
  decisions: Record<string, ProductDecisions>,
  products: Map<string, EnrichmentProduct>,
): ProductEnrichmentUpdate[] {
  const updates: ProductEnrichmentUpdate[] = [];
  for (const result of results) {
    const update: ProductEnrichmentUpdate = { productId: result.productId, values: {}, expected: {}, overwrite: [] };
    for (const [axis, decision] of Object.entries(decisions[result.productId] ?? {})) {
      if (!decision.accepted || decision.value === "") continue;
      update.values[axis] = Number(decision.value);
      update.expected[axis] = result.currentValues[axis];
      if (hasExistingValue(products.get(result.productId), result, axis)) update.overwrite.push(axis);
    }
    if (Object.keys(update.values).length) updates.push(update);
  }
  return updates;
}

export function summarizeUpdates(updates: ProductEnrichmentUpdate[]) {
  const values = updates.reduce((sum, update) => sum + Object.keys(update.values).length, 0);
  const replaced = updates.reduce((sum, update) => sum + update.overwrite.length, 0);
  return { products: updates.length, added: values - replaced, replaced };
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}
