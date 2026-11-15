import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";

export interface EmbeddingReadiness {
  total: number; ready: number; pending: number; processing: number; failed: number; lastError: string | null;
}

/** Les recommandations ne sont annoncées prêtes que lorsque tous les produits du catalogue ont leur préparation terminée. */
export function readinessState(r: EmbeddingReadiness | null): "unknown" | "ready" | "preparing" | "failed" {
  if (!r) return "unknown";
  if (r.total === 0 || r.ready >= r.total) return "ready";
  return r.failed > 0 && r.pending + r.processing === 0 ? "failed" : "preparing";
}

export function readinessText(r: EmbeddingReadiness | null): string {
  switch (readinessState(r)) {
    case "unknown": return "Vérification de la préparation des recommandations…";
    case "ready": return "Calcul terminé : tous vos produits sont pris en compte dans l'aperçu.";
    case "failed": return `La préparation a échoué pour ${r!.failed} produit(s). Relancez-la pour obtenir des recommandations.`;
    default: return `Préparation des recommandations en cours : ${r!.ready} produit(s) prêt(s) sur ${r!.total}. Les résultats ne sont pas fiables avant la fin.`;
  }
}

/** Relit l'état de préparation (embeddings) toutes les 3 s tant qu'il n'est pas terminé. */
export function useEmbeddingReadiness(catalogId: string, active: boolean) {
  const [readiness, setReadiness] = useState<EmbeddingReadiness | null>(null);
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!active || !catalogId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const next = await apiFetch<EmbeddingReadiness>(`/api/catalog/embeddings?catalogId=${encodeURIComponent(catalogId)}`);
        if (cancelled) return;
        setReadiness(next);
        if (readinessState(next) === "preparing") timer.current = setTimeout(() => void load(), 3000);
      } catch { if (!cancelled) timer.current = setTimeout(() => void load(), 6000); }
    };
    void load();
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [catalogId, active, tick]);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const retry = useCallback(async () => {
    await apiFetch(`/api/catalog/embeddings/retry`, { method: "POST", body: JSON.stringify({ catalogId }) });
    setTick((value) => value + 1);
  }, [catalogId]);
  return { readiness, refresh, retry };
}
