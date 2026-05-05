import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { EmbedConfig } from "@poapo/types";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

interface TenantContextValue {
  clientId: string | null;
  config: EmbedConfig | null;
  loading: boolean;
}

const TenantContext = createContext<TenantContextValue>({
  clientId: null,
  config: null,
  loading: false,
});

export function TenantProvider({ children }: { children: ReactNode }) {
  const clientId = new URLSearchParams(window.location.search).get("clientId");
  const [config, setConfig] = useState<EmbedConfig | null>(null);
  const [loading, setLoading] = useState(clientId !== null);

  useEffect(() => {
    if (!clientId) return;

    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/embed/config?clientId=${encodeURIComponent(clientId)}`);
        if (!res.ok) throw new Error("embed config unavailable");
        const data = (await res.json()) as EmbedConfig;
        if (!cancelled) {
          setConfig(data);
          if (data.primaryColor) {
            document.documentElement.style.setProperty("--primary-color", data.primaryColor);
          }
        }
      } catch {
        // Fallback aux valeurs par défaut — pas de crash
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return <TenantContext.Provider value={{ clientId, config, loading }}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  return useContext(TenantContext);
}
