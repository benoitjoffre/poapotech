import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { EmbedConfig } from "@poapo/types";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

interface TenantContextValue {
  clientId: string | null;
  quizId: string | null;
  config: EmbedConfig | null;
  loading: boolean;
  error: string;
}

const TenantContext = createContext<TenantContextValue>({
  clientId: null,
  quizId: null,
  config: null,
  loading: false,
  error: "",
});

export function TenantProvider({ children }: { children: ReactNode }) {
  const clientId = new URLSearchParams(window.location.search).get("clientId");
  const requestedQuizId = new URLSearchParams(window.location.search).get("quizId");
  const [config, setConfig] = useState<EmbedConfig | null>(null);
  const [loading, setLoading] = useState(clientId !== null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clientId) return;

    let cancelled = false;

    const load = async () => {
      try {
        const params = new URLSearchParams({ clientId });
        if (requestedQuizId !== null) params.set("quizId", requestedQuizId);
        const res = await fetch(`${apiBaseUrl}/api/embed/config?${params}`);
        if (!res.ok) throw new Error("Ce quiz est introuvable ou désactivé.");
        const data = (await res.json()) as EmbedConfig;
        if (!cancelled) {
          setConfig(data);
          if (data.primaryColor) {
            document.documentElement.style.setProperty("--primary-color", data.primaryColor);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Impossible de charger le quiz.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [clientId, requestedQuizId]);

  return <TenantContext.Provider value={{ clientId, quizId: config?.quizId ?? null, config, loading, error }}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  return useContext(TenantContext);
}
