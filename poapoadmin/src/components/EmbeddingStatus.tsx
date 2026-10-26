import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

interface Summary { total: number; ready: number; pending: number; processing: number; failed: number; lastError: string | null }

/** État réel de la préparation des recommandations d'un catalogue (suivi tant qu'elle n'est pas terminée). */
export default function EmbeddingStatus({ catalogId }: { catalogId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setSummary(await apiFetch<Summary>(`/api/catalog/embeddings?catalogId=${encodeURIComponent(catalogId)}`));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [catalogId]);

  useEffect(() => { void load(); }, [load]);
  const waiting = summary ? summary.pending + summary.processing : 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  const retry = async () => {
    try {
      await apiFetch(`/api/catalog/embeddings/retry`, { method: "POST", body: JSON.stringify({ catalogId }) });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (error) return <p className="import-warn">⚠ État de la préparation indisponible : {error}</p>;
  if (!summary) return null;
  return (
    <div role="status">
      <p className="import-info">
        Préparation des recommandations : {summary.ready} / {summary.total} produit(s) prêt(s)
        {waiting > 0 && ` — ${waiting} en cours ou en attente (reprise automatique si le moteur est arrêté)`}.
      </p>
      {summary.failed > 0 && (
        <p className="import-warn">
          ⚠ {summary.failed} produit(s) en échec{summary.lastError ? ` (${summary.lastError})` : ""}. Ils ne sont pas prêts pour la recommandation sémantique.{" "}
          <button type="button" className="btn-secondary" onClick={() => void retry()}>Relancer</button>
        </p>
      )}
    </div>
  );
}
