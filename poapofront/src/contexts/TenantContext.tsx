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

/** Site hôte de l'iframe : ancestorOrigins (fourni par le navigateur), sinon referrer, sinon valeur passée par poapo-widget.js. */
function parentOrigin(): string | null {
  if (window.parent === window) return null;
  const ancestor = window.location.ancestorOrigins?.[0];
  if (ancestor && ancestor !== "null") return ancestor;
  try { if (document.referrer) return new URL(document.referrer).origin; } catch { /* referrer invalide */ }
  return new URLSearchParams(window.location.search).get("parentOrigin");
}

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
        const parent = parentOrigin();
        if (parent) params.set("parentOrigin", parent);
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
