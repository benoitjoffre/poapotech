import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { DashboardSummary } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { homeSteps } from "../lib/journey";

interface Journey {
  summary: DashboardSummary | null;
  loading: boolean;
  error: string;
  reload: () => void;
  /** Titre de l'étape qui vient d'être terminée (affiché quelques secondes). */
  justDone: string | null;
}

/**
 * Mode développement uniquement : `?parcours=1` à `?parcours=4` simule un compte à cette étape du parcours,
 * `?parcours=off` revient aux vraies données. Rien n'est écrit en base ; sans effet en production.
 */
function simulate(data: DashboardSummary, stage: number): DashboardSummary {
  const quiet = { started: 0, completed: 0, productClicks: 0 };
  const experiences = stage <= 2 ? [] : data.experiences.map((item, index) => ({
    ...item, accessible: stage >= 4 && index === 0, hasDraft: stage === 3 ? true : item.hasDraft, started: 0, completed: 0, productClicks: 0,
  }));
  return {
    ...data, experiences, products: stage === 1 ? 0 : Math.max(data.products, 1),
    totals: { ...quiet, accessible: experiences.filter((item) => item.accessible).length },
  };
}
function devStage(): number | null {
  if (!import.meta.env.DEV) return null;
  try {
    const param = new URLSearchParams(window.location.search).get("parcours");
    if (param === "off") sessionStorage.removeItem("poapo_dev_parcours");
    else if (param && /^[1-4]$/.test(param)) sessionStorage.setItem("poapo_dev_parcours", param);
    const stored = sessionStorage.getItem("poapo_dev_parcours");
    return stored ? Number(stored) : null;
  } catch { return null; }
}

const JourneyContext = createContext<Journey>({ summary: null, loading: true, error: "", reload: () => {}, justDone: null });
export const useJourney = () => useContext(JourneyContext);

/** Une seule lecture de l'état du compte, relue à chaque changement de page : le guide reflète toujours la réalité. */
export function JourneyProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const { pathname } = useLocation();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [justDone, setJustDone] = useState<string | null>(null);
  const doneCount = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let cancelled = false;
    setError("");
    apiFetch<DashboardSummary>("/api/dashboard")
      .then((loaded) => {
        if (cancelled) return;
        let data = loaded;
        const stage = devStage();
        if (stage) data = simulate(data, stage);
        const done = homeSteps(data).filter((step) => step.done);
        if (doneCount.current !== null && done.length > doneCount.current) setJustDone(done[done.length - 1].title);
        doneCount.current = done.length;
        setSummary(data);
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Impossible de charger votre accueil."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pathname, attempt, enabled]);

  useEffect(() => {
    if (!justDone) return;
    const timer = window.setTimeout(() => setJustDone(null), 8000);
    return () => window.clearTimeout(timer);
  }, [justDone]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return <JourneyContext.Provider value={{ summary, loading, error, reload, justDone }}>{children}</JourneyContext.Provider>;
}
