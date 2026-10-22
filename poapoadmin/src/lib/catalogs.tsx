import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { CatalogSummary, Quiz, QuizAxis } from "@poapo/types";
import { apiFetch } from "./api";
import { useAuth } from "../contexts/AuthContext";

const STORAGE_KEY = "poapo_admin_catalog";

/** Dernier catalogue choisi ("" = tous les catalogues), mémorisé entre les pages. */
export function storedCatalogId(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

export function rememberCatalogId(catalogId: string): void {
  localStorage.setItem(STORAGE_KEY, catalogId);
}

export function useCatalogs() {
  const { user } = useAuth();
  const hasTenant = !!user && user.tenantId !== "super-admin";
  const [catalogs, setCatalogs] = useState<CatalogSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!hasTenant) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setCatalogs(await apiFetch<CatalogSummary[]>("/api/catalogs"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [hasTenant]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { catalogs, loading, error, reload };
}

/**
 * Catalogue courant d'une page : `?catalogId=` dans l'URL, sinon le dernier choisi.
 * `allowAll` : la valeur "" signifie « tous les catalogues » (listes) ; sinon on retombe sur le catalogue par défaut (formulaires).
 */
export function useCatalogSelection({ allowAll }: { allowAll: boolean }) {
  const { catalogs, loading, error, reload } = useCatalogs();
  const [params, setParams] = useSearchParams();
  const requested = params.get("catalogId") ?? storedCatalogId();

  const catalogId = useMemo(() => {
    if (loading) return requested;
    if (requested && catalogs.some((catalog) => catalog.id === requested)) return requested;
    if (allowAll) return "";
    return catalogs.find((catalog) => catalog.isDefault)?.id ?? catalogs[0]?.id ?? "";
  }, [allowAll, catalogs, loading, requested]);

  const catalog = catalogs.find((item) => item.id === catalogId) ?? null;

  const setCatalogId = useCallback((next: string) => {
    rememberCatalogId(next);
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      if (next) updated.set("catalogId", next);
      else updated.delete("catalogId");
      updated.delete("page");
      return updated;
    }, { replace: true });
  }, [setParams]);

  return { catalogs, catalog, catalogId, setCatalogId, loading, error, reload };
}

/** Axes des quiz d'un catalogue : aide à la saisie des produits, jamais utilisée pour recommander. */
export function catalogAxes(quizzes: Quiz[], catalogId: string): QuizAxis[] {
  const byKey = new Map<string, QuizAxis>();
  for (const quiz of quizzes) {
    if (quiz.catalogId !== catalogId) continue;
    for (const axis of quiz.axes ?? []) if (!byKey.has(axis.key)) byKey.set(axis.key, axis);
  }
  return [...byKey.values()];
}

export function CatalogSelect({
  catalogs,
  value,
  onChange,
  allowAll = false,
  id = "catalog-select",
  label = "Catalogue",
  disabled = false,
}: {
  catalogs: CatalogSummary[];
  value: string;
  onChange: (catalogId: string) => void;
  allowAll?: boolean;
  id?: string;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="field-group catalog-select">
      <label className="field-label" htmlFor={id}>{label}</label>
      <select id={id} className="field-select" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {allowAll && <option value="">Tous les catalogues</option>}
        {catalogs.map((catalog) => (
          <option key={catalog.id} value={catalog.id}>
            {catalog.name}{catalog.isDefault ? " (principal)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
