import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { PaginatedResponse } from "@poapo/types";
import { apiFetch } from "../lib/api";

interface ProductRow {
  id: string;
  name: string;
  brand: string | null;
  price: number | null;
  priceTier: string | null;
  olfactoryFamily: string | null;
  genderTarget: string | null;
  freshness: number | null;
  intensity: number | null;
  sweetness: number | null;
  active: boolean;
  featured: boolean;
  createdAt: string;
}

const PAGE_SIZE = 20;

export default function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const search = searchParams.get("search") ?? "";
  const activeFilter = searchParams.get("active") ?? "";

  const [data, setData] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(search ? { search } : {}),
        ...(activeFilter !== "" ? { active: activeFilter } : {}),
      });
      const res = await apiFetch<PaginatedResponse<ProductRow>>(`/api/catalog/products?${params.toString()}`);
      setData(res.data);
      setTotal(res.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [page, search, activeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Supprimer « ${name} » ?`)) return;
    setDeleting(id);
    try {
      await apiFetch(`/api/catalog/products/${id}`, { method: "DELETE" });
      setData((prev) => prev.filter((p) => p.id !== id));
      setTotal((prev) => prev - 1);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setDeleting(null);
    }
  };

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setSearchParams(next);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Catalogue</h1>
          <p className="page-subtitle">
            {total} produit{total !== 1 ? "s" : ""}
          </p>
        </div>
        <Link to="/catalog/new" className="btn-primary">
          + Nouveau produit
        </Link>
        <Link to="/catalog/import" className="btn-ghost">
          Importer CSV
        </Link>
      </div>

      <div className="toolbar">
        <input
          className="field-input toolbar-search"
          type="search"
          placeholder="Rechercher par nom, marque..."
          defaultValue={search}
          onChange={(e) => setParam("search", e.target.value)}
        />
        <select className="field-select" value={activeFilter} onChange={(e) => setParam("active", e.target.value)}>
          <option value="">Tous les statuts</option>
          <option value="true">Actifs</option>
          <option value="false">Inactifs</option>
        </select>
      </div>

      {error && <div className="form-error">{error}</div>}

      {isLoading ? (
        <div className="loading-block">Chargement...</div>
      ) : data.length === 0 ? (
        <div className="empty-state">
          <p>Aucun produit trouvé.</p>
          <Link to="/catalog/new" className="btn-primary">
            Ajouter le premier produit
          </Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Marque</th>
                <th>Famille</th>
                <th>Genre</th>
                <th>Fraîcheur</th>
                <th>Intensité</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/catalog/${p.id}/edit`} className="table-link">
                      {p.featured && (
                        <span className="badge-featured" title="Mis en avant">
                          ★{" "}
                        </span>
                      )}
                      {p.name}
                    </Link>
                  </td>
                  <td>{p.brand ?? "—"}</td>
                  <td>{p.olfactoryFamily ?? "—"}</td>
                  <td>{p.genderTarget ?? "—"}</td>
                  <td>{p.freshness != null ? `${Math.round(p.freshness * 100)}%` : "—"}</td>
                  <td>{p.intensity != null ? `${Math.round(p.intensity * 100)}%` : "—"}</td>
                  <td>
                    <span className={`badge ${p.active ? "badge-active" : "badge-inactive"}`}>{p.active ? "Actif" : "Inactif"}</span>
                  </td>
                  <td className="table-actions">
                    <Link to={`/catalog/${p.id}/edit`} className="btn-ghost">
                      Éditer
                    </Link>
                    <button type="button" className="btn-danger" disabled={deleting === p.id} onClick={() => void handleDelete(p.id, p.name)}>
                      {deleting === p.id ? "..." : "Suppr."}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>
            ← Précédent
          </button>
          <span className="pagination-info">
            Page {page} / {totalPages}
          </span>
          <button type="button" className="btn-ghost" disabled={page >= totalPages} onClick={() => setParam("page", String(page + 1))}>
            Suivant →
          </button>
        </div>
      )}
    </div>
  );
}
