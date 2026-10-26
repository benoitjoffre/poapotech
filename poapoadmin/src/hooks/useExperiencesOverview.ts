import { useCallback, useEffect, useState } from "react";
import type { ExperiencesOverview } from "@poapo/types";
import { apiFetch } from "../lib/api";

/** Synthèse des expériences (une seule requête, isolée par tenant) : accessibilité, brouillons, campagnes partagées, statistiques. */
export function useExperiencesOverview() {
  const [overview, setOverview] = useState<ExperiencesOverview | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    apiFetch<ExperiencesOverview>("/api/experiences")
      .then((data) => { if (!cancelled) setOverview(data); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Impossible de charger les expériences."); });
    return () => { cancelled = true; };
  }, [attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { overview, error, reload };
}
