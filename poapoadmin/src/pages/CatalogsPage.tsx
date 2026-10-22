import { useState } from "react";
import { Link } from "react-router-dom";
import type { Catalog, CatalogInput, CatalogSummary } from "@poapo/types";
import { apiFetch } from "../lib/api";
import { useCatalogs } from "../lib/catalogs";

function withCatalog(path: string, catalogId: string): string {
  return `${path}?catalogId=${encodeURIComponent(catalogId)}`;
}

export default function CatalogsPage() {
  const { catalogs, loading, error, reload } = useCatalogs();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError("");
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      setActionError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setActionError("Le nom du catalogue est requis.");
      return;
    }
    const payload: CatalogInput = { name: name.trim(), description: description.trim() || null };
    const ok = await run(async () => {
      await apiFetch<Catalog>("/api/catalogs", { method: "POST", body: JSON.stringify(payload) });
    });
    if (ok) {
      setName("");
      setDescription("");
    }
  };

  const startEdit = (catalog: CatalogSummary) => {
    setEditingId(catalog.id);
    setEditName(catalog.name);
    setEditDescription(catalog.description ?? "");
    setActionError("");
  };

  const handleUpdate = async (catalogId: string) => {
    const payload: CatalogInput = { name: editName.trim(), description: editDescription.trim() || null };
    const ok = await run(() => apiFetch(`/api/catalogs/${catalogId}`, { method: "PUT", body: JSON.stringify(payload) }));
    if (ok) setEditingId(null);
  };

  const handleDelete = async (catalog: CatalogSummary) => {
    if (!window.confirm(`Supprimer le catalogue « ${catalog.name} » ?`)) return;
    await run(() => apiFetch(`/api/catalogs/${catalog.id}`, { method: "DELETE" }));
  };

  const deleteBlockedReason = (catalog: CatalogSummary): string | null => {
    if (catalog.isDefault) return "Le catalogue principal ne peut pas être supprimé.";
    if (catalog.productCount > 0 || catalog.quizCount > 0) return "Videz d'abord ce catalogue (produits et quiz).";
    return null;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Catalogues</h1>
          <p className="page-subtitle">Chaque quiz recommande uniquement les produits de son catalogue.</p>
        </div>
      </div>

      <form className="catalog-create" onSubmit={handleCreate}>
        <div className="field-group">
          <label className="field-label" htmlFor="catalog-name">Nouveau catalogue</label>
          <input id="catalog-name" className="field-input" placeholder="Ex. Hébergements" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="catalog-description">Description</label>
          <input id="catalog-description" className="field-input" placeholder="Optionnelle" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>Créer le catalogue</button>
      </form>

      {loading && <div className="loading-block">Chargement...</div>}
      {(error || actionError) && <div className="form-error" role="alert">{actionError || error}</div>}

      {!loading && catalogs.length > 0 && (
        <div className="step-table-wrap">
          <table className="table catalogs-table">
            <thead>
              <tr><th>Catalogue</th><th>Produits</th><th>Quiz</th><th>Campagnes</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {catalogs.map((catalog) => {
                const blocked = deleteBlockedReason(catalog);
                const editing = editingId === catalog.id;
                return (
                  <tr key={catalog.id}>
                    <td>
                      {editing ? (
                        <div className="catalog-edit">
                          <input className="field-input" aria-label="Nom du catalogue" maxLength={120} value={editName} onChange={(e) => setEditName(e.target.value)} />
                          <input className="field-input" aria-label="Description du catalogue" maxLength={500} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                        </div>
                      ) : (
                        <>
                          <strong>{catalog.name}</strong>
                          {catalog.isDefault && <span className="badge catalog-default-badge">Principal</span>}
                          {catalog.description && <div className="catalog-description">{catalog.description}</div>}
                        </>
                      )}
                    </td>
                    <td>
                      <Link to={withCatalog("/catalog", catalog.id)} reloadDocument>
                        {catalog.productCount} ({catalog.activeProductCount} actif{catalog.activeProductCount > 1 ? "s" : ""})
                      </Link>
                    </td>
                    <td><Link to={withCatalog("/quizzes", catalog.id)}>{catalog.quizCount}</Link></td>
                    <td><Link to={withCatalog("/campaigns", catalog.id)}>{catalog.campaignCount}</Link></td>
                    <td><div className="catalog-actions">
                      {editing ? (
                        <>
                          <button type="button" className="btn-primary btn-sm" disabled={busy || !editName.trim()} onClick={() => handleUpdate(catalog.id)}>Enregistrer</button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingId(null)}>Annuler</button>
                        </>
                      ) : (
                        <>
                          <Link className="btn-ghost btn-sm" to={withCatalog("/catalog/import", catalog.id)}>Importer</Link>
                          <Link className="btn-ghost btn-sm" to={withCatalog("/catalog/new", catalog.id)}>Produit</Link>
                          <Link className="btn-ghost btn-sm" to={withCatalog("/quizzes/new", catalog.id)}>Nouveau quiz</Link>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => startEdit(catalog)}>Renommer</button>
                          <button
                            type="button"
                            className="btn-danger btn-sm"
                            disabled={busy || blocked !== null}
                            title={blocked ?? undefined}
                            onClick={() => handleDelete(catalog)}
                          >
                            Supprimer
                          </button>
                        </>
                      )}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
